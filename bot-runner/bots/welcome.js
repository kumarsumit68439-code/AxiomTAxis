import { Events, MessageFlags, ChannelType } from 'discord.js';
import { getSettings, saveSettings, MANAGE } from './util.js';

// Welcome/leave MESSAGE TEXT from website/dashboard only. Discord sets channel only.
export const commands = [
  {
    name: 'welcome',
    description: 'Welcome & leave channel (message text set from website only)',
    default_member_permissions: MANAGE,
    dm_permission: false,
    options: [
      {
        name: 'set',
        description: 'Set welcome channel (message text from website)',
        type: 1,
        options: [
          { name: 'channel', description: 'Channel for welcome messages', type: 7, required: true, channel_types: [ChannelType.GuildText] }
        ]
      },
      {
        name: 'leave',
        description: 'Set leave channel (message text from website)',
        type: 1,
        options: [
          { name: 'channel', description: 'Channel for leave messages', type: 7, required: true, channel_types: [ChannelType.GuildText] }
        ]
      },
      { name: 'off', description: 'Turn welcome messages off', type: 1 },
      { name: 'leaveoff', description: 'Turn leave messages off', type: 1 },
      { name: 'status', description: 'Show welcome/leave settings', type: 1 }
    ]
  }
];

const DEFAULT_WELCOME = 'Welcome {user} to {server}! You are member #{count}.';
const DEFAULT_LEAVE = '{username} left {server}. Members: {count}';

export function attach(client) {
  client.on(Events.InteractionCreate, async (i) => {
    if (!i.isChatInputCommand() || i.commandName !== 'welcome') return;
    try {
      const s = await getSettings(i.guildId);
      const sub = i.options.getSubcommand();

      if (sub === 'off') {
        if (s.welcome) s.welcome.enabled = false;
        await saveSettings(i.guildId, s);
        return i.reply({ content: 'Welcome messages off.', flags: MessageFlags.Ephemeral });
      }
      if (sub === 'leaveoff') {
        if (s.leave) s.leave.enabled = false;
        await saveSettings(i.guildId, s);
        return i.reply({ content: 'Leave messages off.', flags: MessageFlags.Ephemeral });
      }
      if (sub === 'set') {
        const ch = i.options.getChannel('channel', true);
        s.welcome = {
          ...(s.welcome || {}),
          channelId: ch.id,
          enabled: true,
          message: (s.welcome && s.welcome.message) || DEFAULT_WELCOME
        };
        await saveSettings(i.guildId, s);
        return i.reply({
          content: `Welcome channel → <#${ch.id}>\n_(Message text website se set hota hai)_`,
          flags: MessageFlags.Ephemeral
        });
      }
      if (sub === 'leave') {
        const ch = i.options.getChannel('channel', true);
        s.leave = {
          ...(s.leave || {}),
          channelId: ch.id,
          enabled: true,
          message: (s.leave && s.leave.message) || DEFAULT_LEAVE
        };
        await saveSettings(i.guildId, s);
        return i.reply({
          content: `Leave channel → <#${ch.id}>\n_(Message text website se set hota hai)_`,
          flags: MessageFlags.Ephemeral
        });
      }
      if (sub === 'status') {
        const w = s.welcome;
        const l = s.leave;
        return i.reply({
          content:
            `**Welcome:** ${w && w.enabled !== false && w.channelId ? `<#${w.channelId}>` : 'off'}\n` +
            `Message: ${(w && w.message) || DEFAULT_WELCOME}\n\n` +
            `**Leave:** ${l && l.enabled !== false && l.channelId ? `<#${l.channelId}>` : 'off'}\n` +
            `Message: ${(l && l.message) || DEFAULT_LEAVE}\n\n` +
            `_(Message text website/dashboard se change hota hai)_`,
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (e) {
      console.error('welcome cmd', e.message);
    }
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      const s = await getSettings(member.guild.id);
      if (!s.welcome || s.welcome.enabled === false || !s.welcome.channelId) return;
      const ch = member.guild.channels.cache.get(s.welcome.channelId);
      if (!ch || !ch.isTextBased()) return;
      const text = (s.welcome.message || DEFAULT_WELCOME)
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
      if (!s.leave || s.leave.enabled === false || !s.leave.channelId) return;
      const ch = member.guild.channels.cache.get(s.leave.channelId);
      if (!ch || !ch.isTextBased()) return;
      const text = (s.leave.message || DEFAULT_LEAVE)
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
