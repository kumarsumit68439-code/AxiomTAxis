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

const client = new Client({
  intents: [G.Guilds, G.GuildMembers, G.GuildMessages, G.MessageContent, G.GuildVoiceStates]
});

simple.attach(client);
welcome.attach(client);
ai.attach(client);
music.attach(client);

const ALL = [...simple.commands, ...welcome.commands, ...ai.commands, ...music.commands];

client.once(Events.ClientReady, async (c) => {
  try {
    await c.application.commands.set(ALL);
    console.log('Registered', ALL.length, 'global commands');
  } catch (e) {
    console.error('command registration failed', e.message);
  }
  c.user.setActivity('/help', { type: ActivityType.Listening });
  console.log('Online as', c.user.tag, '| settings storage:', storageMode, '| servers:', c.guilds.cache.size);
});

client.on('error', (e) => console.error('client error', e.message));
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));

await client.login(token);
