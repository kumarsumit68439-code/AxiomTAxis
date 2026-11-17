import { Events, MessageFlags } from 'discord.js';
import { getSettings, saveSettings, MANAGE } from './util.js';

export const commands = [
  { name: 'ping', description: 'Check bot latency' },
  { name: 'help', description: 'Show what this bot can do' },
  { name: 'c', description: 'Run a custom server command', dm_permission: false,
    options: [{ name: 'name', description: 'Command name', type: 3, required: true, autocomplete: true }] },
  { name: 'command', description: 'Manage custom commands', default_member_permissions: MANAGE, dm_permission: false,
    options: [
      { name: 'add', description: 'Add or update a custom command', type: 1, options: [
        { name: 'name', description: 'Name (a-z, 0-9, - _)', type: 3, required: true, max_length: 32 },
        { name: 'reply', description: 'Reply text', type: 3, required: true, max_length: 1800 }] },
      { name: 'remove', description: 'Remove a custom command', type: 1, options: [
        { name: 'name', description: 'Command name', type: 3, required: true, autocomplete: true }] },
      { name: 'list', description: 'List custom commands', type: 1 }
    ] }
];

const HELP = [
  '**AxiomTAxis — Discord commands**',
  'Most modules website se bhi set hote hain: https://axiomtaxis-website.vercel.app/dashboard.html',
  '',
  '**Music:** `/play` `/join` `/stop`',
  '**AI:** `/ai channel` `/ai off` `/ai status` (ek baar channel set = permanent)',
  '**Welcome:** `/welcome set|leave|off|status`',
  '**Counting:** `/counting set|off|reset|status`',
  '**Level:** `/level rank|leaderboard|set|off`',
  '**Ticket:** `/ticket setup|off|status`',
  '**Verification:** `/verification setup|off|status`',
  '**Logging:** `/logging set|off|status`',
  '**Memes:** `/meme` + `/memes set|off|status` (auto every N min)',
  '**Suggestions:** `/suggest`',
  '**Triggers:** `/c name` + `/command add|remove|list`',
  '**Other:** `/ping` `/help`',
  '',
  'AutoMod / AntiNuke / AntiRaid / YT / Profile → website dashboard only.'
].join('\n');

export function attach(client) {
  client.on(Events.InteractionCreate, async (i) => {
    try {
      if (i.isAutocomplete() && (i.commandName === 'c' || i.commandName === 'command')) {
        const s = await getSettings(i.guildId);
        const f = String(i.options.getFocused()).toLowerCase();
        return i.respond(Object.keys(s.commands || {}).filter((n) => n.includes(f)).slice(0, 25).map((n) => ({ name: n, value: n })));
      }
      if (!i.isChatInputCommand()) return;
      if (i.commandName === 'ping') return i.reply('Pong! ' + Math.round(client.ws.ping) + 'ms');
      if (i.commandName === 'help') return i.reply(HELP);
      if (i.commandName === 'c') {
        const s = await getSettings(i.guildId);
        const r = (s.commands || {})[i.options.getString('name', true)];
        return i.reply(r ? { content: r, allowedMentions: { parse: [] } } : { content: 'Command nahi mila.', flags: MessageFlags.Ephemeral });
      }
      if (i.commandName === 'command') {
        const s = await getSettings(i.guildId);
        s.commands = s.commands || {};
        const sub = i.options.getSubcommand();
        if (sub === 'list') {
          const names = Object.keys(s.commands);
          return i.reply({ content: names.length ? names.map((n) => '`' + n + '`').join(', ') : 'Koi custom command nahi.', flags: MessageFlags.Ephemeral });
        }
        const name = i.options.getString('name', true).toLowerCase();
        if (sub === 'remove') {
          delete s.commands[name];
          await saveSettings(i.guildId, s);
          return i.reply({ content: 'Removed `' + name + '`.', flags: MessageFlags.Ephemeral });
        }
        if (!/^[a-z0-9_-]{1,32}$/.test(name)) return i.reply({ content: 'Name sirf a-z, 0-9, - aur _ ho sakta hai.', flags: MessageFlags.Ephemeral });
        if (!s.commands[name] && Object.keys(s.commands).length >= 50) return i.reply({ content: 'Max 50 commands.', flags: MessageFlags.Ephemeral });
        s.commands[name] = i.options.getString('reply', true);
        await saveSettings(i.guildId, s);
        return i.reply({ content: 'Saved. Use `/c ' + name + '`.', flags: MessageFlags.Ephemeral });
      }
    } catch (e) { console.error('simple', e.message); }
  });
}
