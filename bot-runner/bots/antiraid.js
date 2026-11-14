import { Events, EmbedBuilder } from 'discord.js';
import { getSettings } from './util.js';

export const commands = [];

const joins = new Map();
const raidUntil = new Map();

// Join-flood detection + minimum account age. Needs the Server Members intent.
export function attach(client) {
  async function act(member, cfg, reason) {
    const a = cfg.action || 'kick';
    try {
      if (a === 'ban') await member.ban({ reason: 'Anti-Raid: ' + reason });
      else if (a === 'timeout') await member.timeout(24 * 3600 * 1000, 'Anti-Raid: ' + reason);
      else await member.kick('Anti-Raid: ' + reason);
      return true;
    } catch { return false; }
  }

  async function log(guild, cfg, title, text) {
    const ch = cfg.logChannelId && guild.channels.cache.get(cfg.logChannelId);
    if (!ch || !ch.isTextBased()) return;
    await ch.send({ embeds: [new EmbedBuilder().setColor(0xef4444).setTitle(title).setDescription(text).setTimestamp()] }).catch(() => {});
  }

  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      if (member.user.bot) return;
      const s = await getSettings(member.guild.id);
      const cfg = s.antiraid;
      if (!cfg || !cfg.enabled) return;
      const gid = member.guild.id;
      const now = Date.now();

      if (cfg.minAccountDays > 0 && now - member.user.createdTimestamp < cfg.minAccountDays * 86400000) {
        const ok = await act(member, cfg, 'account younger than ' + cfg.minAccountDays + ' days');
        await log(member.guild, cfg, 'Anti-Raid: new account', member.user.tag + ' (' + member.id + ') - ' + (ok ? cfg.action || 'kick' : 'action failed'));
        return;
      }

      const win = (cfg.seconds || 10) * 1000;
      const arr = (joins.get(gid) || []).filter((j) => now - j.ts < win);
      arr.push({ id: member.id, ts: now });
      joins.set(gid, arr);

      if ((raidUntil.get(gid) || 0) > now) {
        await act(member, cfg, 'raid in progress');
        return;
      }
      if (arr.length >= (cfg.joinLimit || 8)) {
        raidUntil.set(gid, now + win * 2);
        let done = 0;
        for (const j of arr) {
          const m = member.guild.members.cache.get(j.id) || await member.guild.members.fetch(j.id).catch(() => null);
          if (m && await act(m, cfg, 'join flood')) done++;
        }
        joins.delete(gid);
        await log(member.guild, cfg, 'Anti-Raid: raid detected', arr.length + ' joins in ' + (cfg.seconds || 10) + 's. Action on ' + done + ' members (' + (cfg.action || 'kick') + ').');
      }
    } catch (e) { console.error('antiraid', e.message); }
  });
}
