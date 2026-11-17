import { Events, EmbedBuilder, MessageFlags, ChannelType } from 'discord.js';
import { getSettings, saveSettings, MANAGE } from './util.js';

export const commands = [
  { name: 'meme', description: 'Random meme', dm_permission: false },
  {
    name: 'memes',
    description: 'Auto memes by source every N seconds',
    default_member_permissions: MANAGE,
    dm_permission: false,
    options: [
      {
        name: 'set',
        description: 'Enable auto memes — posts start immediately',
        type: 1,
        options: [
          { name: 'channel', description: 'Memes channel', type: 7, required: true, channel_types: [ChannelType.GuildText] },
          {
            name: 'source',
            description: 'ONLY this source will be used',
            type: 3,
            required: true,
            choices: [
              { name: 'YouTube videos only', value: 'youtube' },
              { name: 'Reddit images/videos only', value: 'reddit' },
              { name: 'Google-style images only', value: 'google' },
              { name: 'All sources mixed', value: 'all' }
            ]
          },
          {
            name: 'seconds',
            description: 'Seconds between posts (default 20, min 15)',
            type: 4,
            required: false,
            min_value: 15,
            max_value: 3600
          }
        ]
      },
      { name: 'off', description: 'Stop auto memes', type: 1 },
      { name: 'status', description: 'Show settings', type: 1 }
    ]
  }
];

const UA = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  accept: 'application/json'
};

const REDDIT_SUBS = ['memes','dankmemes','IndianDankMemes','indianmemes','IndianMeyMeys','bakchodi','funny','me_irl'];
const YT_QUERIES = [
  'indian memes funny',
  'desi memes hindi',
  'viral indian meme',
  'funny memes short',
  'hindi comedy meme',
  'dank indian memes'
];

function isImage(url) {
  return /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(String(url || ''));
}

function extractYtId(s) {
  const m = String(s || '').match(/(?:v=|youtu\.be\/|shorts\/|\/watch\?v=)?([A-Za-z0-9_-]{11})/);
  return m && /^[A-Za-z0-9_-]{11}$/.test(m[1]) ? m[1] : null;
}

async function fromReddit() {
  const sub = REDDIT_SUBS[Math.floor(Math.random() * REDDIT_SUBS.length)];
  const r = await fetch('https://www.reddit.com/r/' + sub + '/hot.json?limit=40', { headers: UA });
  if (!r.ok) return null;
  const j = await r.json();
  const posts = (j.data && j.data.children || []).map((c) => c.data).filter((p) => p && !p.over_18 && !p.spoiler);
  const out = [];
  for (const p of posts) {
    const link = p.url_overridden_by_dest || p.url || '';
    if (p.is_video && p.media && p.media.reddit_video && p.media.reddit_video.fallback_url) {
      out.push({ kind: 'video', title: p.title, url: p.media.reddit_video.fallback_url.split('?')[0], source: 'Reddit · r/' + p.subreddit });
      continue;
    }
    if (isImage(link) || p.post_hint === 'image') {
      out.push({ kind: 'image', title: p.title, url: link, source: 'Reddit · r/' + p.subreddit });
    }
  }
  if (!out.length) return null;
  return out[Math.floor(Math.random() * out.length)];
}

async function fromYouTube() {
  const q = YT_QUERIES[Math.floor(Math.random() * YT_QUERIES.length)];
  const bases = [
    'https://api.piped.private.coffee/search?q=',
    'https://pipedapi.adminforge.de/search?q='
  ];
  for (const base of bases) {
    try {
      const r = await fetch(base + encodeURIComponent(q) + '&filter=videos', {
        headers: UA,
        signal: AbortSignal.timeout(12000)
      });
      if (!r.ok) continue;
      const data = await r.json();
      const items = Array.isArray(data) ? data : (data.items || []);
      const vids = [];
      for (const v of items) {
        if (v.type && v.type !== 'stream' && v.type !== 'video') continue;
        const id = extractYtId(v.url) || extractYtId(v.id) || extractYtId(v.videoId);
        if (!id) continue;
        vids.push({
          kind: 'youtube',
          title: v.title || v.name || q,
          url: 'https://www.youtube.com/watch?v=' + id,
          source: 'YouTube · ' + q,
          thumb: v.thumbnail || null
        });
      }
      if (vids.length) {
        console.log('memes yt ok', q, vids.length);
        return vids[Math.floor(Math.random() * Math.min(vids.length, 15))];
      }
    } catch (e) {
      console.warn('memes yt', base, e.message);
    }
  }
  return null;
}

async function fromGoogle() {
  try {
    const sub = ['memes', 'dankmemes', 'IndianDankMemes'][Math.floor(Math.random() * 3)];
    const r = await fetch('https://meme-api.com/gimme/' + sub, { headers: UA });
    if (r.ok) {
      const m = await r.json();
      if (m && m.url && !m.nsfw && isImage(m.url)) {
        return { kind: 'image', title: m.title || 'Meme', url: m.url, source: 'Google-style · images' };
      }
    }
  } catch {}
  try {
    const r = await fetch('https://api.imgflip.com/get_memes', { headers: UA });
    if (r.ok) {
      const j = await r.json();
      const memes = (j.data && j.data.memes) || [];
      if (memes.length) {
        const m = memes[Math.floor(Math.random() * Math.min(40, memes.length))];
        return { kind: 'image', title: m.name || 'Meme', url: m.url, source: 'Google-style · Imgflip' };
      }
    }
  } catch {}
  return null;
}

