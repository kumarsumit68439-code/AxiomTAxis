import { Events, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } from 'discord.js';
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState, StreamType } from '@discordjs/voice';
import play from 'play-dl';

// Node default max header size is small; huge Google cookie jars cause "Parse Error: Header overflow".
const YT_COOKIE_KEEP = new Set([
  'CONSENT', 'SOCS', 'VISITOR_INFO1_LIVE', 'VISITOR_PRIVACY_METADATA',
  'LOGIN_INFO', 'PREF', 'YSC',
  'SID', 'HSID', 'SSID', 'APISID', 'SAPISID',
  '__Secure-1PSID', '__Secure-3PSID',
  '__Secure-1PAPISID', '__Secure-3PAPISID',
  '__Secure-1PSIDTS', '__Secure-3PSIDTS',
  '__Secure-1PSIDCC', '__Secure-3PSIDCC',
  'SIDCC', '__Secure-SIDCC'
]);

function slimYtCookie(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let s = raw.trim();
  // Netscape cookies.txt export → header style
  if (s.includes('\t') || /^#/.test(s) || s.includes('\n')) {
    const map = new Map();
    for (const line of s.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue;
      const p = line.split('\t');
      if (p.length >= 7) map.set(p[5], p[6]);
      else {
        const m = line.match(/^([^=\s]+)=(.*)$/);
        if (m) map.set(m[1].trim(), m[2].trim());
      }
    }
    s = [...map.entries()].map(([k, v]) => k + '=' + v).join('; ');
  }
  const kept = [];
  for (const part of s.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    const val = part.slice(i + 1).trim();
    if (!name || !val) continue;
    if (YT_COOKIE_KEEP.has(name) || name.startsWith('__Secure-') || name.startsWith('__Host-')) {
      kept.push(name + '=' + val);
    }
  }
  let out = kept.join('; ');
  // Hard cap ~6KB so Node never hits header overflow
  if (out.length > 6000) {
    const prefer = ['LOGIN_INFO', 'SID', 'HSID', 'SSID', 'APISID', 'SAPISID',
      '__Secure-1PSID', '__Secure-3PSID', '__Secure-1PAPISID', '__Secure-3PAPISID',
      'CONSENT', 'SOCS', 'VISITOR_INFO1_LIVE', 'PREF'];
    const map = new Map(kept.map((kv) => {
      const j = kv.indexOf('=');
      return [kv.slice(0, j), kv];
    }));
    out = prefer.map((n) => map.get(n)).filter(Boolean).join('; ');
  }
  return out;
}

const ytCookie = slimYtCookie(process.env.YT_COOKIE || '');
if (ytCookie) {
  try {
    play.setToken({ youtube: { cookie: ytCookie } });
    console.log('play-dl: YT_COOKIE loaded, length=' + ytCookie.length);
  } catch (e) {
    console.error('play-dl cookie failed', e.message);
  }
} else if (process.env.YT_COOKIE) {
  console.warn('play-dl: YT_COOKIE set but no usable names after slim — check cookie format');
}

export const commands = [
  {
    name: 'play',
    description: 'Search YouTube and play a song in a voice channel',
    dm_permission: false,
    options: [
      { name: 'query', description: 'Song name or YouTube URL', type: 3, required: true },
      {
        name: 'channel',
        description: 'Voice channel to join. Empty = your current VC',
        type: 7,
        required: false,
        channel_types: [ChannelType.GuildVoice, ChannelType.GuildStageVoice]
      }
    ]
  },
  {
    name: 'join',
    description: 'Join a voice channel',
    dm_permission: false,
    options: [
      {
        name: 'channel',
        description: 'Voice channel to join',
        type: 7,
        required: true,
        channel_types: [ChannelType.GuildVoice, ChannelType.GuildStageVoice]
      }
    ]
  },
  { name: 'stop', description: 'Stop music and leave', dm_permission: false }
];

