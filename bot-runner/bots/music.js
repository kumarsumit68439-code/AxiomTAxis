import { Events, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } from 'discord.js';
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState, StreamType } from '@discordjs/voice';
import play from 'play-dl';

const YT_COOKIE_KEEP = new Set([
  'CONSENT', 'SOCS', 'VISITOR_INFO1_LIVE', 'LOGIN_INFO', 'PREF', 'YSC',
  'SID', 'HSID', 'SSID', 'APISID', 'SAPISID',
  '__Secure-1PSID', '__Secure-3PSID', '__Secure-1PAPISID', '__Secure-3PAPISID'
]);

function slimYtCookie(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let s = raw.trim();
  if (s.includes('\t') || s.startsWith('#') || s.includes('\n')) {
    const map = new Map();
    for (const line of s.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue;
      const p = line.split('\t');
      if (p.length >= 7) map.set(p[5], p[6]);
    }
    s = [...map.entries()].map(([k, v]) => k + '=' + v).join('; ');
  }
  const kept = [];
  for (const part of s.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    const val = part.slice(i + 1).trim();
    if (YT_COOKIE_KEEP.has(name) && val) kept.push(name + '=' + val);
  }
  return kept.join('; ').slice(0, 3500);
}

function applyCookie(cookie) {
  try { play.setToken({ youtube: { cookie: cookie || '' } }); } catch {}
}

const ytCookie = slimYtCookie(process.env.YT_COOKIE || '');
if (ytCookie) {
  applyCookie(ytCookie);
  console.log('play-dl: YT_COOKIE loaded, length=' + ytCookie.length);
}

export const commands = [
  {
    name: 'play',
    description: 'Play YouTube song',
    dm_permission: false,
    options: [
      { name: 'query', description: 'Song name or YouTube URL', type: 3, required: true },
      { name: 'channel', description: 'Voice channel', type: 7, required: false, channel_types: [ChannelType.GuildVoice, ChannelType.GuildStageVoice] }
    ]
  },
  {
    name: 'join',
    description: 'Join voice channel',
    dm_permission: false,
    options: [{ name: 'channel', description: 'Voice channel', type: 7, required: true, channel_types: [ChannelType.GuildVoice, ChannelType.GuildStageVoice] }]
  },
  { name: 'stop', description: 'Stop and leave', dm_permission: false }
];

