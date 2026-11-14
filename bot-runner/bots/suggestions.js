import { Events, MessageFlags, EmbedBuilder } from 'discord.js';
import { getSettings } from './util.js';

export const commands = [
  {
    name: 'suggest',
    description: 'Post a suggestion for the server',
    dm_permission: false,
    options: [{ name: 'idea', description: 'Your suggestion', type: 3, required: true, max_length: 1000 }]
  }
];

export function attach(client) {
  client.on(Events.InteractionCreate, async (i) => {
    if (!i.isChatInputCommand() || i.commandName !== 'suggest') return;
    try {
      const c = (await getSettings(i.guildId)).suggestions;
      const ch = c && c.enabled && c.channelId && i.guild.channels.cache.get(c.channelId);
      if (!ch || !ch.isTextBased()) {
        return i.reply({ content: 'Suggestions is server me off hai.', flags: MessageFlags.Ephemeral });
      }
      const embed = new EmbedBuilder()
        .setColor(0xf97316)
        .setAuthor({ name: i.user.username, iconURL: i.user.displayAvatarURL() })
        .setTitle('New Suggestion')
        .setDescription(i.options.getString('idea', true))
        .setTimestamp();
      const msg = await ch.send({ embeds: [embed] });
      await msg.react('👍').catch(() => {});
      await msg.react('👎').catch(() => {});
      return i.reply({ content: 'Suggestion post ho gaya: ' + msg.url, flags: MessageFlags.Ephemeral });
    } catch (e) {
      console.error('suggest', e.message);
      if (!i.replied && !i.deferred) await i.reply({ content: 'Error, bot ko channel permissions do.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  });
}