const fmt = (s) => {
  s = Math.max(0, Math.floor(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

function extractId(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/|music\.youtube\.com\/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})/,
    /[?&]v=([A-Za-z0-9_-]{11})/
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

function watchUrl(id) {
  return 'https://www.youtube.com/watch?v=' + id;
}

async function resolveVideo(query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Song name / URL empty.');

  let id = extractId(q);
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
    } catch (e) {
      if (/Header overflow/i.test(String(e.message))) {
        throw new Error('Cookie bahut badi hai (Header overflow). Sirf SID/LOGIN_INFO wale cookies rakho. Code auto-trim karta hai — redeploy + chhoti cookie try karo.');
      }
      if (/Sign in|confirm your age|bot|403/i.test(String(e.message))) {
        throw new Error('YouTube blocked video_info. Fresh YT_COOKIE (logged-in) lagao. (' + String(e.message).slice(0, 80) + ')');
      }
      return { title: 'YouTube video', url: watchUrl(id), dur: 0, thumb: null };
    }
  }

  let found = [];
  try {
    found = await play.search(q, { limit: 8, source: { youtube: 'video' } });
  } catch (e) {
    if (/Header overflow/i.test(String(e.message))) {
      throw new Error('Header overflow — YT_COOKIE trim karo (sirf essential names). Redeploy ke baad dubara try.');
    }
    throw new Error(
      'YouTube search fail: ' +
        String(e.message).slice(0, 160) +
        (ytCookie ? '' : ' — add YT_COOKIE on Railway.')
    );
  }
  if (!found || !found.length) throw new Error('Song nahi mila: ' + q);

  for (const v of found) {
    const vid =
      extractId(v.url) ||
      extractId(v.id) ||
      (typeof v.id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(v.id) ? v.id : null);
    if (!vid) continue;
    return {
      title: v.title || 'Unknown',
      url: watchUrl(vid),
      dur: Number(v.durationInSec) || 0,
      thumb: v.thumbnails && v.thumbnails[0] && v.thumbnails[0].url
    };
  }
  throw new Error('Search me valid video ID nahi mili. Full YouTube link se try karo.');
}

