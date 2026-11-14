import { Events, MessageFlags, EmbedBuilder } from 'discord.js';
import { getSettings } from './util.js';

export const commands = [
  {
    name: 'suggest', description: 'Send a suggestion to the server team', dm_permission: false,
    options: [{ name: 'text', description: 'Your suggestion', type: 3, required: true, max_length: 1500 }]
  }
];

export function attach(client) {
  client.on(Events.InteractionCreate, async (i) => {
    if (!i.isChatInputCommand() || i.commandName !== 'suggest') return;
    try {
      const s = await getSettings(i.guildId);
      const c = s.suggestions;
      if (!c || !c.enabled || !c.channelId) return i.reply({ content: 'Suggestions is server me off hain.', flags: MessageFlags.Ephemeral });
      const ch = i.guild.channels.cache.get(c.channelId);
      if (!ch || !ch.isTextBased()) return i.reply({ content: 'Suggestion channel nahi mila.', flags: MessageFlags.Ephemeral });
      const embed = new EmbedBuilder().setColor(0xf97316)
        .setAuthor({ name: i.user.username, iconURL: i.user.displayAvatarURL() })
        .setTitle('New Suggestion').setDescription(i.options.getString('text', true)).setTimestamp();
      const m = await ch.send({ embeds: [embed] });
      await m.react('👍').catch(() => {});
      await m.react('👎').catch(() => {});
      return i.reply({ content: 'Suggestion bhej di: ' + ch, flags: MessageFlags.Ephemeral });
    } catch (e) {
      console.error('suggest', e.message);
      if (!i.replied && !i.deferred) i.reply({ content: 'Suggestion nahi bhej paya. Bot ko channel me Send Messages + Add Reactions chahiye.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  });
}
