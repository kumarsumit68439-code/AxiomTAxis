import { Events, EmbedBuilder, MessageFlags, ChannelType } from 'discord.js';
import { getSettings, saveSettings, MANAGE } from './util.js';

export const commands = [
  { name: 'meme', description: 'Random meme (Reddit / YouTube / Google-style)', dm_permission: false },
  {
    name: 'memes',
    description: 'Auto memes every few seconds after channel is set',
    default_member_permissions: MANAGE,
    dm_permission: false,
    options: [
      {
        name: 'set',
        description: 'Enable auto memes — starts sending immediately',
        type: 1,
        options: [
          { name: 'channel', description: 'Memes channel', type: 7, required: true, channel_types: [ChannelType.GuildText] },
          {
            name: 'source',
            description: 'Where to pull memes from',
            type: 3,
            required: false,
            choices: [
              { name: 'All (Reddit + YouTube + Google)', value: 'all' },
              { name: 'Reddit only (images + videos)', value: 'reddit' },
              { name: 'YouTube only (video links)', value: 'youtube' },
              { name: 'Google-style only (images + GIFs + links)', value: 'google' }
            ]
          },
          {
            name: 'seconds',
            description: 'Interval in seconds (default 20, min 15)',
            type: 4,
            required: false,
            min_value: 15,
            max_value: 3600
          }
        ]
      },
      { name: 'off', description: 'Disable auto memes', type: 1 },
      { name: 'status', description: 'Show auto-meme settings', type: 1 }
    ]
  }
];

const UA = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
};

const REDDIT_SUBS = [
  'memes', 'dankmemes', 'funny', 'me_irl', 'wholesomememes',
  'IndianDankMemes', 'indianmemes', 'IndianMeyMeys', 'bakchodi', 'SaimanSays',
  'shitposting', 'ProgrammerHumor', 'memes'
];

const YT_QUERIES = [
  'indian memes funny',
  'desi memes hindi',
  'viral indian meme short',
  'funny memes compilation',
  'hindi comedy meme',
  'meme review india',
  'relatable indian memes'
];

function isImage(url) {
  return /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(String(url || ''));
}

async function fromReddit() {
  const sub = REDDIT_SUBS[Math.floor(Math.random() * REDDIT_SUBS.length)];
  const sort = Math.random() > 0.5 ? 'hot' : 'rising';
  const r = await fetch('https://www.reddit.com/r/' + sub + '/' + sort + '.json?limit=40', { headers: UA });
  if (!r.ok) return null;
  const j = await r.json();
  const posts = (j.data && j.data.children || []).map((c) => c.data).filter((p) => p && !p.over_18 && !p.spoiler);
  const scored = [];
  for (const p of posts) {
    const link = p.url_overridden_by_dest || p.url || '';
    const yt = link.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/))([A-Za-z0-9_-]{6,})/);
    if (yt) {
      scored.push({
        kind: 'youtube',
        title: p.title,
        url: 'https://www.youtube.com/watch?v=' + yt[1],
        source: 'Reddit · r/' + p.subreddit
      });
      continue;
    }
    if (p.is_video && p.media && p.media.reddit_video && p.media.reddit_video.fallback_url) {
      scored.push({
        kind: 'video',
        title: p.title,
        url: p.media.reddit_video.fallback_url.split('?')[0],
        source: 'Reddit · r/' + p.subreddit + ' · video'
      });
      continue;
    }
    if (p.is_gallery && p.media_metadata) {
      const first = Object.values(p.media_metadata)[0];
      const u = first && first.s && (first.s.u || first.s.gif);
      if (u) {
        scored.push({
          kind: 'image',
          title: p.title,
          url: String(u).replace(/&amp;/g, '&'),
          source: 'Reddit · r/' + p.subreddit
        });
        continue;
      }
    }
    if (isImage(link) || p.post_hint === 'image') {
      scored.push({
        kind: 'image',
        title: p.title,
        url: link,
        source: 'Reddit · r/' + p.subreddit
      });
    }
  }
  if (!scored.length) return null;
  return scored[Math.floor(Math.random() * scored.length)];
}

async function fromYouTube() {
  const q = YT_QUERIES[Math.floor(Math.random() * YT_QUERIES.length)];
  const bases = [
    'https://pipedapi.kavin.rocks/search?q=',
    'https://piped.video/api/v1/search?q=',
    'https://invidious.fdn.fr/api/v1/search?q='
  ];
  for (const base of bases) {
    try {
      const r = await fetch(base + encodeURIComponent(q), {
        headers: UA,
        signal: AbortSignal.timeout(9000)
      });
      if (!r.ok) continue;
      const list = await r.json();
      const arr = Array.isArray(list) ? list : (list.items || []);
      const vids = arr.filter((v) => {
        const t = String(v.type || v.videoType || '').toLowerCase();
        return (v.videoId || v.id || v.url) && (v.title || v.name) && (!t || t.includes('video'));
      });
      if (!vids.length) continue;
      const v = vids[Math.floor(Math.random() * Math.min(15, vids.length))];
      let id = v.videoId || v.id;
      if (!id && v.url) {
        const m = String(v.url).match(/([A-Za-z0-9_-]{11})/);
        id = m && m[1];
      }
      if (!id || String(id).length < 6) continue;
      id = String(id).replace(/^\/watch\?v=/, '').slice(0, 11);
      const url = 'https://www.youtube.com/watch?v=' + id;
      return {
        kind: 'youtube',
        title: v.title || v.name || q,
        url,
        source: 'YouTube · ' + q,
        thumb: v.thumbnail || (v.videoThumbnails && v.videoThumbnails[0] && v.videoThumbnails[0].url) || null
      };
    } catch {}
  }
  return null;
}