export function attach(client) {
  const guilds = new Map();
  const pos = (st) => (st.offset + (st.playStart ? Date.now() - st.playStart : 0)) / 1000;

  function embed(st, ended) {
    const t = st.track,
      p = Math.min(pos(st), t.dur || 0),
      len = 20;
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

  const row = (st) =>
    new ActionRowBuilder().addComponents(
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
    try {
      st.player.stop(true);
    } catch {}
    try {
      st.connection.destroy();
    } catch {}
    if (st.track) refresh(st, true);
  }

  async function startTrack(st, sec) {
    if (!st.track || !st.track.url) throw new Error('Track URL missing.');
    const id = extractId(st.track.url);
    const url = id ? watchUrl(id) : st.track.url;
    if (!/^https?:\/\//i.test(url)) throw new Error('Invalid URL: ' + String(url).slice(0, 80));

    let stream;
    try {
      stream = await play.stream(url, { seek: sec || 0 });
    } catch (e) {
      try {
        stream = await play.stream(url);
      } catch (e2) {
        const msg = String(e2.message || e.message);
        if (/Header overflow/i.test(msg)) {
          throw new Error('Header overflow — YT_COOKIE chhoti rakho (LOGIN_INFO + SID family only).');
        }
        throw new Error(
          'Stream fail: ' +
            msg.slice(0, 160) +
            (ytCookie ? ' — cookie expire ho sakti hai.' : ' — Railway pe YT_COOKIE set karo.')
        );
      }
    }
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
      connection,
      player,
      channelId: vc.id,
      offset: 0,
      playStart: null,
      paused: false,
      track: null,
      msg: null,
      timer: null
    };
    player.on(AudioPlayerStatus.Idle, () => {
      if (guilds.get(guild.id) === st) destroy(guild.id);
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
      } catch {
        if (guilds.get(guild.id) === st) destroy(guild.id);
      }
    });
    guilds.set(guild.id, st);
    return st;
  }

  function resolveVC(i) {
    const opt = i.options.getChannel('channel', false);
    if (opt) {
      if (opt.type !== ChannelType.GuildVoice && opt.type !== ChannelType.GuildStageVoice) {
        return { error: 'Sirf voice / stage channel select karo.' };
      }
      return { channel: opt };
    }
    const memberVC = i.member && i.member.voice && i.member.voice.channel;
    if (memberVC) return { channel: memberVC };
    return { error: 'Kisi voice channel me join karo, ya /play me channel do.' };
  }

  function canJoin(channel, me) {
    if (!channel) return 'Channel nahi mila.';
    if (!me) return 'Bot member nahi mila.';
    const perms = channel.permissionsFor(me);
    if (!perms) return 'Permissions check nahi ho paya.';
    if (!perms.has(PermissionFlagsBits.Connect)) return 'Bot ko **Connect** permission nahi hai.';
    if (!perms.has(PermissionFlagsBits.Speak)) return 'Bot ko **Speak** permission nahi hai.';
    return null;
  }

  async function onPlay(i) {
    const resolved = resolveVC(i);
    if (resolved.error) return i.reply({ content: resolved.error, flags: MessageFlags.Ephemeral });
    const vc = resolved.channel;
    const permErr = canJoin(vc, i.guild.members.me);
    if (permErr) return i.reply({ content: permErr, flags: MessageFlags.Ephemeral });

    await i.deferReply();
    try {
      const v = await resolveVideo(i.options.getString('query', true));
      if (guilds.has(i.guildId)) destroy(i.guildId);
      const st = create(i.guild, vc);
      st.track = {
        title: v.title,
        url: v.url,
        dur: v.dur,
        thumb: v.thumb,
        by: i.user.username
      };
      await startTrack(st, 0);
      st.msg = await i.editReply({ embeds: [embed(st)], components: [row(st)] });
      st.timer = setInterval(() => refresh(st), 10000);
    } catch (e) {
      console.error('play', e.message);
      destroy(i.guildId);
      await i.editReply('Play error: ' + String(e.message).slice(0, 280)).catch(() => {});
    }
  }

  async function onJoin(i) {
    const vc = i.options.getChannel('channel', true);
    if (vc.type !== ChannelType.GuildVoice && vc.type !== ChannelType.GuildStageVoice) {
      return i.reply({ content: 'Sirf voice / stage channel.', flags: MessageFlags.Ephemeral });
    }
    const permErr = canJoin(vc, i.guild.members.me);
    if (permErr) return i.reply({ content: permErr, flags: MessageFlags.Ephemeral });
    if (guilds.has(i.guildId)) destroy(i.guildId);
    create(i.guild, vc);
    return i.reply({
      content: `Joined **${vc.name}**. Ab \`/play song\` chalao.`,
      flags: MessageFlags.Ephemeral
    });
  }

  async function onButton(i) {
    const st = guilds.get(i.guildId);
    if (!st || !st.track) return i.reply({ content: 'Kuch play nahi ho raha.', flags: MessageFlags.Ephemeral });
    if (!i.member.voice.channelId || i.member.voice.channelId !== st.channelId) {
      return i.reply({ content: 'Bot ke VC me aao.', flags: MessageFlags.Ephemeral });
    }
    await i.deferUpdate();
    const act = i.customId.slice(3);
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
      } else {
        const max = Math.max(0, (st.track.dur || 0) - 2);
        await startTrack(st, Math.max(0, Math.min(max, pos(st) + (act === 'fwd' ? 10 : -10))));
      }
      refresh(st);
    } catch (e) {
      console.error('button', e.message);
    }
  }

  client.on(Events.InteractionCreate, (i) => {
    if (i.isChatInputCommand()) {
      if (i.commandName === 'play') return onPlay(i);
      if (i.commandName === 'join') return onJoin(i);
      if (i.commandName === 'stop') {
        if (!guilds.has(i.guildId)) return i.reply({ content: 'Kuch play nahi ho raha.', flags: MessageFlags.Ephemeral });
        destroy(i.guildId);
        return i.reply('Stopped.');
      }
    } else if (i.isButton() && i.customId.startsWith('mp:')) return onButton(i);
  });
}
