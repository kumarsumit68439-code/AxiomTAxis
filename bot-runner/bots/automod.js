import { Events, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getSettings, guildLog } from './util.js';

export const commands = [];

const INVITE = /(discord[.]gg|discord(app)?[.]com[/]invite)[/][A-Za-z0-9-]+/i;
const LINK = /https?:[/][/][^ ]+/i;

function isCaps(txt) {
  const letters = txt.replace(/[^A-Za-z]/g, '');
  return letters.length >= 10 && letters.replace(/[^A-Z]/g, '').length / letters.length >= 0.7;
}

// Needs Message Content intent (full mode). Staff with Manage Messages are exempt.
export function attach(client) {
  const hist = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hist) if (!v.length || now - v[v.length - 1] > 60000) hist.delete(k);
  }, 300000).unref();

  client.on(Events.MessageCreate, async (m) => {
    try {
      if (!m.guild || m.author.bot || !m.member) return;
      const c = (await getSettings(m.guild.id)).automod;
      if (!c || !c.enabled) return;
      if (m.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
      const txt = m.content || '';
      const lower = txt.toLowerCase();
      let reason = null;
      if (c.invites && INVITE.test(txt)) reason = 'Invite link';
      else if (c.links && LINK.test(txt)) reason = 'Link';
      else if (c.mentions && m.mentions.users.size + m.mentions.roles.size >= (c.maxMentions || 5)) reason = 'Mass mention';
      else if (c.caps && isCaps(txt)) reason = 'Excessive caps';
      else if ((c.words || []).some((w) => w && lower.includes(w))) reason = 'Blocked word';
      else if (c.spam) {
        const key = m.guild.id + ':' + m.author.id;
        const now = Date.now();
        const arr = (hist.get(key) || []).filter((t) => now - t < (c.spamSeconds || 6) * 1000);
        arr.push(now);
        hist.set(key, arr);
        if (arr.length >= (c.spamCount || 5)) { reason = 'Spam'; hist.delete(key); }
      }
      if (!reason) return;

      await m.delete().catch(() => {});
      if (c.action === 'timeout' && m.member.moderatable) {
        await m.member.timeout((c.timeoutMin || 10) * 60000, 'AutoMod: ' + reason).catch(() => {});
      }
      const note = await m.channel.send({ content: m.author + ', ' + reason + ' is not allowed here.', allowedMentions: { users: [m.author.id] } }).catch(() => null);
      if (note) setTimeout(() => note.delete().catch(() => {}), 5000);
      await guildLog(m.guild, new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle('AutoMod: ' + reason)
        .setDescription(m.author + ' in ' + m.channel + (c.action === 'timeout' ? ' (timed out)' : ''))
        .addFields({ name: 'Message', value: (txt || '-').slice(0, 900) })
        .setTimestamp());
    } catch (e) { console.error('automod', e.message); }
  });
}
