import { Events, MessageFlags, ChannelType } from 'discord.js';
import { getSettings, saveSettings, MANAGE } from './util.js';

export const commands = [
  {
    name: 'counting',
    description: 'Counting channel setup',
    default_member_permissions: MANAGE,
    dm_permission: false,
    options: [
      {
        name: 'set',
        description: 'Set the counting channel',
        type: 1,
        options: [
          { name: 'channel', description: 'Text channel for counting', type: 7, required: true, channel_types: [ChannelType.GuildText] }
        ]
      },
      { name: 'off', description: 'Disable counting', type: 1 },
      { name: 'reset', description: 'Reset count to 0', type: 1 },
      { name: 'status', description: 'Show current count and channel', type: 1 }
    ]
  }
];

export function attach(client) {
  const lastUser = new Map();

  client.on(Events.InteractionCreate, async (i) => {
    if (!i.isChatInputCommand() || i.commandName !== 'counting') return;
    try {
      const s = await getSettings(i.guildId);
      s.counting = s.counting || { channelId: null, count: 0 };
      const sub = i.options.getSubcommand();

      if (sub === 'set') {
        const ch = i.options.getChannel('channel', true);
        if (ch.type !== ChannelType.GuildText) {
          return i.reply({ content: 'Sirf text channel select karo.', flags: MessageFlags.Ephemeral });
        }
        s.counting.channelId = ch.id;
        s.counting.count = 0;
        lastUser.delete(i.guildId);
        await saveSettings(i.guildId, s);
        return i.reply({ content: `Counting channel set: ${ch}. Count reset to **0**. Next number: **1**`, flags: MessageFlags.Ephemeral });
      }

      if (sub === 'off') {
        s.counting.channelId = null;
        s.counting.count = 0;
        lastUser.delete(i.guildId);
        await saveSettings(i.guildId, s);
        return i.reply({ content: 'Counting band kar diya.', flags: MessageFlags.Ephemeral });
      }

      if (sub === 'reset') {
        s.counting.count = 0;
        lastUser.delete(i.guildId);
        await saveSettings(i.guildId, s);
        return i.reply({ content: 'Count reset to **0**. Next: **1**', flags: MessageFlags.Ephemeral });
      }

      if (sub === 'status') {
        const ch = s.counting.channelId ? `<#${s.counting.channelId}>` : 'Not set';
        return i.reply({
          content: `**Counting status**\nChannel: ${ch}\nCurrent count: **${s.counting.count}**\nNext number: **${s.counting.count + 1}**`,
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (e) {
      console.error('counting cmd', e.message);
    }
  });

  client.on(Events.MessageCreate, async (msg) => {
    if (!msg.guild || msg.author.bot || !msg.content) return;
    try {
      const s = await getSettings(msg.guildId);
      const cfg = s.counting;
      if (!cfg || !cfg.channelId || msg.channelId !== cfg.channelId) return;

      const content = msg.content.trim();
      if (!/^\d+$/.test(content)) {
        await msg.react('❌').catch(() => {});
        return;
      }

      const num = parseInt(content, 10);
      const expected = (cfg.count || 0) + 1;

      if (lastUser.get(msg.guildId) === msg.author.id) {
        await msg.react('❌').catch(() => {});
        await msg.reply({ content: `${msg.author} — same user consecutive count nahi chalega. Count reset to **0**.`, allowedMentions: { users: [msg.author.id] } }).catch(() => {});
        cfg.count = 0;
        lastUser.delete(msg.guildId);
        await saveSettings(msg.guildId, s);
        return;
      }

      if (num !== expected) {
        await msg.react('❌').catch(() => {});
        await msg.reply({
          content: `Wrong number! Expected **${expected}**, got **${num}**. Count reset to **0**.`,
          allowedMentions: { repliedUser: false }
        }).catch(() => {});
        cfg.count = 0;
        lastUser.delete(msg.guildId);
        await saveSettings(msg.guildId, s);
        return;
      }

      cfg.count = num;
      lastUser.set(msg.guildId, msg.author.id);
      await saveSettings(msg.guildId, s);
      await msg.react('✅').catch(() => {});

      if (num % 100 === 0) {
        await msg.reply({ content: `🎉 Milestone! Count reached **${num}**!`, allowedMentions: { repliedUser: false } }).catch(() => {});
      }
    } catch (e) {
      console.error('counting msg', e.message);
    }
  });
}