async function getMeme(source) {
  const src = String(source || 'all').toLowerCase();
  const attempts = src === 'youtube' ? 8 : 5;
  for (let i = 0; i < attempts; i++) {
    try {
      let m = null;
      if (src === 'youtube') m = await fromYouTube();
      else if (src === 'reddit') m = await fromReddit();
      else if (src === 'google') m = await fromGoogle();
      else {
        const fns = [fromReddit, fromYouTube, fromGoogle];
        m = await fns[i % fns.length]();
      }
      if (m && m.url) return m;
    } catch (e) {
      console.warn('getMeme', src, e.message);
    }
  }
  return null;
}

function embedOf(m) {
  const e = new EmbedBuilder()
    .setColor(0xf97316)
    .setTitle(String(m.title || 'Meme').slice(0, 250))
    .setFooter({ text: String(m.source || 'meme').slice(0, 100) });
  if (m.kind === 'image') e.setImage(m.url);
  if (m.kind === 'youtube' && m.thumb) e.setThumbnail(m.thumb);
  if (m.kind === 'youtube' || m.kind === 'video') e.setDescription('▶ ' + m.url);
  return e;
}

async function sendMeme(channel, m) {
  if (!m) return false;
  if (m.kind === 'youtube') {
    await channel.send({ content: '**' + String(m.title).slice(0, 180) + '**\n' + m.url + '\n_' + m.source + '_' });
    return true;
  }
  if (m.kind === 'video') {
    try {
      await channel.send({
        content: '**' + String(m.title).slice(0, 180) + '**\n_' + m.source + '_',
        files: [{ attachment: m.url, name: 'meme.mp4' }]
      });
    } catch {
      await channel.send({ content: '**' + String(m.title).slice(0, 180) + '**\n' + m.url + '\n_' + m.source + '_' });
    }
    return true;
  }
  await channel.send({ embeds: [embedOf(m)] });
  return true;
}

export function attach(client) {
  const last = new Map();

  async function postOnce(guildId, force) {
    const s = await getSettings(guildId);
    const c = s.memes;
    if (!c || !c.enabled || !c.channelId) return;
    const every = Math.max(15, Number(c.intervalSec) || 20) * 1000;
    const now = Date.now();
    if (!force && last.has(guildId) && now - last.get(guildId) < every) return;
    last.set(guildId, now);
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const ch = guild.channels.cache.get(c.channelId);
    if (!ch || !ch.isTextBased()) return;
    const m = await getMeme(c.source || 'all');
    if (m) {
      await sendMeme(ch, m).catch((e) => console.error('meme send', e.message));
    } else {
      console.warn('memes: no result source=' + (c.source || 'all'));
    }
  }

  client.on(Events.InteractionCreate, async (i) => {
    try {
      if (i.isChatInputCommand() && i.commandName === 'meme') {
        await i.deferReply();
        const m = await getMeme('all');
        if (!m) return i.editReply('Meme nahi mila.');
        if (m.kind === 'youtube') return i.editReply({ content: '**' + String(m.title).slice(0, 180) + '**\n' + m.url + '\n_' + m.source + '_' });
        if (m.kind === 'video') {
          try {
            return await i.editReply({ content: '**' + String(m.title).slice(0, 180) + '**\n_' + m.source + '_', files: [{ attachment: m.url, name: 'meme.mp4' }] });
          } catch {
            return i.editReply({ content: '**' + String(m.title).slice(0, 180) + '**\n' + m.url });
          }
        }
        return i.editReply({ embeds: [embedOf(m)] });
      }
      if (!i.isChatInputCommand() || i.commandName !== 'memes') return;
      const s = await getSettings(i.guildId);
      s.memes = s.memes || {};
      const sub = i.options.getSubcommand();
      if (sub === 'set') {
        const ch = i.options.getChannel('channel', true);
        const source = i.options.getString('source', true);
        const seconds = i.options.getInteger('seconds') || 20;
        s.memes = {
          enabled: true,
          channelId: ch.id,
          source,
          intervalSec: Math.max(15, Math.min(3600, seconds))
        };
        await saveSettings(i.guildId, s);
        await i.reply({
          content:
            'Auto memes **ON** ' + ch + '\n' +
            'Source locked: **' + source + '**\n' +
            'Every **' + s.memes.intervalSec + 's** — posting now…',
          flags: MessageFlags.Ephemeral
        });
        postOnce(i.guildId, true).catch((e) => console.error('meme first', e.message));
        return;
      }
      if (sub === 'off') {
        s.memes.enabled = false;
        await saveSettings(i.guildId, s);
        return i.reply({ content: 'Auto memes off.', flags: MessageFlags.Ephemeral });
      }
      if (sub === 'status') {
        const c = s.memes;
        return i.reply({
          content:
            '**Auto Memes**\nEnabled: ' + (c && c.enabled ? 'Yes' : 'No') +
            '\nChannel: ' + (c && c.channelId ? '<#' + c.channelId + '>' : '—') +
            '\nSource: **' + ((c && c.source) || 'all') + '**' +
            '\nInterval: ' + ((c && c.intervalSec) || 20) + 's',
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (e) {
      console.error('meme cmd', e.message);
    }
  });

  client.once(Events.ClientReady, () => {
    setInterval(async () => {
      for (const g of client.guilds.cache.values()) {
        try { await postOnce(g.id, false); } catch (e) { console.error('memes tick', e.message); }
      }
    }, 5000);
  });
}
