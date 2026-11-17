import { Events, EmbedBuilder, MessageFlags, ChannelType } from 'discord.js';
import { getSettings, saveSettings, MANAGE } from './util.js';

export const commands = [
  { name: 'meme', description: 'Random meme', dm_permission: false },
  {
    name: 'memes',
    description: 'Auto memes every N seconds (locked source/country/type)',
    default_member_permissions: MANAGE,
    dm_permission: false,
    options: [
      {
        name: 'set',
        description: 'Enable auto memes — posts start and keep repeating',
        type: 1,
        options: [
          { name: 'channel', description: 'Memes channel', type: 7, required: true, channel_types: [ChannelType.GuildText] },
          {
            name: 'source',
            description: 'Media source (locked)',
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
            name: 'country',
            description: 'Country / region (locked)',
            type: 3,
            required: true,
            choices: [
              { name: 'India', value: 'india' },
              { name: 'USA', value: 'usa' },
              { name: 'UK', value: 'uk' },
              { name: 'Global (all countries)', value: 'global' }
            ]
          },
          {
            name: 'type',
            description: 'Meme style (locked)',
            type: 3,
            required: true,
            choices: [
              { name: 'Funny / comedy', value: 'funny' },
              { name: 'CID / crime show memes (India)', value: 'cid' },
              { name: 'Roast / gali style', value: 'roast' },
              { name: 'Dank', value: 'dank' },
              { name: 'Wholesome', value: 'wholesome' },
              { name: 'All types', value: 'any' }
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

const SUBS = {
  india: {
    funny: ['indianmemes', 'IndianDankMemes', 'IndianMeyMeys', 'bakchodi', 'SaimanSays'],
    cid: ['IndianDankMemes', 'indianmemes', 'bollywoodmemes', 'bakchodi'],
    roast: ['IndianDankMemes', 'bakchodi', 'IndianMeyMeys'],
    dank: ['IndianDankMemes', 'IndianMeyMeys'],
    wholesome: ['wholesomememes', 'indianmemes'],
    any: ['IndianDankMemes', 'indianmemes', 'bakchodi', 'IndianMeyMeys', 'SaimanSays']
  },
  usa: {
    funny: ['memes', 'funny', 'me_irl'],
    cid: ['memes', 'dankmemes'],
    roast: ['roastme', 'dankmemes'],
    dank: ['dankmemes', 'okbuddyretard'],
    wholesome: ['wholesomememes'],
    any: ['memes', 'dankmemes', 'funny']
  },
  uk: {
    funny: ['britishproblems', 'memes', 'funny'],
    cid: ['memes'],
    roast: ['roastme', 'dankmemes'],
    dank: ['dankmemes'],
    wholesome: ['wholesomememes'],
    any: ['memes', 'funny', 'britishproblems']
  },
  global: {
    funny: ['memes', 'funny', 'me_irl', 'IndianDankMemes'],
    cid: ['IndianDankMemes', 'memes'],
    roast: ['dankmemes', 'roastme', 'bakchodi'],
    dank: ['dankmemes', 'okbuddyretard', 'IndianDankMemes'],
    wholesome: ['wholesomememes'],
    any: ['memes', 'dankmemes', 'IndianDankMemes', 'funny', 'me_irl']
  }
};

const YT_Q = {
  india: {
    funny: ['indian funny memes', 'desi comedy memes', 'hindi funny video memes'],
    cid: ['CID memes india', 'cid acp pradyuman meme', 'cid funny moments meme'],
    roast: ['indian roast meme', 'desi gali comedy meme', 'hindi roast funny'],
    dank: ['indian dank memes', 'desi dank meme'],
    wholesome: ['indian wholesome meme'],
    any: ['indian memes funny', 'desi memes', 'hindi meme compilation']
  },
  usa: {
    funny: ['funny memes', 'american memes'],
    cid: ['crime meme funny'],
    roast: ['roast memes'],
    dank: ['dank memes'],
    wholesome: ['wholesome memes'],
    any: ['funny memes compilation']
  },
  uk: {
    funny: ['british memes funny'],
    cid: ['british comedy meme'],
    roast: ['british roast meme'],
    dank: ['uk dank memes'],
    wholesome: ['wholesome memes'],
    any: ['british memes']
  },
  global: {
    funny: ['funny memes', 'comedy memes'],
    cid: ['crime show memes', 'CID memes india'],
    roast: ['roast memes funny'],
    dank: ['dank memes'],
    wholesome: ['wholesome memes'],
    any: ['viral memes', 'funny memes compilation', 'indian memes']
  }
};

function isImage(url) {
  return /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(String(url || ''));
}

function extractYtId(s) {
  const m = String(s || '').match(/(?:\/watch\?v=|youtu\.be\/|shorts\/|v=)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function fromReddit(country, type) {
  const subs = (SUBS[country] || SUBS.global)[type] || SUBS.global.any;
  const sub = pick(subs);
  const r = await fetch('https://www.reddit.com/r/' + sub + '/hot.json?limit=50', { headers: UA });
  if (!r.ok) return null;
  const j = await r.json();
  const posts = (j.data && j.data.children || []).map((c) => c.data).filter((p) => p && !p.over_18 && !p.spoiler);
  const out = [];
  for (const p of posts) {
    const link = p.url_overridden_by_dest || p.url || '';
    if (p.is_video && p.media && p.media.reddit_video && p.media.reddit_video.fallback_url) {
      out.push({ kind: 'video', title: p.title, url: p.media.reddit_video.fallback_url.split('?')[0], key: p.id, source: 'Reddit · r/' + p.subreddit });
      continue;
    }
    if (isImage(link) || p.post_hint === 'image') {
      out.push({ kind: 'image', title: p.title, url: link, key: p.id, source: 'Reddit · r/' + p.subreddit });
    }
  }
  if (!out.length) return null;
  return pick(out);
}

async function fromYouTube(country, type) {
  const qs = (YT_Q[country] || YT_Q.global)[type] || YT_Q.global.any;
  const q = pick(qs);
  for (const base of ['https://api.piped.private.coffee/search?q=', 'https://pipedapi.adminforge.de/search?q=']) {
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
        const id = extractYtId(v.url) || (typeof v.id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(v.id) ? v.id : null);
        if (!id) continue;
        vids.push({
          kind: 'youtube',
          title: v.title || q,
          url: 'https://www.youtube.com/watch?v=' + id,
          key: id,
          source: 'YouTube · ' + q,
          thumb: typeof v.thumbnail === 'string' ? v.thumbnail : null
        });
      }
      if (vids.length) return pick(vids.slice(0, 15));
    } catch (e) {
      console.warn('memes yt', e.message);
    }
  }
  return null;
}

async function fromGoogle(country, type) {
  const subMap = {
    india: ['IndianDankMemes', 'indianmemes'],
    usa: ['memes', 'dankmemes'],
    uk: ['memes'],
    global: ['memes', 'dankmemes', 'IndianDankMemes']
  };
  try {
    const sub = pick(subMap[country] || subMap.global);
    const r = await fetch('https://meme-api.com/gimme/' + sub, { headers: UA });
    if (r.ok) {
      const m = await r.json();
      if (m && m.url && !m.nsfw && isImage(m.url)) {
        return { kind: 'image', title: m.title || 'Meme', url: m.url, key: m.postLink || m.url, source: 'Google-style · r/' + sub };
      }
    }
  } catch {}
  try {
    const r = await fetch('https://api.imgflip.com/get_memes', { headers: UA });
    if (r.ok) {
      const j = await r.json();
      const memes = (j.data && j.data.memes) || [];
      if (memes.length) {
        const m = pick(memes.slice(0, 40));
        return { kind: 'image', title: m.name || 'Meme', url: m.url, key: m.id || m.url, source: 'Google-style · Imgflip' };
      }
    }
  } catch {}
  return null;
}

async function getMeme(cfg, used) {
  const source = (cfg && cfg.source) || 'all';
  const country = (cfg && cfg.country) || 'global';
  const type = (cfg && cfg.type) || 'any';
  for (let i = 0; i < 10; i++) {
    try {
      let m = null;
      if (source === 'youtube') m = await fromYouTube(country, type);
      else if (source === 'reddit') m = await fromReddit(country, type);
      else if (source === 'google') m = await fromGoogle(country, type);
      else {
        const fns = [fromYouTube, fromReddit, fromGoogle];
        m = await fns[i % 3](country, type);
      }
      if (!m || !m.url) continue;
      const key = String(m.key || m.url);
      if (used && used.has(key)) continue;
      if (used) {
        used.add(key);
        if (used.size > 80) {
          const first = used.values().next().value;
          used.delete(first);
        }
      }
      return m;
    } catch (e) {
      console.warn('getMeme', e.message);
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
  const usedMap = new Map();

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
    if (!usedMap.has(guildId)) usedMap.set(guildId, new Set());
    const m = await getMeme(c, usedMap.get(guildId));
    if (m) await sendMeme(ch, m).catch((e) => console.error('meme send', e.message));
    else console.warn('memes: no unique result', c.source, c.country, c.type);
  }

  client.on(Events.InteractionCreate, async (i) => {
    try {
      if (i.isChatInputCommand() && i.commandName === 'meme') {
        await i.deferReply();
        const m = await getMeme({ source: 'all', country: 'global', type: 'any' }, new Set());
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
        const country = i.options.getString('country', true);
        const type = i.options.getString('type', true);
        const seconds = i.options.getInteger('seconds') || 20;
        s.memes = {
          enabled: true,
          channelId: ch.id,
          source,
          country,
          type,
          intervalSec: Math.max(15, Math.min(3600, seconds))
        };
        await saveSettings(i.guildId, s);
        usedMap.set(i.guildId, new Set());
        await i.reply({
          content:
            'Auto memes **ON** ' + ch + '\n' +
            'Source: **' + source + '** · Country: **' + country + '** · Type: **' + type + '**\n' +
            'Every **' + s.memes.intervalSec + 's** (unique, repeating) — posting now…',
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
            '\nSource: **' + ((c && c.source) || '—') + '**' +
            '\nCountry: **' + ((c && c.country) || '—') + '**' +
            '\nType: **' + ((c && c.type) || '—') + '**' +
            '\nInterval: ' + ((c && c.intervalSec) || 20) + 's',
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (e) {
      console.error('meme cmd', e.message);
    }
  });

  function startLoop() {
    console.log('memes: auto-post loop started');
    setInterval(async () => {
      for (const g of client.guilds.cache.values()) {
        try { await postOnce(g.id, false); } catch (e) { console.error('memes tick', e.message); }
      }
    }, 5000);
  }
  if (client.isReady()) startLoop();
  else client.once(Events.ClientReady, startLoop);
}
