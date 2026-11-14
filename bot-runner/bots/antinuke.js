import { Events, AuditLogEvent, EmbedBuilder } from 'discord.js';
import { getSettings } from './util.js';

export const commands = [];

const hits = new Map();

// Detects mass channel/role deletes, bans and kicks via the audit log, then punishes the executor.
// Needs: View Audit Log, Ban Members, Kick Members, Manage Roles, and the bot role above the target.
export function attach(client) {
  async function punish(guild, user, cfg, reason) {
    const mode = cfg.punishment || 'ban';
    let result = mode;
    try {
      if (mode === 'ban') await guild.members.ban(user.id, { reason: 'Anti-Nuke: ' + reason });
      else {
        const m = await guild.members.fetch(user.id);
        if (mode === 'kick') await m.kick('Anti-Nuke: ' + reason);
        else await m.roles.set(m.roles.cache.filter((r) => r.managed || r.id === guild.id).map((r) => r.id), 'Anti-Nuke: ' + reason);
      }
    } catch (e) { result = 'FAILED (' + e.message + '). Move the bot role higher.'; }
    const ch = cfg.logChannelId && guild.channels.cache.get(cfg.logChannelId);
    if (ch && ch.isTextBased()) {
      const e = new EmbedBuilder().setColor(0xef4444).setTitle('Anti-Nuke triggered')
        .setDescription(user.tag + ' (' + user.id + ')')
        .addFields({ name: 'Reason', value: reason, inline: true }, { name: 'Action', value: result, inline: true }).setTimestamp();
      await ch.send({ embeds: [e] }).catch(() => {});
    }
  }

  async function guard(guild, type, match, label) {
    try {
      const s = await getSettings(guild.id);
      const cfg = s.antinuke;
      if (!cfg || !cfg.enabled) return;
      const logs = await guild.fetchAuditLogs({ type, limit: 5 }).catch(() => null);
      if (!logs) return;
      const entry = [...logs.entries.values()].find((x) => Date.now() - x.createdTimestamp < 15000 && match(x));
      if (!entry || !entry.executor) return;
      const ex = entry.executor;
      if (ex.id === client.user.id || ex.id === guild.ownerId || (cfg.whitelist || []).includes(ex.id)) return;
      const key = guild.id + ':' + ex.id;
      const now = Date.now();
      const win = (cfg.seconds || 10) * 1000;
      const arr = (hits.get(key) || []).filter((t) => now - t < win);
      arr.push(now);
      hits.set(key, arr);
      if (arr.length < (cfg.limit || 3)) return;
      hits.delete(key);
      await punish(guild, ex, cfg, label + ' x' + arr.length + ' in ' + (cfg.seconds || 10) + 's');
    } catch (e) { console.error('antinuke', e.message); }
  }

  client.on(Events.ChannelDelete, (ch) => { if (ch.guild) guard(ch.guild, AuditLogEvent.ChannelDelete, (x) => x.targetId === ch.id, 'Channel deletes'); });
  client.on(Events.GuildRoleDelete, (r) => guard(r.guild, AuditLogEvent.RoleDelete, (x) => x.targetId === r.id, 'Role deletes'));
  client.on(Events.GuildBanAdd, (b) => guard(b.guild, AuditLogEvent.MemberBanAdd, (x) => x.targetId === b.user.id, 'Mass bans'));
  client.on(Events.GuildMemberRemove, (m) => guard(m.guild, AuditLogEvent.MemberKick, (x) => x.targetId === m.id, 'Mass kicks'));
}
