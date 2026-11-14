import { Events, EmbedBuilder } from 'discord.js';
import { getSettings, saveSettings } from './util.js';

export const commands = [];

export async function postMeme(guild, cfg) {
  const ch = guild.channels.cache.get(cfg.channelId);
  if (!ch || !ch.isTextBased()) return false;
  const sub = /^[A-Za-z0-9_]{1,21}$/.test(cfg.subreddit || '') ? '/' + cfg.subreddit : '';
  const r = await fetch('https://meme-api.com/gimme' + sub);
  if (!r.ok) return false;
  const m = await r.json();
  if (!m || !m.url || m.nsfw || m.spoiler) return false;
  const e = new EmbedBuilder()
    .setColor(0xf97316)
    .setTitle(String(m.title || 'Meme').slice(0, 250))
    .setImage(m.url)
    .setFooter({ text: 'r/' + (m.subreddit || 'memes') });
  if (m.postLink) e.setURL(m.postLink);
  await ch.send({ embeds: [e] });
  return true;
}

async function tick(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      const s = await getSettings(guild.id);
      const c = s.memes;
      if (!c || !c.enabled || !c.channelId) continue;
      if (Date.now() - (c.lastAt || 0) < (c.intervalMin || 60) * 60000) continue;
      c.lastAt = Date.now();
      await saveSettings(guild.id, s);
      await postMeme(guild, c).catch((e) => console.error('meme', e.message));
    } catch (e) { console.error('memes', e.message); }
  }
}

export function attach(client) {
  client.once(Events.ClientReady, () => { setInterval(() => tick(client), 60000); });
}
