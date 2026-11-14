import { Events, AuditLogEvent, EmbedBuilder } from 'discord.js';
import { getSettings, guildLog } from './util.js';

export const commands = [];

// Needs View Audit Log (and Kick/Ban/Manage Roles for punishments). The server owner, the bot and the whitelist are never punished.
export function attach(client) {
  const hits = new Map();
  const seen = new Set();

  async function watch(guild, auditType, flag) {
    try {
      const c = (await getSettings(guild.id)).antinuke;
      if (!c || !c.enabled || c[flag] === false) return;
      const logs = await guild.fetchAuditLogs({ type: auditType, limit: 1 }).catch(() => null);
      const e = logs && logs.entries.first();
      if (!e || !e.executor || Date.now() - e.createdTimestamp > 8000) return;
      if (seen.has(e.id)) return;
      seen.add(e.id);
      if (seen.size > 500) seen.clear();
      const uid = e.executor.id;
      if (uid === guild.ownerId || uid === client.user.id || (c.whitelist || []).includes(uid)) return;
      const key = guild.id + ':' + uid;
      const now = Date.now();
      const win = (c.windowSec || 30) * 1000;
      const arr = (hits.get(key) || []).filter((t) => now - t < win);
      arr.push(now);
      hits.set(key, arr);
      if (arr.length < (c.limit || 3)) return;
      hits.delete(key);
      await punish(guild, uid, c.punishment || 'removeroles', arr.length + ' destructive actions in ' + (c.windowSec || 30) + 's');
    } catch (e) { console.error('antinuke', e.message); }
  }

  async function punish(guild, uid, how, reason) {
    let done = 'no action (missing permissions?)';
    const member = await guild.members.fetch(uid).catch(() => null);
    const why = 'Anti-Nuke: ' + reason;
    if (how === 'ban') {
      await guild.members.ban(uid, { reason: why }).then(() => { done = 'banned'; }).catch(() => {});
    } else if (member && how === 'kick') {
      await member.kick(why).then(() => { done = 'kicked'; }).catch(() => {});
    } else if (member) {
      const me = guild.members.me;
      const roles = member.roles.cache.filter((r) => r.id !== guild.id && !r.managed && me && r.position < me.roles.highest.position);
      await member.roles.remove(roles, why).then(() => { done = 'roles removed'; }).catch(() => {});
    }
    await guildLog(guild, new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle('Anti-Nuke triggered')
      .setDescription('<@' + uid + '> (' + uid + ')\n' + reason + '\nResult: **' + done + '**')
      .setTimestamp());
  }

  client.on(Events.ChannelDelete, (ch) => ch.guild && watch(ch.guild, AuditLogEvent.ChannelDelete, 'protectChannels'));
  client.on(Events.ChannelCreate, (ch) => ch.guild && watch(ch.guild, AuditLogEvent.ChannelCreate, 'protectChannels'));
  client.on(Events.GuildRoleDelete, (r) => watch(r.guild, AuditLogEvent.RoleDelete, 'protectRoles'));
  client.on(Events.GuildBanAdd, (b) => watch(b.guild, AuditLogEvent.MemberBanAdd, 'protectBans'));
}