const fmt = (s) => {
  s = Math.max(0, Math.floor(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

function extractId(input) {
  const s = String(input || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m =
    s.match(/(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/|\/watch\?v=)([A-Za-z0-9_-]{11})/) ||
    s.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
const watchUrl = (id) => 'https://www.youtube.com/watch?v=' + id;

const PIPED = [
  'https://api.piped.private.coffee/search?q=',
  'https://pipedapi.adminforge.de/search?q='
];

async function searchPiped(q) {
  for (const base of PIPED) {
    try {
      const r = await fetch(base + encodeURIComponent(q) + '&filter=videos', {
        headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' },
        signal: AbortSignal.timeout(12000)
      });
      if (!r.ok) continue;
      const data = await r.json();
      const items = Array.isArray(data) ? data : data.items || [];
      for (const v of items) {
        if (v.type && v.type !== 'stream' && v.type !== 'video') continue;
        const vid = extractId(v.url) || extractId(v.id) || extractId(v.videoId);
        if (!vid) continue;
        return {
          title: v.title || v.name || q,
          url: watchUrl(vid),
          dur: Number(v.duration) || Number(v.lengthSeconds) || 0,
          thumb: v.thumbnail || null
        };
      }
    } catch (e) {
      console.warn('piped search', base, e.message);
    }
  }
  return null;
}

async function resolveVideo(query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Empty query');

  const id = extractId(q);
  if (id) {
    try {
      const info = await play.video_info(watchUrl(id));
      const v = info.video_details;
      return {
        title: (v && v.title) || 'Unknown',
        url: watchUrl(id),
        dur: Number(v && v.durationInSec) || 0,
        thumb: v && v.thumbnails && v.thumbnails[0] && v.thumbnails[0].url
      };
    } catch {
      return { title: 'YouTube', url: watchUrl(id), dur: 0, thumb: null };
    }
  }

  for (const qq of [q, q + ' song', q + ' official audio']) {
    const t = await searchPiped(qq);
    if (t) return t;
  }

  try {
    const found = await play.search(q, { limit: 8, source: { youtube: 'video' } });
    for (const v of found || []) {
      const vid = extractId(v.url) || extractId(v.id);
      if (!vid) continue;
      return {
        title: v.title || q,
        url: watchUrl(vid),
        dur: Number(v.durationInSec) || 0,
        thumb: v.thumbnails && v.thumbnails[0] && v.thumbnails[0].url
      };
    }
  } catch (e) {
    console.warn('play-dl search', e.message);
  }

  throw new Error('Song nahi mila: ' + q + ' — pure YouTube link se try karo');
}

export function attach(client) {
  const guilds = new Map();
  const pos = (st) => (st.offset + (st.playStart ? Date.now() - st.playStart : 0)) / 1000;

  function embed(st, ended) {
    const t = st.track, p = Math.min(pos(st), t.dur || 0), len = 20;
    const at = t.dur ? Math.min(len - 1, Math.floor((p / t.dur) * len)) : 0;
    const bar = '▬'.repeat(at) + '🔘' + '▬'.repeat(len - 1 - at);
    const e = new EmbedBuilder()
      .setColor(0xf97316)
      .setTitle(ended ? 'Finished: ' + t.title : (st.paused ? '⏸ ' : '▶ ') + t.title)
      .setURL(t.url)
      .setDescription(bar + '\n`' + fmt(p) + ' / ' + fmt(t.dur) + '`')
      .setFooter({ text: 'Requested by ' + t.by });
    if (t.thumb) e.setThumbnail(t.thumb);
    return e;
  }

  const row = (st) => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mp:back').setLabel('⏪ 10s').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mp:pause').setLabel(st.paused ? '▶ Resume' : '⏸ Pause').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('mp:fwd').setLabel('10s ⏩').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mp:stop').setLabel('⏹ Stop').setStyle(ButtonStyle.Danger)
  );

  const refresh = (st, ended) =>
    st.msg && st.msg.edit({ embeds: [embed(st, ended)], components: ended ? [] : [row(st)] }).catch(() => {});

  function destroy(guildId) {
    const st = guilds.get(guildId);
    if (!st) return;
    guilds.delete(guildId);
    clearInterval(st.timer);
    try { st.player.stop(true); } catch {}
    try { st.connection.destroy(); } catch {}
    if (st.track) refresh(st, true);
  }

  async function startTrack(st, sec) {
    const id = extractId(st.track.url);
    const url = id ? watchUrl(id) : st.track.url;
    const tryStream = async () => {
      try { return await play.stream(url, { seek: sec || 0 }); }
      catch { return await play.stream(url); }
    };
    let stream;
    try {
      stream = await tryStream();
    } catch (e) {
      if (/Header overflow|Parse Error/i.test(String(e.message))) {
        applyCookie('');
        try { stream = await tryStream(); }
        catch (e2) {
          if (ytCookie) applyCookie(ytCookie);
          throw new Error('Stream fail: ' + String(e2.message).slice(0, 120));
        }
        if (ytCookie) applyCookie(ytCookie);
      } else {
        throw new Error('Stream fail: ' + String(e.message).slice(0, 160));
      }
    }
    st.player.play(createAudioResource(stream.stream, { inputType: stream.type || StreamType.Arbitrary }));
    st.offset = (sec || 0) * 1000;
    st.playStart = Date.now();
    st.paused = false;
  }

  function create(guild, vc) {
    const connection = joinVoiceChannel({
      channelId: vc.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true
    });
    const player = createAudioPlayer();
    connection.subscribe(player);
    const st = { connection, player, channelId: vc.id, offset: 0, playStart: null, paused: false, track: null, msg: null, timer: null };
    player.on(AudioPlayerStatus.Idle, () => { if (guilds.get(guild.id) === st) destroy(guild.id); });
    player.on('error', (e) => { console.error('player', e.message); if (guilds.get(guild.id) === st) destroy(guild.id); });
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000)
        ]);
      } catch { if (guilds.get(guild.id) === st) destroy(guild.id); }
    });
    guilds.set(guild.id, st);
    return st;
  }

  function resolveVC(i) {
    const opt = i.options.getChannel('channel', false);
    if (opt) {
      if (opt.type !== ChannelType.GuildVoice && opt.type !== ChannelType.GuildStageVoice) return { error: 'Sirf voice channel.' };
      return { channel: opt };
    }
    const vc = i.member && i.member.voice && i.member.voice.channel;
    if (vc) return { channel: vc };
    return { error: 'Voice channel me join karo.' };
  }

  function canJoin(channel, me) {
    if (!channel || !me) return 'Channel/bot missing.';
    const p = channel.permissionsFor(me);
    if (!p) return 'Permissions fail.';
    if (!p.has(PermissionFlagsBits.Connect)) return 'Connect permission nahi.';
    if (!p.has(PermissionFlagsBits.Speak)) return 'Speak permission nahi.';
    return null;
  }

  async function onPlay(i) {
    const resolved = resolveVC(i);
    if (resolved.error) return i.reply({ content: resolved.error, flags: MessageFlags.Ephemeral });
    const err = canJoin(resolved.channel, i.guild.members.me);
    if (err) return i.reply({ content: err, flags: MessageFlags.Ephemeral });
    await i.deferReply();
    try {
      const v = await resolveVideo(i.options.getString('query', true));
      if (guilds.has(i.guildId)) destroy(i.guildId);
      const st = create(i.guild, resolved.channel);
      st.track = { title: v.title, url: v.url, dur: v.dur, thumb: v.thumb, by: i.user.username };
      await startTrack(st, 0);
      st.msg = await i.editReply({ embeds: [embed(st)], components: [row(st)] });
      st.timer = setInterval(() => refresh(st), 10000);
    } catch (e) {
      console.error('play', e.message);
      destroy(i.guildId);
      await i.editReply('Play error: ' + String(e.message).slice(0, 280)).catch(() => {});
    }
  }

  client.on(Events.InteractionCreate, (i) => {
    if (i.isChatInputCommand()) {
      if (i.commandName === 'play') return onPlay(i);
      if (i.commandName === 'join') {
        const vc = i.options.getChannel('channel', true);
        const err = canJoin(vc, i.guild.members.me);
        if (err) return i.reply({ content: err, flags: MessageFlags.Ephemeral });
        if (guilds.has(i.guildId)) destroy(i.guildId);
        create(i.guild, vc);
        return i.reply({ content: 'Joined **' + vc.name + '**.', flags: MessageFlags.Ephemeral });
      }
      if (i.commandName === 'stop') {
        if (!guilds.has(i.guildId)) return i.reply({ content: 'Kuch play nahi.', flags: MessageFlags.Ephemeral });
        destroy(i.guildId);
        return i.reply('Stopped.');
      }
    } else if (i.isButton() && i.customId.startsWith('mp:')) {
      const st = guilds.get(i.guildId);
      if (!st || !st.track) return i.reply({ content: 'Kuch play nahi.', flags: MessageFlags.Ephemeral });
      if (!i.member.voice.channelId || i.member.voice.channelId !== st.channelId)
        return i.reply({ content: 'Bot ke VC me aao.', flags: MessageFlags.Ephemeral });
      i.deferUpdate().then(async () => {
        const act = i.customId.slice(3);
        try {
          if (act === 'stop') return destroy(i.guildId);
          if (act === 'pause') {
            if (st.paused) { st.player.unpause(); st.playStart = Date.now(); st.paused = false; }
            else { st.player.pause(); st.offset += Date.now() - st.playStart; st.playStart = null; st.paused = true; }
          } else {
            const max = Math.max(0, (st.track.dur || 0) - 2);
            await startTrack(st, Math.max(0, Math.min(max, pos(st) + (act === 'fwd' ? 10 : -10))));
          }
          refresh(st);
        } catch (e) { console.error('button', e.message); }
      });
    }
  });
}
