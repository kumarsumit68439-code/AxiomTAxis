import { Events, EmbedBuilder, MessageFlags, ChannelType } from 'discord.js';
import { getSettings, saveSettings, MANAGE } from './util.js';

export const commands = [
  { name: 'meme', description: 'Get a random meme (image / video / YouTube)', dm_permission: false },
  {
    name: 'memes',
    description: 'Auto-meme every N minutes (Reddit + YouTube + images)',
    default_member_permissions: MANAGE,
    dm_permission: false,
    options: [
      {
        name: 'set',
        description: 'Enable auto memes in a channel',
        type: 1,
        options: [
          { name: 'channel', description: 'Channel for auto memes', type: 7, required: true, channel_types: [ChannelType.GuildText] },
          { name: 'minutes', description: 'Interval minutes (default 1)', type: 4, required: false, min_value: 1, max_value: 1440 }
        ]
      },
      { name: 'off', description: 'Disable auto memes', type: 1 },
      { name: 'status', description: 'Show auto-meme settings', type: 1 }
    ]
  }
];

const UA = { 'user-agent': 'AxiomTAxisBot/1.0 (discord-bot; +https://github.com/kumarsumit68439-code/AxiomTAxis)' };

const REDDIT_SUBS = [
  'memes', 'dankmemes', 'funny', 'me_irl', 'wholesomememes', 'ComedyCemetery',
  'IndianDankMemes', 'indianmemes', 'IndianMeyMeys', 'bakchodi', 'SaimanSays',
  'memes', 'okbuddyretard', 'shitposting', 'ProgrammerHumor'
];

const YT_QUERIES = [
  'indian memes compilation',
  'desi memes funny',
  'hindi funny memes',
  'viral indian meme',
  'funny memes 2024',
  'meme review short',
  'comedy memes india'
];

function isImage(url) {
  return /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(String(url || ''));
}

async function fromMemeApi() {
  const r = await fetch('https://meme-api.com/gimme', { headers: UA });
  if (!r.ok) return null;
  const m = await r.json();
  if (!m || !m.url || m.nsfw || m.spoiler) return null;
  return {
    kind: isImage(m.url) ? 'image' : 'link',
    title: m.title || 'Meme',
    url: m.url,
    postLink: m.postLink || null,
    source: 'r/' + (m.subreddit || 'memes')
  };
}

async function fromReddit() {
  const sub = REDDIT_SUBS[Math.floor(Math.random() * REDDIT_SUBS.length)];
  const r = await fetch('https://www.reddit.com/r/' + sub + '/hot.json?limit=40', { headers: UA });
  if (!r.ok) return null;
  const j = await r.json();
  const posts = (j.data && j.data.children || []).map((c) => c.data).filter((p) => p && !p.over_18 && !p.spoiler);
  if (!posts.length) return null;

  const scored = [];
  for (const p of posts) {
    const link = p.url_overridden_by_dest || p.url || '';
    const yt = link.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/))([A-Za-z0-9_-]{6,})/);
    if (yt) {
      scored.push({
        kind: 'youtube',
        title: p.title,
        url: 'https://www.youtube.com/watch?v=' + yt[1],
        postLink: 'https://reddit.com' + p.permalink,
        source: 'r/' + p.subreddit + ' · YouTube'
      });
      continue;
    }
    if (p.is_video && p.media && p.media.reddit_video && p.media.reddit_video.fallback_url) {
      scored.push({
        kind: 'video',
        title: p.title,
        url: p.media.reddit_video.fallback_url.split('?')[0],
        postLink: 'https://reddit.com' + p.permalink,
        source: 'r/' + p.subreddit + ' · video'
      });
      continue;
    }
    if (isImage(link) || (p.post_hint === 'image' && link)) {
      scored.push({
        kind: 'image',
        title: p.title,
        url: link,
        postLink: 'https://reddit.com' + p.permalink,
        source: 'r/' + p.subreddit
      });
    }
  }
  if (!scored.length) return null;
  return scored[Math.floor(Math.random() * scored.length)];
}

