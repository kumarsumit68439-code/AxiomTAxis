import { Client, GatewayIntentBits as G, Events, ActivityType } from 'discord.js';
import * as simple from './bots/simple.js';
import * as welcome from './bots/welcome.js';
import * as ai from './bots/ai.js';
import * as music from './bots/music.js';
import * as counting from './bots/counting.js';
import * as verification from './bots/verification.js';
import * as logging from './bots/logging.js';
import * as ticket from './bots/ticket.js';
import * as level from './bots/level.js';
import { storageMode } from './bots/util.js';
import { startStats } from './stats.js';

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('DISCORD_TOKEN is not set');
  process.exit(1);
}

const BASE = [G.Guilds, G.GuildVoiceStates];
const PRIVILEGED = [G.GuildMembers, G.GuildMessages, G.MessageContent];
const ALL = [
  ...simple.commands,
  ...welcome.commands,
  ...ai.commands,
  ...music.commands,
  ...counting.commands,
  ...verification.commands,
  ...logging.commands,
  ...ticket.commands,
  ...level.commands
];

let current = null;
let mode = 'starting';
startStats(() => ({ client: current, mode }));

async function boot(full) {
  const client = new Client({ intents: full ? [...BASE, ...PRIVILEGED] : BASE });
  simple.attach(client);
  welcome.attach(client);
  ai.attach(client);
  music.attach(client);
  counting.attach(client);
  verification.attach(client);
  logging.attach(client);
  ticket.attach(client);
  level.attach(client);

  client.once(Events.ClientReady, async (c) => {
    try {
      await c.application.commands.set(ALL);
      console.log('Registered', ALL.length, 'global commands');
    } catch (e) {
      console.error('command registration failed', e.message);
    }
    c.user.setActivity('/help', { type: ActivityType.Listening });
    console.log(
      'Online as', c.user.tag,
      '| mode:', full ? 'full' : 'basic',
      '| storage:', storageMode,
      '| servers:', c.guilds.cache.size
    );
    if (!full) {
      console.warn('Privileged intents off — enable Message Content + Server Members Intent for full features.');
    }
  });
  client.on('error', (e) => console.error('client error', e.message));

  try {
    await client.login(token);
  } catch (e) {
    try { await client.destroy(); } catch {}
    throw e;
  }
  current = client;
  mode = full ? 'full' : 'basic';
  return client;
}

process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));

try {
  await boot(true);
} catch (e) {
  if (/disallowed intents/i.test(String(e.message))) {
    console.warn('Privileged intents not enabled. Starting basic mode.');
    await boot(false);
  } else {
    console.error('login failed', e.message);
    process.exit(1);
  }
}
