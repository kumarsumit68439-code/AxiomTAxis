import { Events, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState, StreamType } from '@discordjs/voice';
import play from 'play-dl';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { hasSpotify, initSpotifyPlayDl, parseSpotifyUrl, spotifyToQuery } from './spotify.js';

const execFileAsync = promisify(execFile);
const YTDLP_BIN = path.join('/tmp', 'yt-dlp-axiom');
let ytdlpReady = null;

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

initSpotifyPlayDl();

export const commands = [
  {
    name: 'play',
    description: 'Play song (YouTube / Spotify link or name)',
    dm_permission: false,
    options: [
      { name: 'query', description: 'Song name, YouTube URL, or Spotify track/album link', type: 3, required: true },
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
  if (id) return { title: 'YouTube', url: watchUrl(id), id, dur: 0, thumb: null, source: 'youtube' };

  if (hasSpotify() && (parseSpotifyUrl(q) || !extractId(q))) {
    try {
      const sp = await spotifyToQuery(q);
      if (sp && sp.searchQ) {
        for (const qq of [sp.searchQ, sp.searchQ + ' official audio', sp.searchQ + ' lyrics', sp.searchQ + ' song']) {
          const t = await searchPiped(qq);
          if (t && t.id) {
            return {
              title: sp.title || t.title || sp.searchQ,
              url: watchUrl(t.id),
              id: t.id,
              dur: sp.dur || t.dur || 0,
              thumb: sp.thumb || t.thumb || null,
              source: 'spotify',
              spotifyUrl: sp.spotifyUrl || null
            };
          }
        }
        const ytKey = process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY;
        if (ytKey) {
          try {
            const api = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5&q=' +
              encodeURIComponent(sp.searchQ) + '&key=' + encodeURIComponent(ytKey);
            const r = await fetch(api, { signal: AbortSignal.timeout(10000) });
            if (r.ok) {
              const data = await r.json();
              for (const item of (data.items || [])) {
                const vid = item.id && item.id.videoId;
                if (vid && /^[A-Za-z0-9_-]{11}$/.test(vid)) {
                  return {
                    title: sp.title || (item.snippet && item.snippet.title) || sp.searchQ,
                    url: watchUrl(vid),
                    id: vid,
                    dur: sp.dur || 0,
                    thumb: sp.thumb || (item.snippet && item.snippet.thumbnails && item.snippet.thumbnails.medium && item.snippet.thumbnails.medium.url) || null,
                    source: 'spotify',
                    spotifyUrl: sp.spotifyUrl || null
                  };
                }
              }
            }
          } catch (e) {
            console.warn('spotify->yt api', e.message);
          }
        }
        try {
          const found = await play.search(sp.searchQ, { limit: 5, source: { youtube: 'video' } });
          for (const v of found || []) {
            const vid = extractId(v.url) || (typeof v.id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(v.id) ? v.id : null);
            if (!vid) continue;
            return {
              title: sp.title || v.title || sp.searchQ,
              url: watchUrl(vid),
              id: vid,
              dur: sp.dur || Number(v.durationInSec) || 0,
              thumb: sp.thumb || (v.thumbnails && v.thumbnails[0] && v.thumbnails[0].url) || null,
              source: 'spotify',
              spotifyUrl: sp.spotifyUrl || null
            };
          }
        } catch (e) {
          console.warn('spotify->play-dl', e.message);
        }
        if (parseSpotifyUrl(q)) {
          throw new Error('Spotify track "' + (sp.title || sp.searchQ) + '" resolve ho gaya, lekin stream nahi mila. YT_COOKIE check karo.');
        }
      }
    } catch (e) {
      if (parseSpotifyUrl(q)) throw e;
      console.warn('spotify resolve', e.message);
    }
  }

  for (const qq of [q, q + ' song', q + ' official audio', q + ' lyrics']) {
    const t = await searchPiped(qq);
    if (t && t.id) return { ...t, url: watchUrl(t.id), source: 'youtube' };
  }

  const ytKey = process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY;
  if (ytKey) {
    try {
      const api = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5&q=' +
        encodeURIComponent(q) + '&key=' + encodeURIComponent(ytKey);
      const r = await fetch(api, { signal: AbortSignal.timeout(10000) });
      if (r.ok) {
        const data = await r.json();
        for (const item of (data.items || [])) {
          const vid = item.id && item.id.videoId;
          if (vid && /^[A-Za-z0-9_-]{11}$/.test(vid)) {
            return {
              title: (item.snippet && item.snippet.title) || q,
              url: watchUrl(vid),
              id: vid,
              dur: 0,
              thumb: item.snippet && item.snippet.thumbnails && item.snippet.thumbnails.medium
                ? item.snippet.thumbnails.medium.url : null,
              source: 'youtube'
            };
          }
        }
      }
    } catch (e) {
      console.warn('YT API search', e.message);
    }
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
        thumb: v.thumbnails && v.thumbnails[0] && v.thumbnails[0].url,
        source: 'youtube'
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

  const MOODS = {
    any: { label: 'Any / Normal', emoji: '🎵', suffix: '' },
    lofi: { label: 'Lofi', emoji: '🌙', suffix: 'lofi chill beats' },
    romantic: { label: 'Romantic', emoji: '💖', suffix: 'romantic love song' },
    happy: { label: 'Happy', emoji: '😄', suffix: 'happy upbeat song' },
    sad: { label: 'Sad', emoji: '😢', suffix: 'sad emotional song' },
    party: { label: 'Party', emoji: '🎉', suffix: 'party dance song' },
    hindi: { label: 'Hindi / Bollywood', emoji: '🇮🇳', suffix: 'hindi bollywood song' }
  };

  function moodOf(st) {
    return MOODS[st.mood] ? st.mood : 'any';
  }

  function applyMood(query, moodKey) {
    const q = String(query || '').trim();
    if (!q) return q;
    if (extractId(q)) return q;
    if (parseSpotifyUrl(q)) return q;
    const m = MOODS[moodKey] || MOODS.any;
    if (!m.suffix) return q;
    const low = q.toLowerCase();
    if (m.suffix.split(' ').some((w) => w.length > 3 && low.includes(w))) return q;
    return q + ' ' + m.suffix;
  }

  function embed(st, ended) {
    const t = st.track;
    const p = Math.min(pos(st), t.dur || 0);
    const len = 18;
    const at = t.dur ? Math.min(len - 1, Math.floor((p / t.dur) * len)) : 0;
    const bar = '━'.repeat(at) + '🔵' + '━'.repeat(Math.max(0, len - 1 - at));
    const status = ended ? 'Stopped' : (st.paused ? 'Paused' : 'Playing');
    const mood = MOODS[moodOf(st)] || MOODS.any;
    const e = new EmbedBuilder()
      .setColor(ended ? 0x6b7280 : (st.paused ? 0xfbbf24 : 0xf97316))
      .setAuthor({ name: 'Mini Player · ' + status })
      .setTitle(String(t.title || 'Unknown').slice(0, 200))
      .setURL(t.spotifyUrl || t.url)
      .setDescription(
        bar + '\n`' + fmt(p) + '` / `' + (t.dur ? fmt(t.dur) : '--:--') + '`\n' +
        mood.emoji + ' Mood: **' + mood.label + '** · Search / seek / pause'
      )
      .setFooter({ text: (t.source === 'spotify' ? 'Spotify · ' : '') + 'by ' + (t.by || 'user') + ' · ek hi panel' });
    if (t.thumb) e.setThumbnail(t.thumb);
    return e;
  }

  function panelComponents(st) {
    const mood = moodOf(st);
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('mp:back').setEmoji('⏪').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('mp:pause').setEmoji(st.paused ? '▶️' : '⏸️').setLabel(st.paused ? 'Resume' : 'Pause').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('mp:play').setEmoji('🎵').setLabel('Play').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('mp:fwd').setEmoji('⏩').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('mp:stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger)
    );
    const searchRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('mp:search').setEmoji('🔍').setLabel('Search').setStyle(ButtonStyle.Success)
    );
    const select = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('mp:mood')
        .setPlaceholder((MOODS[mood] || MOODS.any).emoji + ' Mood: ' + (MOODS[mood] || MOODS.any).label)
        .addOptions(
          Object.entries(MOODS).map(([value, m]) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(m.label)
              .setValue(value)
              .setEmoji(m.emoji)
              .setDefault(value === mood)
          )
        )
    );
    return [buttons, searchRow, select];
  }

  async function refresh(st, ended) {
    if (!st.msg) return;
    try {
      await st.msg.edit({ embeds: [embed(st, ended)], components: ended ? [] : panelComponents(st) });
    } catch {
      st.msg = null;
    }
  }

  function startPanelTimer(st) {
    clearInterval(st.timer);
    st.timer = setInterval(() => {
      if (!st.track || st.paused) return;
      refresh(st).catch(() => {});
    }, 5000);
  }

  async function showPanel(st, interaction, { ephemeralOk }) {
    const payload = { embeds: [embed(st)], components: panelComponents(st) };
    if (st.msg) {
      try {
        await st.msg.edit(payload);
        startPanelTimer(st);
        return st.msg;
      } catch {
        st.msg = null;
      }
    }
    if (ephemeralOk && interaction.deferred) {
      const ch = interaction.channel;
      if (ch && ch.send) {
        st.msg = await ch.send(payload);
        startPanelTimer(st);
        return st.msg;
      }
    }
    st.msg = await interaction.editReply(payload);
    startPanelTimer(st);
    return st.msg;
  }

  function destroy(guildId) {
    const st = guilds.get(guildId);
    if (!st) return;
    guilds.delete(guildId);
    clearInterval(st.timer);
    try { st.player.stop(true); } catch {}
    try { st.connection.destroy(); } catch {}
    if (st.track) refresh(st, true);
  }

  async function ensureYtDlp() {
    if (ytdlpReady) return ytdlpReady;
    ytdlpReady = (async () => {
      try {
        if (fs.existsSync(YTDLP_BIN)) {
          const head = fs.readFileSync(YTDLP_BIN).subarray(0, 40).toString('utf8');
          if (head.startsWith('#!') || head.includes('python')) {
            fs.unlinkSync(YTDLP_BIN);
          } else {
            const st = fs.statSync(YTDLP_BIN);
            if (st.size > 5_000_000) return YTDLP_BIN;
          }
        }
      } catch {}
      const urls = [
        'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux',
        'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp_linux'
      ];
      for (const u of urls) {
        try {
          console.log('music: downloading yt-dlp_linux…');
          const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(90000) });
          if (!r.ok) continue;
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length < 5_000_000) continue;
          fs.writeFileSync(YTDLP_BIN, buf, { mode: 0o755 });
          console.log('music: yt-dlp_linux ready, bytes=', buf.length);
          return YTDLP_BIN;
        } catch (e) {
          console.warn('yt-dlp download', e.message);
        }
      }
      throw new Error('yt-dlp_linux download failed');
    })();
    try {
      return await ytdlpReady;
    } catch (e) {
      ytdlpReady = null;
      throw e;
    }
  }

  async function streamFromYtDlp(id) {
    const bin = await ensureYtDlp();
    const full = watchUrl(id);
    const cookieFile = path.join('/tmp', 'yt-cookie.txt');
    if (ytCookie) {
      try {
        fs.writeFileSync(cookieFile, '# Netscape HTTP Cookie File\n');
        for (const part of ytCookie.split(';')) {
          const i = part.indexOf('=');
          if (i < 1) continue;
          const name = part.slice(0, i).trim();
          const val = part.slice(i + 1).trim();
          if (name && val) {
            fs.appendFileSync(cookieFile, `.youtube.com\tTRUE\t/\tTRUE\t0\t${name}\t${val}\n`);
          }
        }
      } catch {}
    }

    const runs = [
      ['-f', 'bestaudio/best', '-g', '-q', '--no-warnings', '--no-playlist', '--no-check-certificates', '--geo-bypass', '--socket-timeout', '15', '--retries', '2', '--extractor-retries', '2', '--no-cache-dir', '--extractor-args', 'youtube:player_client=android'],
      ['-f', 'bestaudio/best', '-g', '-q', '--no-warnings', '--no-playlist', '--socket-timeout', '15', '--retries', '1', '--extractor-args', 'youtube:player_client=tv_embedded'],
      ['-f', 'best', '-g', '-q', '--no-warnings', '--no-playlist', '--socket-timeout', '15', '--retries', '1', '--extractor-args', 'youtube:player_client=android']
    ];

    let lastErr = null;
    for (const base of runs) {
      const args = [...base];
      if (ytCookie && fs.existsSync(cookieFile)) args.push('--cookies', cookieFile);
      args.push(full);
      try {
        const { stdout } = await execFileAsync(bin, args, { timeout: 30000, maxBuffer: 1024 * 1024 });
        const line = String(stdout || '').trim().split('\n').filter((l) => l.startsWith('http'))[0];
        if (line) return { stream: line, type: StreamType.Arbitrary, seekable: false };
      } catch (e) {
        lastErr = e;
        console.warn('yt-dlp', String((e && e.stderr) || (e && e.message) || e).slice(0, 140));
      }
    }
    throw new Error('yt-dlp stream fail: ' + String((lastErr && lastErr.message) || lastErr || 'no url').slice(0, 160));
  }

  async function openStream(url) {
    const id = extractId(url);
    if (!id) throw new Error('Invalid URL: no YouTube video id found in ' + String(url).slice(0, 80));
    const full = watchUrl(id);
    try {
      const s = await streamFromYtDlp(id);
      if (s && s.stream) return s;
    } catch (e) {
      console.warn('yt-dlp primary', String(e.message).slice(0, 120));
    }
    const attempts = [
      async () => play.stream(full, { discordPlayerCompatibility: true }),
      async () => {
        const info = await play.video_info(full);
        return await play.stream_from_info(info, { discordPlayerCompatibility: true });
      },
      async () => play.stream(full)
    ];
    let lastErr = null;
    for (const fn of attempts) {
      try {
        const s = await fn();
        if (s && s.stream) return s;
      } catch (e) {
        lastErr = e;
        console.warn('play-dl stream', String(e && e.message || e).slice(0, 120));
      }
    }
    throw new Error(String(lastErr && lastErr.message || lastErr || 'stream failed').slice(0, 160));
  }

  async function startTrack(st, sec) {
    try {
      await entersState(st.connection, VoiceConnectionStatus.Ready, 20000);
    } catch {
      throw new Error('Voice connect nahi hua (20s). Bot ko Connect + Speak permission do aur dobara try karo.');
    }
    const stream = await openStream(st.track.url);
    const resource = typeof stream.stream === 'string'
      ? createAudioResource(stream.stream, { inputType: StreamType.Arbitrary })
      : createAudioResource(stream.stream, { inputType: stream.type || StreamType.Arbitrary });
    st.player.play(resource);
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
      offset: 0, playStart: null, paused: false, track: null, msg: null, timer: null, queue: [], mood: 'any'
    };
    connection.on('stateChange', (o, n) => console.log('voice', guild.id, o.status, '->', n.status));
    connection.on('error', (e) => console.error('voice error', e.message));
    player.on('stateChange', (o, n) => console.log('player', guild.id, o.status, '->', n.status));
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
    let st = guilds.get(i.guildId);
    if (!st) st = create(i.guild, vc);
    else if (st.channelId !== vc.id) {
      const prevMood = st.mood;
      destroy(i.guildId);
      st = create(i.guild, vc);
      if (prevMood) st.mood = prevMood;
    }
    const q = applyMood(query, moodOf(st));
    const v = await resolveVideo(q);
    st.track = { title: v.title, url: v.url, id: v.id, dur: v.dur, thumb: v.thumb, by: i.user.username, source: v.source || 'youtube', spotifyUrl: v.spotifyUrl || null };
    await startTrack(st, 0);
    return st;
  }

  async function onPlay(i) {
    const resolved = resolveVC(i);
    if (resolved.error) return i.reply({ content: resolved.error, flags: MessageFlags.Ephemeral });
    const err = canJoin(resolved.channel, i.guild.members.me);
    if (err) return i.reply({ content: err, flags: MessageFlags.Ephemeral });
    const existing = guilds.get(i.guildId);
    const hasPanel = !!(existing && existing.msg);
    await i.deferReply(hasPanel ? { flags: MessageFlags.Ephemeral } : undefined);
    try {
      const st = await playIn(i, i.options.getString('query', true), resolved.channel);
      await showPanel(st, i, { ephemeralOk: hasPanel });
      if (hasPanel) await i.editReply({ content: '▶ **' + String(st.track.title).slice(0, 80) + '**' }).catch(() => {});
    } catch (e) {
      console.error('play', e.message);
      if (!hasPanel) destroy(i.guildId);
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
          return i.reply({ content: 'Stopped.', flags: MessageFlags.Ephemeral });
        }
      }

      if (i.isModalSubmit() && i.customId === 'mp:searchmodal') {
        const q = i.fields.getTextInputValue('q');
        const vc = i.member && i.member.voice && i.member.voice.channel;
        if (!vc) return i.reply({ content: 'Pehle voice channel me join karo.', flags: MessageFlags.Ephemeral });
        const err = canJoin(vc, i.guild.members.me);
        if (err) return i.reply({ content: err, flags: MessageFlags.Ephemeral });
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        try {
          const st = await playIn(i, q, vc);
          await showPanel(st, i, { ephemeralOk: true });
          await i.editReply({ content: '▶ **' + String(st.track.title).slice(0, 80) + '**' }).catch(() => {});
        } catch (e) {
          console.error('search play', e.message);
          await i.editReply('Play error: ' + String(e.message).slice(0, 280)).catch(() => {});
        }
        return;
      }

      if (i.isStringSelectMenu() && i.customId === 'mp:mood') {
        const st = guilds.get(i.guildId);
        if (!st) return i.reply({ content: 'Pehle /play chalao.', flags: MessageFlags.Ephemeral });
        st.mood = i.values[0] || 'any';
        await i.deferUpdate();
        await refresh(st);
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
                .setLabel('Song, YouTube, or Spotify link')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('name, youtube.com/..., or open.spotify.com/track/...')
            )
          );
          return i.showModal(modal);
        }
        if (act === 'play') {
          const modal = new ModalBuilder().setCustomId('mp:searchmodal').setTitle('Play song');
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('q')
                .setLabel('Song, YouTube, or Spotify link')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
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
          await refresh(st);
        } catch (e) {
          console.error('button', e.message);
        }
      }
    } catch (e) {
      console.error('music interaction', e.message);
    }
  });
}
