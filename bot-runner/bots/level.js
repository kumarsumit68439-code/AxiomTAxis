import { Events, MessageFlags, EmbedBuilder } from 'discord.js';
import { getSettings, saveSettings, MANAGE } from './util.js';

export const commands = [
  {
    name: 'level',
    description: 'Level / XP system',
    dm_permission: false,
    options: [
      {
        name: 'rank',
        description: 'Show your or someone else rank',
        type: 1,
        options: [
          { name: 'user', description: 'User (optional)', type: 6, required: false }
        ]
      },
      {
        name: 'leaderboard',
        description: 'Top members by XP',
        type: 1
      },
      {
        name: 'set',
        description: 'Enable levels + optional level-up channel (admin)',
        type: 1,
        options: [
          { name: 'channel', description: 'Channel for level-up messages (optional)', type: 7, required: false, channel_types: [0] }
        ]
      },
      { name: 'off', description: 'Disable level system (admin)', type: 1 }
    ]
  }
];

function xpForLevel(lvl) {
  return 100 + (lvl - 1) * 50;
}

function levelFromXp(xp) {
  let lvl = 1;
  let need = xpForLevel(1);
  let left = xp;
  while (left >= need) {
    left -= need;
    lvl++;
    need = xpForLevel(lvl);
  }
  return { level: lvl, current: left, need };
}

export function attach(client) {
  const cooldown = new Map();

  client.on(Events.InteractionCreate, async (i) => {
    if (!i.isChatInputCommand() || i.commandName !== 'level') return;
    try {
      const s = await getSettings(i.guildId);
      s.levels = s.levels || { enabled: false, users: {}, channelId: null };
      const sub = i.options.getSubcommand();

      if (sub === 'set') {
        if (!i.memberPermissions?.has('ManageGuild')) {
          return i.reply({ content: 'Manage Server permission chahiye.', flags: MessageFlags.Ephemeral });
        }
        const ch = i.options.getChannel('channel', false);
        s.levels.enabled = true;
        s.levels.channelId = ch ? ch.id : null;
        s.levels.users = s.levels.users || {};
        await saveSettings(i.guildId, s);
        return i.reply({
          content: `Levels **on**. Level-up channel: ${ch ? ch : 'none'}`,
          flags: MessageFlags.Ephemeral
        });
      }

      if (sub === 'off') {
        if (!i.memberPermissions?.has('ManageGuild')) {
          return i.reply({ content: 'Manage Server permission chahiye.', flags: MessageFlags.Ephemeral });
        }
        s.levels.enabled = false;
        await saveSettings(i.guildId, s);
        return i.reply({ content: 'Levels off.', flags: MessageFlags.Ephemeral });
      }

      if (!s.levels.enabled) {
        return i.reply({ content: 'Level system is server me off hai. Admin: `/level set`', flags: MessageFlags.Ephemeral });
      }

      if (sub === 'rank') {
        const user = i.options.getUser('user') || i.user;
        const xp = (s.levels.users[user.id] || 0);
        const { level, current, need } = levelFromXp(xp);
        const barLen = 12;
        const filled = Math.min(barLen, Math.floor((current / need) * barLen));
        const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

        const embed = new EmbedBuilder()
          .setColor(0xf97316)
          .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
          .setTitle(`Level ${level}`)
          .setDescription(`**XP:** ${xp}\n\`${bar}\` ${current}/${need}`)
          .setTimestamp();
        return i.reply({ embeds: [embed] });
      }

      if (sub === 'leaderboard') {
        const users = s.levels.users || {};
        const sorted = Object.entries(users)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);
        if (!sorted.length) {
          return i.reply({ content: 'Abhi koi XP nahi.', flags: MessageFlags.Ephemeral });
        }
        const lines = await Promise.all(sorted.map(async ([id, xp], idx) => {
          const { level } = levelFromXp(xp);
          let name = id;
          try {
            const u = await client.users.fetch(id);
            name = u.username;
          } catch {}
          return `**${idx + 1}.** ${name} — Level **${level}** (${xp} XP)`;
        }));
        const embed = new EmbedBuilder()
          .setColor(0xf97316)
          .setTitle('Leaderboard')
          .setDescription(lines.join('\n'))
          .setTimestamp();
        return i.reply({ embeds: [embed] });
      }
    } catch (e) {
      console.error('level cmd', e.message);
    }
  });

  client.on(Events.MessageCreate, async (msg) => {
    if (!msg.guild || msg.author.bot || !msg.content) return;
    try {
      const s = await getSettings(msg.guildId);
      if (!s.levels || !s.levels.enabled) return;

      const key = msg.guildId + ':' + msg.author.id;
      const now = Date.now();
      if (cooldown.get(key) && now - cooldown.get(key) < 60000) return;
      cooldown.set(key, now);

      s.levels.users = s.levels.users || {};
      const before = s.levels.users[msg.author.id] || 0;
      const gain = 15 + Math.floor(Math.random() * 11);
      const after = before + gain;
      s.levels.users[msg.author.id] = after;
      await saveSettings(msg.guildId, s);

      const prev = levelFromXp(before);
      const next = levelFromXp(after);
      if (next.level > prev.level && s.levels.channelId) {
        const ch = msg.guild.channels.cache.get(s.levels.channelId);
        if (ch && ch.isTextBased()) {
          await ch.send({
            content: `🎉 ${msg.author} leveled up to **Level ${next.level}**!`,
            allowedMentions: { users: [msg.author.id] }
          }).catch(() => {});
        }
      }
    } catch (e) {
      console.error('level xp', e.message);
    }
  });
}
