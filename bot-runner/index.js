import { Client, GatewayIntentBits as G, Events, ActivityType } from 'discord.js';
import * as simple from './bots/simple.js';
import * as welcome from './bots/welcome.js';
import * as ai from './bots/ai.js';
import * as music from './bots/music.js';
import { storageMode } from './bots/util.js';

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('DISCORD_TOKEN is not set');
  process.exit(1);
}

const BASE = [G.Guilds, G.GuildVoiceStates];
// Privileged intents: must be enabled in Discord Developer Portal > Bot.
const PRIVILEGED = [G.GuildMembers, G.GuildMessages, G.MessageContent];
const ALL = [...simple.commands, ...welcome.commands, ...ai.commands, ...music.commands];

async function boot(full) {
  const client = new Client({ intents: full ? [...BASE, ...PRIVILEGED] : BASE });
  simple.attach(client);
  welcome.attach(client);
  ai.attach(client);
  music.attach(client);

  client.once(Events.ClientReady, async (c) => {
    try {
      await c.application.commands.set(ALL);
      console.log('Registered', ALL.length, 'global commands');
    } catch (e) {
      console.error('command registration failed', e.message);
    }
    c.user.setActivity('/help', { type: ActivityType.Listening });
    console.log('Online as', c.user.tag, '| mode:', full ? 'full' : 'basic (no privileged intents)', '| settings storage:', storageMode, '| servers:', c.guilds.cache.size);
    if (!full) console.warn('AI chat and welcome need Server Members Intent + Message Content Intent enabled in the Developer Portal (Bot tab). Then redeploy.');
  });
  client.on('error', (e) => console.error('client error', e.message));

  try {
    await client.login(token);
  } catch (e) {
    try { await client.destroy(); } catch {}
    throw e;
  }
  return client;
}

process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));

try {
  await boot(true);
} catch (e) {
  if (/disallowed intents/i.test(String(e.message))) {
    console.warn('Privileged intents are not enabled in the Developer Portal. Starting in basic mode (music, ping, help, custom commands only).');
    await boot(false);
  } else {
    console.error('login failed', e.message);
    process.exit(1);
  }
}
