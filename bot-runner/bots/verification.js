import { Events, MessageFlags, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getSettings, saveSettings, MANAGE } from './util.js';

export const commands = [
  {
    name: 'verification',
    description: 'Verification system setup',
    default_member_permissions: MANAGE,
    dm_permission: false,
    options: [
      {
        name: 'setup',
        description: 'Send verification panel to a channel',
        type: 1,
        options: [
          { name: 'channel', description: 'Channel for the panel', type: 7, required: true, channel_types: [ChannelType.GuildText] },
          { name: 'role', description: 'Role to give on verify', type: 8, required: true }
        ]
      },
      { name: 'off', description: 'Disable verification', type: 1 },
      { name: 'status', description: 'Show verification settings', type: 1 }
    ]
  }
];

export function attach(client) {
  client.on(Events.InteractionCreate, async (i) => {
    try {
      if (i.isButton() && i.customId === 'verify:btn') {
        const s = await getSettings(i.guildId);
        const cfg = s.verification;
        if (!cfg || !cfg.roleId) {
          return i.reply({ content: 'Verification abhi setup nahi hai.', flags: MessageFlags.Ephemeral });
        }
        const member = i.member;
        if (!member) return i.reply({ content: 'Member nahi mila.', flags: MessageFlags.Ephemeral });
        if (member.roles.cache.has(cfg.roleId)) {
          return i.reply({ content: 'Tum already verified ho.', flags: MessageFlags.Ephemeral });
        }
        try {
          await member.roles.add(cfg.roleId, 'Verification button');
          return i.reply({ content: '✅ Verified! Role mil gaya.', flags: MessageFlags.Ephemeral });
        } catch (e) {
          return i.reply({ content: 'Role nahi de paya. Bot ka role verified role se upar hona chahiye.', flags: MessageFlags.Ephemeral });
        }
      }

      if (!i.isChatInputCommand() || i.commandName !== 'verification') return;

      const s = await getSettings(i.guildId);
      s.verification = s.verification || { channelId: null, roleId: null };
      const sub = i.options.getSubcommand();

      if (sub === 'setup') {
        const ch = i.options.getChannel('channel', true);
        const role = i.options.getRole('role', true);
        if (ch.type !== ChannelType.GuildText) {
          return i.reply({ content: 'Sirf text channel.', flags: MessageFlags.Ephemeral });
        }
        const me = i.guild.members.me;
        if (me && role.position >= me.roles.highest.position) {
          return i.reply({ content: 'Bot ka highest role is role se upar hona chahiye.', flags: MessageFlags.Ephemeral });
        }

        s.verification.channelId = ch.id;
        s.verification.roleId = role.id;
        await saveSettings(i.guildId, s);

        const embed = new EmbedBuilder()
          .setColor(0xf97316)
          .setTitle('Server Verification')
          .setDescription('Is server me join karne ke liye neeche **Verify** button dabao.\nRole milne ke baad aap channels dekh sakte ho.');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('verify:btn')
            .setLabel('Verify')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅')
        );

        await ch.send({ embeds: [embed], components: [row] });
        return i.reply({ content: `Verification panel bhej diya ${ch} me. Role: **${role.name}**`, flags: MessageFlags.Ephemeral });
      }

      if (sub === 'off') {
        s.verification = { channelId: null, roleId: null };
        await saveSettings(i.guildId, s);
        return i.reply({ content: 'Verification band.', flags: MessageFlags.Ephemeral });
      }

      if (sub === 'status') {
        const ch = s.verification.channelId ? `<#${s.verification.channelId}>` : '—';
        const role = s.verification.roleId ? `<@&${s.verification.roleId}>` : '—';
        return i.reply({ content: `**Verification**\nChannel: ${ch}\nRole: ${role}`, flags: MessageFlags.Ephemeral });
      }
    } catch (e) {
      console.error('verification', e.message);
    }
  });
}
