import { Events } from 'discord.js';
import { registerCommands } from './util.js';

export function attachSimple(client, cfg) {
  const custom = (cfg.commands || [])
    .filter((c) => c && /^[a-z0-9_-]{1,32}$/.test(c.name) && c.reply)
    .filter((c) => c.name !== 'ping' && c.name !== 'help');
  const map = new Map(custom.map((c) => [c.name, c.reply]));
  const defs = [
    { name: 'ping', description: 'Check bot latency' },
    { name: 'help', description: 'List commands' },
    ...custom.map((c) => ({ name: c.name, description: 'Custom command' }))
  ];
  registerCommands(client, defs);
  client.on(Events.InteractionCreate, async (i) => {
    if (!i.isChatInputCommand()) return;
    if (i.commandName === 'ping') return i.reply('Pong! ' + Math.round(client.ws.ping) + 'ms');
    if (i.commandName === 'help') return i.reply('Commands: ' + defs.map((d) => '/' + d.name).join(', '));
    const reply = map.get(i.commandName);
    if (reply) return i.reply(reply);
  });
}