async function fromYouTube() {
  const q = YT_QUERIES[Math.floor(Math.random() * YT_QUERIES.length)];
  const instances = [
    'https://piped.video/api/v1/search?q=',
    'https://pipedapi.kavin.rocks/api/v1/search?q='
  ];
  for (const base of instances) {
    try {
      const r = await fetch(base + encodeURIComponent(q) + '&filter=videos', {
        headers: UA,
        signal: AbortSignal.timeout(8000)
      });
      if (!r.ok) continue;
      const list = await r.json();
      const vids = (Array.isArray(list) ? list : []).filter((v) => v && (v.url || v.id) && v.title);
      if (!vids.length) continue;
      const v = vids[Math.floor(Math.random() * Math.min(12, vids.length))];
      const id = v.id || String(v.url || '').replace(/^\/watch\?v=/, '').replace(/.*v=/, '').slice(0, 20);
      const url = id.startsWith('http') ? id : 'https://www.youtube.com/watch?v=' + id;
      return {
        kind: 'youtube',
        title: v.title || q,
        url,
        postLink: url,
        source: 'YouTube · ' + q,
        thumb: v.thumbnail || (v.thumbnails && v.thumbnails[0] && v.thumbnails[0].url) || null
      };
    } catch {}
  }
  return null;
}

async function getMeme() {
  const order = [fromReddit, fromMemeApi, fromYouTube, fromReddit, fromMemeApi];
  for (const fn of order) {
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
  if (m.postLink) e.setURL(m.postLink);
  if (m.kind === 'image' && m.url) e.setImage(m.url);
  if (m.kind === 'youtube' && m.thumb) e.setThumbnail(m.thumb);
  if (m.kind === 'youtube' || m.kind === 'video') {
    e.setDescription((m.kind === 'youtube' ? '▶ YouTube meme\n' : '▶ Video meme\n') + m.url);
  }
  return e;
}

async function sendMeme(channel, m) {
  if (!m) return false;
  if (m.kind === 'youtube') {
    await channel.send({ content: `**${String(m.title).slice(0, 200)}**\n${m.url}\n_${m.source}_` });
    return true;
  }
  if (m.kind === 'video') {
    await channel.send({
      content: `**${String(m.title).slice(0, 200)}**\n_${m.source}_`,
      files: [{ attachment: m.url, name: 'meme.mp4' }]
    }).catch(async () => {
      await channel.send({ content: `**${String(m.title).slice(0, 200)}**\n${m.url}\n_${m.source}_` });
    });
    return true;
  }
  await channel.send({ embeds: [embedOf(m)] });
  return true;
}

export function attach(client) {
  client.on(Events.InteractionCreate, async (i) => {
    try {
      if (i.isChatInputCommand() && i.commandName === 'meme') {
        await i.deferReply();
        const m = await getMeme();
        if (!m) return i.editReply('Meme nahi mila, thodi der baad try karo.');
        if (m.kind === 'youtube') {
          return i.editReply({ content: `**${String(m.title).slice(0, 200)}**\n${m.url}\n_${m.source}_` });
        }
        if (m.kind === 'video') {
          try {
            return await i.editReply({
              content: `**${String(m.title).slice(0, 200)}**\n_${m.source}_`,
              files: [{ attachment: m.url, name: 'meme.mp4' }]
            });
          } catch {
            return i.editReply({ content: `**${String(m.title).slice(0, 200)}**\n${m.url}\n_${m.source}_` });
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
        const mins = i.options.getInteger('minutes') || 1;
        s.memes = { enabled: true, channelId: ch.id, intervalMin: Math.max(1, Math.min(1440, mins)) };
        await saveSettings(i.guildId, s);
        return i.reply({
          content: `Auto memes **on** in ${ch} every **${s.memes.intervalMin}** min.\nSources: Reddit (India + global) · meme-api · YouTube.`,
          flags: MessageFlags.Ephemeral
        });
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
            `**Auto Memes**\nEnabled: ${c && c.enabled ? 'Yes' : 'No'}\nChannel: ${c && c.channelId ? '<#' + c.channelId + '>' : '—'}\nInterval: ${c && c.intervalMin ? c.intervalMin : 1} min\nSources: Reddit + images + YouTube`,
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (e) {
      console.error('meme cmd', e.message);
    }
  });

  const last = new Map();
  client.once(Events.ClientReady, () => {
    setInterval(async () => {
      for (const guild of client.guilds.cache.values()) {
        try {
          const s = await getSettings(guild.id);
          const c = s.memes;
          if (!c || !c.enabled || !c.channelId) continue;
          const every = Math.max(1, Number(c.intervalMin) || 1) * 60000;
          const now = Date.now();
          if (!last.has(guild.id)) {
            last.set(guild.id, now);
            continue;
          }
          if (now - last.get(guild.id) < every) continue;
          last.set(guild.id, now);
          const ch = guild.channels.cache.get(c.channelId);
          if (!ch || !ch.isTextBased()) continue;
          const m = await getMeme();
          if (m) await sendMeme(ch, m).catch((e) => console.error('meme send', e.message));
        } catch (e) {
          console.error('memes tick', e.message);
        }
      }
    }, 30000);
  });
}
