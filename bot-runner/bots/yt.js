import { Events } from 'discord.js';
import { getSettings, saveSettings } from './util.js';

export const commands = [];

const DEFAULT_MSG = '📢 **{channel}** uploaded a new video!\n**{title}**\n{url}';

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

async function latest(id) {
  const r = await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + id, { headers: { 'User-Agent': 'AxiomTAxis' } });
  if (!r.ok) return null;
  const x = await r.text();
  const e = x.match(/<entry>([\s\S]*?)<[/]entry>/);
  if (!e) return null;
  const vid = e[1].match(/<yt:videoId>([^<]+)</);
  const title = e[1].match(/<title>([^<]*)</);
  const author = x.match(/<author>\s*<name>([^<]*)</);
  return { id: vid && vid[1], title: title ? decode(title[1]) : 'New video', channel: author ? decode(author[1]) : 'YouTube' };
}

async function poll(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      const s = await getSettings(guild.id);
      const c = s.yt;
      if (!c || !c.enabled || !c.channelId || !(c.subs || []).length) continue;
      const ch = guild.channels.cache.get(c.channelId);
      if (!ch || !ch.isTextBased()) continue;
      let changed = false;
      for (const sub of c.subs.slice(0, 10)) {
        try {
          const v = await latest(sub.id);
          if (!v || !v.id) continue;
          if (!sub.last) { sub.last = v.id; changed = true; continue; }
          if (v.id === sub.last) continue;
          sub.last = v.id;
          changed = true;
          const text = (c.message || DEFAULT_MSG)
            .replaceAll('{channel}', sub.name || v.channel)
            .replaceAll('{title}', v.title)
            .replaceAll('{url}', 'https://www.youtube.com/watch?v=' + v.id);
          await ch.send({ content: text.slice(0, 1900), allowedMentions: { parse: ['roles', 'everyone'] } });
        } catch (e) { console.error('yt sub', e.message); }
      }
      if (changed) await saveSettings(guild.id, s);
    } catch (e) { console.error('yt', e.message); }
  }
}

// Polls YouTube RSS every 5 minutes. The first check only remembers the latest video (no spam).
export function attach(client) {
  client.once(Events.ClientReady, () => {
    setTimeout(() => poll(client), 30000);
    setInterval(() => poll(client), 5 * 60000);
  });
}
