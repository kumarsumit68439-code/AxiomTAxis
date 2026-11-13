import { Events, MessageFlags, ChannelType } from 'discord.js';
import { getSettings, saveSettings, MANAGE } from './util.js';

export const commands = [
  {
    name: 'welcome',
    description: 'Welcome & leave message settings',
    default_member_permissions: MANAGE,
    dm_permission: false,
    options: [
      {
        name: 'set',
        description: 'Set welcome channel and message',
        type: 1,
        options: [
          { name: 'channel', description: 'Channel for welcome messages', type: 7, required: true, channel_types: [ChannelType.GuildText] },
          { name: 'message', description: 'Use {user} {username} {server} {count}', type: 3, max_length: 300 }
        ]
      },
      {
        name: 'leave',
        description: 'Set leave channel and message',
        type: 1,
        options: [
          { name: 'channel', description: 'Channel for leave messages', type: 7, required: true, channel_types: [ChannelType.GuildText] },
          { name: 'message', description: 'Use {user} {username} {server} {count}', type: 3, max_length: 300 }
        ]
      },
      { name: 'off', description: 'Turn welcome messages off', type: 1 },
      { name: 'leaveoff', description: 'Turn leave messages off', type: 1 }
    ]
  }
];

export function attach(client) {
  client.on(Events.InteractionCreate, async (i) => {
    if (!i.isChatInputCommand() || i.commandName !== 'welcome') return;
    try {
      const s = await getSettings(i.guildId);
      const sub = i.options.getSubcommand();

      if (sub === 'off') {
        delete s.welcome;
        await saveSettings(i.guildId, s);
        return i.reply({ content: 'Welcome messages off.', flags: MessageFlags.Ephemeral });
      }
      if (sub === 'leaveoff') {
        delete s.leave;
        await saveSettings(i.guildId, s);
        return i.reply({ content: 'Leave messages off.', flags: MessageFlags.Ephemeral });
      }
      if (sub === 'set') {
        const ch = i.options.getChannel('channel', true);
        s.welcome = {
          channelId: ch.id,
          message: i.options.getString('message') || 'Welcome {user} to {server}! You are member #{count}.'
        };
        await saveSettings(i.guildId, s);
        return i.reply({ content: `Welcome messages → <#${ch.id}>`, flags: MessageFlags.Ephemeral });
      }
      if (sub === 'leave') {
        const ch = i.options.getChannel('channel', true);
        s.leave = {
          channelId: ch.id,
          message: i.options.getString('message') || '{username} left {server}. Members: {count}'
        };
        await saveSettings(i.guildId, s);
        return i.reply({ content: `Leave messages → <#${ch.id}>`, flags: MessageFlags.Ephemeral });
      }
    } catch (e) {
      console.error('welcome cmd', e.message);
    }
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      const s = await getSettings(member.guild.id);
      if (!s.welcome) return;
      const ch = member.guild.channels.cache.get(s.welcome.channelId);
      if (!ch || !ch.isTextBased()) return;
      const text = s.welcome.message
        .replaceAll('{user}', '<@' + member.id + '>')
        .replaceAll('{username}', member.user.username)
        .replaceAll('{server}', member.guild.name)
        .replaceAll('{count}', String(member.guild.memberCount));
      await ch.send({ content: text, allowedMentions: { users: [member.id] } });
    } catch (e) {
      console.error('welcome', e.message);
    }
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    try {
      const s = await getSettings(member.guild.id);
      if (!s.leave) return;
      const ch = member.guild.channels.cache.get(s.leave.channelId);
      if (!ch || !ch.isTextBased()) return;
      const text = s.leave.message
        .replaceAll('{user}', member.user.tag)
        .replaceAll('{username}', member.user.username)
        .replaceAll('{server}', member.guild.name)
        .replaceAll('{count}', String(member.guild.memberCount));
      await ch.send({ content: text, allowedMentions: { parse: [] } });
    } catch (e) {
      console.error('leave', e.message);
    }
  });
}
