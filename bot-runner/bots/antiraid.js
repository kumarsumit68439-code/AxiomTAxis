import { Events, EmbedBuilder } from 'discord.js';
import { getSettings, guildLog } from './util.js';

export const commands = [];

// Needs Server Members intent (full mode) and Kick/Ban/Moderate Members permission.
export function attach(client) {
  const joins = new Map();
  const lockUntil = new Map();

  async function act(member, c, reason) {
    const why = 'Anti-Raid: ' + reason;
    let done = 'none';
    try {
      if (c.action === 'ban') { await member.ban({ reason: why }); done = 'banned'; }
      else if (c.action === 'timeout') { await member.timeout(3600000, why); done = 'timed out 60m'; }
      else { await member.kick(why); done = 'kicked'; }
    } catch { done = 'failed (permissions?)'; }
    await guildLog(member.guild, new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle('Anti-Raid: ' + reason)
      .setDescription(member + ' (' + member.id + ') - **' + done + '**')
      .setTimestamp());
  }

  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      const c = (await getSettings(member.guild.id)).antiraid;
      if (!c || !c.enabled || member.user.bot) return;
      const gid = member.guild.id;
      const now = Date.now();
      let reason = null;

      const ageDays = (now - member.user.createdTimestamp) / 86400000;
      if (c.minAccountAgeDays > 0 && ageDays < c.minAccountAgeDays) reason = 'Account too new (' + ageDays.toFixed(1) + ' days)';

      const win = (c.windowSec || 10) * 1000;
      const arr = (joins.get(gid) || []).filter((j) => now - j.t < win);
      arr.push({ id: member.id, t: now });
      joins.set(gid, arr);

      if (arr.length >= (c.joins || 8) && !((lockUntil.get(gid) || 0) > now)) {
        lockUntil.set(gid, now + 120000);
        for (const j of arr) {
          if (j.id === member.id) continue;
          const m = member.guild.members.cache.get(j.id);
          if (m) await act(m, c, 'Raid detected');
        }
        reason = 'Raid detected';
      } else if ((lockUntil.get(gid) || 0) > now) {
        reason = reason || 'Raid lockdown active';
      }
      if (reason) await act(member, c, reason);
    } catch (e) { console.error('antiraid', e.message); }
  });
}
