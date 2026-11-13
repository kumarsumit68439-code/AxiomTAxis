import { Events } from 'discord.js';

export function attachWelcome(client, cfg) {
  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      const ch = (cfg.channelId && member.guild.channels.cache.get(cfg.channelId)) || member.guild.systemChannel;
      if (!ch || !ch.isTextBased()) return;
      const tpl = cfg.message || 'Welcome {user} to {server}!';
      const text = tpl
        .replaceAll('{user}', '<@' + member.id + '>')
        .replaceAll('{username}', member.user.username)
        .replaceAll('{server}', member.guild.name)
        .replaceAll('{count}', String(member.guild.memberCount));
      await ch.send({ content: text, allowedMentions: { users: [member.id] } });
    } catch (e) { console.error('welcome', e.message); }
  });
}
