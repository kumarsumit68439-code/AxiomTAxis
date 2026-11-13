import {
  Events, MessageFlags, ChannelType, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder
} from 'discord.js';
import { getSettings, saveSettings, MANAGE } from './util.js';

export const commands = [
  {
    name: 'ticket',
    description: 'Ticket system',
    default_member_permissions: MANAGE,
    dm_permission: false,
    options: [
      {
        name: 'setup',
        description: 'Send ticket panel',
        type: 1,
        options: [
          { name: 'channel', description: 'Channel for the panel', type: 7, required: true, channel_types: [ChannelType.GuildText] },
          { name: 'category', description: 'Category where tickets are created', type: 7, required: false, channel_types: [ChannelType.GuildCategory] },
          { name: 'support_role', description: 'Role that can see tickets', type: 8, required: false }
        ]
      },
      { name: 'off', description: 'Disable ticket system', type: 1 },
      { name: 'status', description: 'Show ticket settings', type: 1 }
    ]
  }
];

export function attach(client) {
  client.on(Events.InteractionCreate, async (i) => {
    try {
      if (i.isButton() && i.customId === 'ticket:open') {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const s = await getSettings(i.guildId);
        const cfg = s.ticket;
        if (!cfg || !cfg.enabled) {
          return i.editReply({ content: 'Ticket system off hai.' });
        }

        const existing = i.guild.channels.cache.find(
          (c) => c.parentId === cfg.categoryId && c.topic === `ticket:${i.user.id}`
        );
        if (existing) {
          return i.editReply({ content: `Tumhara ticket pehle se open hai: ${existing}` });
        }

        const overwrites = [
          { id: i.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
          { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }
        ];
        if (cfg.supportRoleId) {
          overwrites.push({
            id: cfg.supportRoleId,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
          });
        }

        const name = `ticket-${i.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90);
        const channel = await i.guild.channels.create({
          name,
          type: ChannelType.GuildText,
          parent: cfg.categoryId || undefined,
          topic: `ticket:${i.user.id}`,
          permissionOverwrites: overwrites
        });

        const closeRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ticket:close').setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒')
        );

        const embed = new EmbedBuilder()
          .setColor(0xf97316)
          .setTitle('Ticket Opened')
          .setDescription(`Welcome ${i.user}.\nSupport team jald reply karega.\nBand karne ke liye neeche **Close Ticket** dabao.`)
          .setTimestamp();

        await channel.send({ content: `${i.user}${cfg.supportRoleId ? ` <@&${cfg.supportRoleId}>` : ''}`, embeds: [embed], components: [closeRow] });
        return i.editReply({ content: `Ticket ban gaya: ${channel}` });
      }

      if (i.isButton() && i.customId === 'ticket:close') {
        if (!i.channel || !i.channel.topic || !i.channel.topic.startsWith('ticket:')) {
          return i.reply({ content: 'Ye ticket channel nahi hai.', flags: MessageFlags.Ephemeral });
        }
        await i.reply({ content: 'Ticket 5 second me close ho raha hai…' });
        setTimeout(() => i.channel.delete('Ticket closed').catch(() => {}), 5000);
        return;
      }

      if (!i.isChatInputCommand() || i.commandName !== 'ticket') return;

      const s = await getSettings(i.guildId);
      s.ticket = s.ticket || { enabled: false };
      const sub = i.options.getSubcommand();

      if (sub === 'setup') {
        const ch = i.options.getChannel('channel', true);
        const cat = i.options.getChannel('category', false);
        const role = i.options.getRole('support_role', false);

        s.ticket = {
          enabled: true,
          panelChannelId: ch.id,
          categoryId: cat ? cat.id : null,
          supportRoleId: role ? role.id : null
        };
        await saveSettings(i.guildId, s);

        const embed = new EmbedBuilder()
          .setColor(0xf97316)
          .setTitle('Support Tickets')
          .setDescription('Help chahiye? Neeche **Open Ticket** button dabao.\nEk private channel banega jahan aap support se baat kar sakte ho.');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ticket:open').setLabel('Open Ticket').setStyle(ButtonStyle.Primary).setEmoji('🎫')
        );

        await ch.send({ embeds: [embed], components: [row] });
        return i.reply({ content: `Ticket panel bhej diya ${ch} me.`, flags: MessageFlags.Ephemeral });
      }

      if (sub === 'off') {
        s.ticket = { enabled: false };
        await saveSettings(i.guildId, s);
        return i.reply({ content: 'Ticket system off.', flags: MessageFlags.Ephemeral });
      }

      if (sub === 'status') {
        const t = s.ticket;
        return i.reply({
          content: `**Ticket**\nEnabled: ${t.enabled ? 'Yes' : 'No'}\nPanel: ${t.panelChannelId ? `<#${t.panelChannelId}>` : '—'}\nCategory: ${t.categoryId ? `<#${t.categoryId}>` : '—'}\nSupport role: ${t.supportRoleId ? `<@&${t.supportRoleId}>` : '—'}`,
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (e) {
      console.error('ticket', e.message);
      if (i.deferred || i.replied) {
        await i.editReply({ content: 'Error: ' + String(e.message).slice(0, 200) }).catch(() => {});
      }
    }
  });
}
