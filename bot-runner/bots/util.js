import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { PermissionFlagsBits } from 'discord.js';

export const MANAGE = String(PermissionFlagsBits.ManageGuild);

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
const sb = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
  : null;
export const storageMode = sb ? 'supabase' : 'file';

const dir = process.env.DATA_DIR || './data';
const file = path.join(dir, 'settings.json');
let local = {};
if (!sb) {
  try { fs.mkdirSync(dir, { recursive: true }); local = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
}

// In Supabase mode the cache expires after 10s so direct dashboard writes reach the bot quickly.
const cache = new Map();
const TTL = 10000;

export async function getSettings(gid) {
  const c = cache.get(gid);
  if (c && (!sb || Date.now() - c.t < TTL)) return c.d;
  let d = null;
  try {
    if (sb) {
      const { data } = await sb.from('guild_settings').select('data').eq('guild_id', gid).maybeSingle();
      d = data && data.data;
    } else d = local[gid];
  } catch (e) {
    console.error('getSettings', e.message);
    if (c) return c.d;
  }
  d = d || {};
  cache.set(gid, { d, t: Date.now() });
  return d;
}

export async function saveSettings(gid, d) {
  cache.set(gid, { d, t: Date.now() });
  try {
    if (sb) await sb.from('guild_settings').upsert({ guild_id: gid, data: d, updated_at: new Date().toISOString() });
    else { local[gid] = d; fs.writeFileSync(file, JSON.stringify(local)); }
  } catch (e) { console.error('saveSettings', e.message); }
}

// Send an embed to the server's log channel (Logging panel), if one is set.
export async function guildLog(guild, embed) {
  try {
    const s = await getSettings(guild.id);
    const id = s.logging && s.logging.channelId;
    if (!id) return;
    const ch = await guild.channels.fetch(id).catch(() => null);
    if (ch && ch.isTextBased()) await ch.send({ embeds: [embed] }).catch(() => {});
  } catch {}
}
