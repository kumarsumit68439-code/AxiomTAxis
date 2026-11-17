import { Events, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
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
  const patterns = [
    /(?:youtube\.com\/watch\?(?:[^#]*&)?v=|youtube\.com\/shorts\/|youtube\.com\/embed\/|youtu\.be\/|music\.youtube\.com\/watch\?(?:[^#]*&)?v=)([A-Za-z0-9_-]{11})/,
    /\/watch\?v=([A-Za-z0-9_-]{11})/
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

const watchUrl = (id) => 'https://www.youtube.com/watch?v=' + id;

async function searchPiped(q) {
  const bases = [
    'https://api.piped.private.coffee/search?q=',
    'https://pipedapi.adminforge.de/search?q='
  ];
  for (const base of bases) {
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
        const vid = extractId(String(v.url || '')) || (typeof v.id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(v.id) ? v.id : null);
        if (!vid) continue;
        return {
          title: v.title || q,
          url: watchUrl(vid),
          id: vid,
          dur: Number(v.duration) || 0,
          thumb: typeof v.thumbnail === 'string' && v.thumbnail.startsWith('http') ? v.thumbnail : null
        };
      }
    } catch (e) {
      console.warn('piped', e.message);
    }
  }
  return null;
}

async function resolveVideo(query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Empty query');
  let id = extractId(q);
  if (id) return { title: 'YouTube', url: watchUrl(id), id, dur: 0, thumb: null };
  for (const qq of [q, q + ' song', q + ' official audio']) {
    const t = await searchPiped(qq);
    if (t) return t;
  }
  try {
    const found = await play.search(q, { limit: 5, source: { youtube: 'video' } });
    for (const v of found || []) {
      const vid = extractId(v.url) || (typeof v.id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(v.id) ? v.id : null);
      if (!vid) continue;
      return {
        title: v.title || q,
        url: watchUrl(vid),
        id: vid,
        dur: Number(v.durationInSec) || 0,
        thumb: v.thumbnails && v.thumbnails[0] && v.thumbnails[0].url
      };
    }
  } catch (e) {
    console.warn('play-dl search', e.message);
  }
  throw new Error('Song nahi mila: ' + q);
}

export function attach(client) {
  const guilds = new Map();
  const pos = (st) => (st.offset + (st.playStart ? Date.now() - st.playStart : 0)) / 1000;

  function embed(st, ended) {
    const t = st.track;
    const p = Math.min(pos(st), t.dur || 0);
    const len = 20;
    const at = t.dur ? Math.min(len - 1, Math.floor((p / t.dur) * len)) : 0;
    const bar = '▬'.repeat(at) + '🔘' + '▬'.repeat(Math.max(0, len - 1 - at));
    const e = new EmbedBuilder()
      .setColor(0xf97316)
      .setTitle(ended ? 'Finished: ' + t.title : (st.paused ? '⏸ ' : '▶ ') + t.title)
      .setURL(t.url)
      .setDescription(bar + '\n`' + fmt(p) + ' / ' + fmt(t.dur) + '`')
      .setFooter({ text: 'Requested by ' + t.by + ' · 🔍 Search se naya gaana' });
    if (t.thumb) e.setThumbnail(t.thumb);
    return e;
  }

  function controls(st) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('mp:back').setLabel('⏪').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('mp:pause').setLabel(st.paused ? '▶' : '⏸').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('mp:fwd').setLabel('⏩').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('mp:search').setLabel('🔍 Search').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('mp:stop').setLabel('⏹').setStyle(ButtonStyle.Danger)
    );
  }

  const refresh = (st, ended) =>
    st.msg && st.msg.edit({ embeds: [embed(st, ended)], components: ended ? [] : [controls(st)] }).catch(() => {});

  function destroy(guildId) {
    const st = guilds.get(guildId);
    if (!st) return;
    guilds.delete(guildId);
    clearInterval(st.timer);
    try { st.player.stop(true); } catch {}
    try { st.connection.destroy(); } catch {}
    if (st.track) refresh(st, true);
  }

  async function openStream(url) {
    const id = extractId(url);
    const full = id ? watchUrl(id) : url;
    if (!/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(full)) {
      throw new Error('Invalid URL: ' + String(full).slice(0, 80));
    }
    try {
      const info = await play.video_info(full);
      return await play.stream_from_info(info);
    } catch (e1) {
      try {
        return await play.stream(full);
      } catch (e2) {
        if (/Header overflow|Parse Error/i.test(String(e2.message))) {
          applyCookie('');
          try {
            return await play.stream(full);
          } finally {
            if (ytCookie) applyCookie(ytCookie);
          }
        }
        throw new Error(String(e2.message || e1.message).slice(0, 160));
      }
    }
  }

  async function startTrack(st, sec) {
    const stream = await openStream(st.track.url);
    st.player.play(createAudioResource(stream.stream, { inputType: stream.type || StreamType.Arbitrary }));
    st.offset = (sec || 0) * 1000;
    st.playStart = Date.now();
    st.paused = false;
  }

  function create(guild, vc) {
    const connection = joinVoiceChannel({
      channelId: vc.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true
    });
    const player = createAudioPlayer();
    connection.subscribe(player);
    const st = {
      connection, player, channelId: vc.id,
      offset: 0, playStart: null, paused: false, track: null, msg: null, timer: null, queue: []
    };
    player.on(AudioPlayerStatus.Idle, () => {
      if (guilds.get(guild.id) !== st) return;
      if (st.queue.length) {
        st.track = st.queue.shift();
        startTrack(st, 0).then(() => refresh(st)).catch(() => destroy(guild.id));
      } else destroy(guild.id);
    });
    player.on('error', (e) => {
      console.error('player', e.message);
      if (guilds.get(guild.id) === st) destroy(guild.id);
    });
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

  async function playIn(i, query, vc) {
    const v = await resolveVideo(query);
    let st = guilds.get(i.guildId);
    if (!st) st = create(i.guild, vc);
    else if (st.channelId !== vc.id) {
      destroy(i.guildId);
      st = create(i.guild, vc);
    }
    st.track = { title: v.title, url: v.url, id: v.id, dur: v.dur, thumb: v.thumb, by: i.user.username };
    await startTrack(st, 0);
    return st;
  }

  async function onPlay(i) {
    const resolved = resolveVC(i);
    if (resolved.error) return i.reply({ content: resolved.error, flags: MessageFlags.Ephemeral });
    const err = canJoin(resolved.channel, i.guild.members.me);
    if (err) return i.reply({ content: err, flags: MessageFlags.Ephemeral });
    await i.deferReply();
    try {
      const st = await playIn(i, i.options.getString('query', true), resolved.channel);
      st.msg = await i.editReply({ embeds: [embed(st)], components: [controls(st)] });
      clearInterval(st.timer);
      st.timer = setInterval(() => refresh(st), 8000);
    } catch (e) {
      console.error('play', e.message);
      destroy(i.guildId);
      await i.editReply('Play error: ' + String(e.message).slice(0, 280)).catch(() => {});
    }
  }

  client.on(Events.InteractionCreate, async (i) => {
    try {
      if (i.isChatInputCommand()) {
        if (i.commandName === 'play') return onPlay(i);
        if (i.commandName === 'join') {
          const vc = i.options.getChannel('channel', true);
          const err = canJoin(vc, i.guild.members.me);
          if (err) return i.reply({ content: err, flags: MessageFlags.Ephemeral });
          if (guilds.has(i.guildId)) destroy(i.guildId);
          create(i.guild, vc);
          return i.reply({ content: 'Joined **' + vc.name + '**. Ab 🔍 Search ya /play use karo.', flags: MessageFlags.Ephemeral });
        }
        if (i.commandName === 'stop') {
          if (!guilds.has(i.guildId)) return i.reply({ content: 'Kuch play nahi.', flags: MessageFlags.Ephemeral });
          destroy(i.guildId);
          return i.reply('Stopped.');
        }
      }

      if (i.isModalSubmit() && i.customId === 'mp:searchmodal') {
        const q = i.fields.getTextInputValue('q');
        const vc = i.member && i.member.voice && i.member.voice.channel;
        if (!vc) return i.reply({ content: 'Pehle voice channel me join karo.', flags: MessageFlags.Ephemeral });
        const err = canJoin(vc, i.guild.members.me);
        if (err) return i.reply({ content: err, flags: MessageFlags.Ephemeral });
        await i.deferReply();
        try {
          const st = await playIn(i, q, vc);
          st.msg = await i.editReply({ embeds: [embed(st)], components: [controls(st)] });
          clearInterval(st.timer);
          st.timer = setInterval(() => refresh(st), 8000);
        } catch (e) {
          destroy(i.guildId);
          await i.editReply('Play error: ' + String(e.message).slice(0, 280)).catch(() => {});
        }
        return;
      }

      if (i.isButton() && i.customId.startsWith('mp:')) {
        const act = i.customId.slice(3);
        if (act === 'search') {
          const modal = new ModalBuilder().setCustomId('mp:searchmodal').setTitle('Search song');
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('q')
                .setLabel('Song name or YouTube link')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('babydoll, shape of you, or youtube url')
            )
          );
          return i.showModal(modal);
        }
        const st = guilds.get(i.guildId);
        if (!st || !st.track) return i.reply({ content: 'Kuch play nahi.', flags: MessageFlags.Ephemeral });
        if (!i.member.voice.channelId || i.member.voice.channelId !== st.channelId) {
          return i.reply({ content: 'Bot ke VC me aao.', flags: MessageFlags.Ephemeral });
        }
        await i.deferUpdate();
        try {
          if (act === 'stop') return destroy(i.guildId);
          if (act === 'pause') {
            if (st.paused) {
              st.player.unpause();
              st.playStart = Date.now();
              st.paused = false;
            } else {
              st.player.pause();
              st.offset += Date.now() - st.playStart;
              st.playStart = null;
              st.paused = true;
            }
          } else if (act === 'back' || act === 'fwd') {
            const max = Math.max(0, (st.track.dur || 0) - 2);
            const next = Math.max(0, Math.min(max, pos(st) + (act === 'fwd' ? 10 : -10)));
            await startTrack(st, next);
          }
          refresh(st);
        } catch (e) {
          console.error('button', e.message);
        }
      }
    } catch (e) {
      console.error('music interaction', e.message);
    }
  });
}