async function fromGoogle() {
  // Free image/meme APIs (official Google CSE needs a paid key)
  try {
    const subs = ['memes', 'dankmemes', 'IndianDankMemes', 'funny'];
    const sub = subs[Math.floor(Math.random() * subs.length)];
    const r = await fetch('https://meme-api.com/gimme/' + sub, { headers: UA });
    if (r.ok) {
      const m = await r.json();
      if (m && m.url && !m.nsfw) {
        return {
          kind: isImage(m.url) ? 'image' : 'link',
          title: m.title || 'Meme',
          url: m.url,
          source: 'Google-style · meme feed'
        };
      }
    }
  } catch {}
  try {
    const r = await fetch('https://api.imgflip.com/get_memes', { headers: UA });
    if (r.ok) {
      const j = await r.json();
      const memes = (j.data && j.data.memes) || [];
      if (memes.length) {
        const m = memes[Math.floor(Math.random() * Math.min(50, memes.length))];
        return {
          kind: 'image',
          title: m.name || 'Meme',
          url: m.url,
          source: 'Google-style · Imgflip'
        };
      }
    }
  } catch {}
  return null;
}

async function getMeme(source) {
  const src = String(source || 'all').toLowerCase();
  const pools = {
    reddit: [fromReddit, fromReddit],
    youtube: [fromYouTube, fromYouTube, fromYouTube],
    google: [fromGoogle, fromGoogle, fromReddit],
    all: [fromReddit, fromYouTube, fromGoogle, fromReddit, fromYouTube]
  };
  const order = (pools[src] || pools.all).slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
  }
  for (const fn of order) {
    try {
      const m = await fn();
      if (m && m.url) return m;
    } catch {}
  }
  for (const fn of [fromReddit, fromGoogle, fromYouTube]) {
    try {
      const m = await fn();
      if (m && m.url) return m;
    } catch {}
  }
  return null;
}

function embedOf(m) {
  const e = new EmbedBuilder()
    .setColor(0xf97316)
    .setTitle(String(m.title || 'Meme').slice(0, 250))
    .setFooter({ text: String(m.source || 'meme').slice(0, 100) });
  if (m.kind === 'image' && m.url) e.setImage(m.url);
  if (m.kind === 'youtube' && m.thumb) e.setThumbnail(m.thumb);
  if (m.kind === 'youtube' || m.kind === 'video' || m.kind === 'link') {
    e.setDescription((m.kind === 'youtube' ? '▶ YouTube\n' : m.kind === 'video' ? '▶ Video\n' : '') + m.url);
  }
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
  if (m.kind === 'link') {
    await channel.send({ content: '**' + String(m.title).slice(0, 180) + '**\n' + m.url + '\n_' + m.source + '_' });
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
    if (!force) {
      if (last.has(guildId) && now - last.get(guildId) < every) return;
    }
    last.set(guildId, now);
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const ch = guild.channels.cache.get(c.channelId);
    if (!ch || !ch.isTextBased()) return;
    const m = await getMeme(c.source || 'all');
    if (m) await sendMeme(ch, m).catch((e) => console.error('meme send', e.message));
  }

  client.on(Events.InteractionCreate, async (i) => {
    try {
      if (i.isChatInputCommand() && i.commandName === 'meme') {
        await i.deferReply();
        const m = await getMeme('all');
        if (!m) return i.editReply('Meme nahi mila, thodi der baad try karo.');
        if (m.kind === 'youtube' || m.kind === 'link') {
          return i.editReply({ content: '**' + String(m.title).slice(0, 180) + '**\n' + m.url + '\n_' + m.source + '_' });
        }
        if (m.kind === 'video') {
          try {
            return await i.editReply({
              content: '**' + String(m.title).slice(0, 180) + '**\n_' + m.source + '_',
              files: [{ attachment: m.url, name: 'meme.mp4' }]
            });
          } catch {
            return i.editReply({ content: '**' + String(m.title).slice(0, 180) + '**\n' + m.url + '\n_' + m.source + '_' });
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
        const source = i.options.getString('source') || 'all';
        const seconds = i.options.getInteger('seconds') || 20;
        s.memes = {
          enabled: true,
          channelId: ch.id,
          source,
          intervalSec: Math.max(15, Math.min(3600, seconds)),
          intervalMin: 1
        };
        await saveSettings(i.guildId, s);
        await i.reply({
          content:
            'Auto memes **ON** in ' + ch + '\n' +
            'Source: **' + source + '** · every **' + s.memes.intervalSec + 's**\n' +
            'Pehla meme abhi bhej raha hoon…',
          flags: MessageFlags.Ephemeral
        });
        setTimeout(() => postOnce(i.guildId, true), 1500);
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
            '\nSource: ' + ((c && c.source) || 'all') +
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
      for (const guild of client.guilds.cache.values()) {
        try {
          await postOnce(guild.id, false);
        } catch (e) {
          console.error('memes tick', e.message);
        }
      }
    }, 5000);
  });
}
