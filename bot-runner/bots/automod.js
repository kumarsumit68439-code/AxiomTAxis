import { Events, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getSettings } from './util.js';

export const commands = [];

const spam = new Map();

export function attach(client) {
  async function log(guild, c, user, reason, action) {
    if (!c.logChannelId) return;
    const ch = guild.channels.cache.get(c.logChannelId);
    if (!ch || !ch.isTextBased()) return;
    const e = new EmbedBuilder().setColor(0xef4444).setTitle('AutoMod').setDescription(user.tag + ' (' + user.id + ')')
      .addFields({ name: 'Reason', value: reason, inline: true }, { name: 'Action', value: action, inline: true }).setTimestamp();
    await ch.send({ embeds: [e] }).catch(() => {});
  }

  client.on(Events.MessageCreate, async (msg) => {
    if (!msg.guild || msg.author.bot || !msg.member) return;
    try {
      const s = await getSettings(msg.guildId);
      const c = s.automod;
      if (!c || !c.enabled) return;
      if (msg.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
      const text = msg.content || '';
      const low = text.toLowerCase();
      let reason = null;

      if (c.antiInvite && (low.includes('discord.gg/') || low.includes('discord.com/invite/') || low.includes('discordapp.com/invite/'))) reason = 'Invite links are not allowed';
      else if (c.antiLinks && (low.includes('http://') || low.includes('https://') || low.includes('www.'))) reason = 'Links are not allowed';
      else if (c.antiMention && msg.mentions.users.size + msg.mentions.roles.size > (c.mentionMax || 5)) reason = 'Too many mentions';
      else if (c.antiCaps && text.length >= 15) {
        const letters = Array.from(text).filter((ch) => ch.toLowerCase() !== ch.toUpperCase());
        const upper = letters.filter((ch) => ch === ch.toUpperCase());
        if (letters.length >= 10 && upper.length / letters.length > 0.7) reason = 'Too many capital letters';
      }
      if (!reason && c.badWords && c.badWords.length) {
        const padded = ' ' + low.replace(/[^\p{L}\p{N}]+/gu, ' ') + ' ';
        if (c.badWords.some((w) => padded.includes(' ' + w + ' '))) reason = 'Blocked word';
      }
      if (!reason && c.antiSpam) {
        const key = msg.guildId + ':' + msg.author.id;
        const now = Date.now();
        const win = (c.spamSeconds || 5) * 1000;
        const arr = (spam.get(key) || []).filter((t) => now - t < win);
        arr.push(now);
        spam.set(key, arr);
        if (arr.length >= (c.spamMax || 6)) { reason = 'Spam'; spam.delete(key); }
      }
      if (!reason) return;

      if (msg.deletable) await msg.delete().catch(() => {});
      let action = 'Message deleted';
      if (c.punishment === 'timeout' && msg.member.moderatable) {
        const ok = await msg.member.timeout(Math.max(1, c.timeoutMin || 5) * 60000, 'AutoMod: ' + reason).then(() => true).catch(() => false);
        if (ok) action = 'Message deleted + timeout ' + (c.timeoutMin || 5) + 'm';
      }
      const warn = await msg.channel.send({ content: msg.author + ', ' + reason + '.', allowedMentions: { users: [msg.author.id] } }).catch(() => null);
      if (warn) setTimeout(() => warn.delete().catch(() => {}), 5000);
      await log(msg.guild, c, msg.author, reason, action);
    } catch (e) { console.error('automod', e.message); }
  });
}
