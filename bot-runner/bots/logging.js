import { Events, MessageFlags, ChannelType, EmbedBuilder } from 'discord.js';
import { getSettings, saveSettings, MANAGE } from './util.js';

export const commands = [
  {
    name: 'logging',
    description: 'Server logging setup',
    default_member_permissions: MANAGE,
    dm_permission: false,
    options: [
      {
        name: 'set',
        description: 'Set the log channel',
        type: 1,
        options: [
          { name: 'channel', description: 'Channel for logs', type: 7, required: true, channel_types: [ChannelType.GuildText] }
        ]
      },
      { name: 'off', description: 'Disable logging', type: 1 },
      { name: 'status', description: 'Show logging status', type: 1 }
    ]
  }
];

async function sendLog(guild, embed) {
  try {
    const s = await getSettings(guild.id);
    if (!s.logging || !s.logging.channelId) return;
    const ch = await guild.channels.fetch(s.logging.channelId).catch(() => null);
    if (!ch || !ch.isTextBased()) return;
    await ch.send({ embeds: [embed] }).catch(() => {});
  } catch (e) {
    console.error('sendLog', e.message);
  }
}

export function attach(client) {
  client.on(Events.InteractionCreate, async (i) => {
    if (!i.isChatInputCommand() || i.commandName !== 'logging') return;
    try {
      const s = await getSettings(i.guildId);
      s.logging = s.logging || { channelId: null };
      const sub = i.options.getSubcommand();

      if (sub === 'set') {
        const ch = i.options.getChannel('channel', true);
        s.logging.channelId = ch.id;
        await saveSettings(i.guildId, s);
        return i.reply({ content: `Log channel set: ${ch}`, flags: MessageFlags.Ephemeral });
      }
      if (sub === 'off') {
        s.logging.channelId = null;
        await saveSettings(i.guildId, s);
        return i.reply({ content: 'Logging band.', flags: MessageFlags.Ephemeral });
      }
      if (sub === 'status') {
        const ch = s.logging.channelId ? `<#${s.logging.channelId}>` : 'Not set';
        return i.reply({ content: `Log channel: ${ch}`, flags: MessageFlags.Ephemeral });
      }
    } catch (e) {
      console.error('logging cmd', e.message);
    }
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('Member Joined')
      .setDescription(`${member} (\`${member.user.tag}\`)`)
      .addFields(
        { name: 'ID', value: member.id, inline: true },
        { name: 'Account created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }
      )
      .setThumbnail(member.user.displayAvatarURL())
      .setTimestamp();
    await sendLog(member.guild, embed);
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle('Member Left')
      .setDescription(`${member.user.tag} (\`${member.id}\`)`)
      .setThumbnail(member.user.displayAvatarURL())
      .setTimestamp();
    await sendLog(member.guild, embed);
  });

  client.on(Events.MessageDelete, async (msg) => {
    if (!msg.guild || msg.author?.bot) return;
    const content = msg.content ? msg.content.slice(0, 1000) : '*no text / embed*';
    const embed = new EmbedBuilder()
      .setColor(0xf97316)
      .setTitle('Message Deleted')
      .setDescription(content)
      .addFields(
        { name: 'Author', value: msg.author ? `${msg.author.tag}` : 'Unknown', inline: true },
        { name: 'Channel', value: msg.channel ? `${msg.channel}` : '?', inline: true }
      )
      .setTimestamp();
    await sendLog(msg.guild, embed);
  });

  client.on(Events.MessageBulkDelete, async (messages, channel) => {
    if (!channel.guild) return;
    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle('Bulk Messages Deleted')
      .setDescription(`**${messages.size}** messages deleted in ${channel}`)
      .setTimestamp();
    await sendLog(channel.guild, embed);
  });
}
