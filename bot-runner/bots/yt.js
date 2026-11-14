import { Events } from 'discord.js';
import { getSettings, saveSettings } from './util.js';

export const commands = [];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function tag(str, name) {
  const open = '<' + name + '>';
  const a = str.indexOf(open);
  if (a < 0) return '';
  const b = str.indexOf('</' + name + '>', a);
  return b < 0 ? '' : str.slice(a + open.length, b);
}

const decode = (t) => t.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'");

export async function fetchFeed(id) {
  const r = await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + id, { headers: { 'user-agent': UA } });
  if (!r.ok) throw new Error('YouTube feed not found (' + r.status + '). Check the channel ID.');
  const x = await r.text();
  const parts = x.split('<entry>');
  const head = parts[0];
  const videos = parts.slice(1).map((e) => ({ id: tag(e, 'yt:videoId'), title: decode(tag(e, 'title')) })).filter((v) => v.id);
  return { title: decode(tag(head, 'title')) || id, videos };
}

export async function resolveChannel(input) {
  const v = String(input || '').trim();
  if (!v) throw new Error('Enter a YouTube channel link, @handle or channel ID.');
  const direct = v.match(/UC[A-Za-z0-9_-]{22}/);
  if (direct) return direct[0];
  let url = v;
  if (!/^https?:\/\//i.test(v)) url = 'https://www.youtube.com/' + (v.startsWith('@') ? v : '@' + v);
  const u = new URL(url);
  if (!(u.hostname === 'youtube.com' || u.hostname.endsWith('.youtube.com'))) throw new Error('Only youtube.com links are supported.');
  const r = await fetch(u.href, { headers: { 'user-agent': UA, 'accept-language': 'en', cookie: 'CONSENT=YES+1' } });
  const t = await r.text();
  const m = t.match(/"channelId":"(UC[A-Za-z0-9_-]{22})"/) || t.match(/channel\/(UC[A-Za-z0-9_-]{22})/);
  if (!m) throw new Error('Could not find that channel. Paste the channel ID (starts with UC).');
  return m[1];
}

export function attach(client) {
  async function poll() {
    for (const guild of client.guilds.cache.values()) {
      try {
        const s = await getSettings(guild.id);
        const y = s.yt;
        if (!y || !y.enabled || !y.channelId || !(y.items || []).length) continue;
        const ch = guild.channels.cache.get(y.channelId);
        if (!ch || !ch.isTextBased()) continue;
        let changed = false;
        for (const item of y.items) {
          let feed;
          try { feed = await fetchFeed(item.id); } catch { continue; }
          if (!feed.videos.length) continue;
          const newest = feed.videos[0].id;
          if (!item.lastId) { item.lastId = newest; changed = true; continue; }
          if (item.lastId === newest) continue;
          const fresh = [];
          for (const v of feed.videos) { if (v.id === item.lastId) break; fresh.push(v); }
          item.lastId = newest; changed = true;
          for (const v of fresh.slice(0, 3).reverse()) {
            const text = (y.message || '{channel} uploaded a new video: {title}\n{url}')
              .replaceAll('{channel}', item.name || feed.title)
              .replaceAll('{title}', v.title)
              .replaceAll('{url}', 'https://www.youtube.com/watch?v=' + v.id);
            await ch.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
          }
        }
        if (changed) await saveSettings(guild.id, s);
      } catch (e) { console.error('yt poll', e.message); }
    }
  }
  client.once(Events.ClientReady, () => { setTimeout(poll, 30000); setInterval(poll, 5 * 60 * 1000); });
}
