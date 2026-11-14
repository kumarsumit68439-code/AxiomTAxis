import { Events, EmbedBuilder, MessageFlags } from 'discord.js';
import { getSettings } from './util.js';

export const commands = [
  { name: 'meme', description: 'Get a random meme', dm_permission: false }
];

async function getMeme() {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch('https://meme-api.com/gimme');
      if (!r.ok) continue;
      const m = await r.json();
      if (m && m.url && !m.nsfw && !m.spoiler) return m;
    } catch {}
  }
  return null;
}

const embedOf = (m) => new EmbedBuilder().setColor(0xf97316).setTitle(String(m.title || 'Meme').slice(0, 250)).setURL(m.postLink || null).setImage(m.url).setFooter({ text: 'r/' + (m.subreddit || 'memes') });

export function attach(client) {
  client.on(Events.InteractionCreate, async (i) => {
    if (!i.isChatInputCommand() || i.commandName !== 'meme') return;
    try {
      await i.deferReply();
      const m = await getMeme();
      if (!m) return i.editReply('Meme nahi mila, thodi der baad try karo.');
      return i.editReply({ embeds: [embedOf(m)] });
    } catch (e) { console.error('meme cmd', e.message); }
  });

  const last = new Map();
  client.once(Events.ClientReady, () => {
    setInterval(async () => {
      for (const guild of client.guilds.cache.values()) {
        try {
          const s = await getSettings(guild.id);
          const c = s.memes;
          if (!c || !c.enabled || !c.channelId) continue;
          const every = Math.max(5, c.intervalMin || 60) * 60000;
          if (!last.has(guild.id)) { last.set(guild.id, Date.now()); continue; }
          if (Date.now() - last.get(guild.id) < every) continue;
          last.set(guild.id, Date.now());
          const ch = guild.channels.cache.get(c.channelId);
          if (!ch || !ch.isTextBased()) continue;
          const m = await getMeme();
          if (m) await ch.send({ embeds: [embedOf(m)] }).catch(() => {});
        } catch (e) { console.error('memes tick', e.message); }
      }
    }, 60000);
  });
}
