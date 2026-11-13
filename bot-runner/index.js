import { createClient } from '@supabase/supabase-js';
import { Client, GatewayIntentBits as G } from 'discord.js';
import { attachSimple } from './bots/simple.js';
import { attachWelcome } from './bots/welcome.js';
import { attachAI } from './bots/ai.js';
import { attachMusic } from './bots/music.js';

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const INTENTS = {
  simple: [G.Guilds],
  welcome: [G.Guilds, G.GuildMembers],
  ai: [G.Guilds, G.GuildMessages, G.MessageContent],
  music: [G.Guilds, G.GuildVoiceStates]
};
const HANDLERS = { simple: attachSimple, welcome: attachWelcome, ai: attachAI, music: attachMusic };

const running = new Map(); // id -> { client, stamp }

async function setStatus(id, status, detail = null) {
  await sb.from('bots').update({ status, status_detail: detail }).eq('id', id);
}

async function stop(id) {
  const r = running.get(id);
  running.delete(id);
  if (r && r.client) { try { await r.client.destroy(); } catch {} }
}

async function start(b, stamp) {
  const client = new Client({ intents: INTENTS[b.type] });
  running.set(b.id, { client, stamp });
  client.on('error', (e) => console.error(b.name, 'client error', e.message));
  try {
    HANDLERS[b.type](client, b.config || {});
    await client.login(b.token);
    await setStatus(b.id, 'online', client.user.tag);
    console.log('started', b.name, b.type);
  } catch (e) {
    console.error('failed', b.name, e.message);
    try { await client.destroy(); } catch {}
    running.set(b.id, { client: null, stamp });
    await setStatus(b.id, 'error', String(e.message).slice(0, 200));
  }
}

let syncing = false;
async function sync() {
  if (syncing) return;
  syncing = true;
  try {
    const { data, error } = await sb.from('bots').select('*');
    if (error) throw error;
    const live = new Map(data.filter((b) => b.enabled).map((b) => [b.id, b]));
    for (const id of [...running.keys()]) {
      if (!live.has(id)) {
        await stop(id);
        await setStatus(id, 'offline');
      }
    }
    for (const b of live.values()) {
      const stamp = b.type + '|' + b.token + '|' + JSON.stringify(b.config);
      const r = running.get(b.id);
      if (r && r.stamp === stamp) continue;
      if (r) await stop(b.id);
      await start(b, stamp);
    }
  } catch (e) {
    console.error('sync error', e.message);
  } finally {
    syncing = false;
  }
}

await sync();
setInterval(sync, 15000);
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
console.log('AxiomTAxis bot-runner running');
