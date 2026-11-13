import { Events } from 'discord.js';

// Register slash commands per guild (instant) on ready and when joining new guilds.
export function registerCommands(client, commands) {
  const apply = async (guild) => {
    try { await guild.commands.set(commands); } catch (e) { console.error('commands', guild.id, e.message); }
  };
  client.once(Events.ClientReady, async () => { for (const g of client.guilds.cache.values()) await apply(g); });
  client.on(Events.GuildCreate, apply);
}
