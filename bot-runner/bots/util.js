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

const cache = new Map();

export async function getSettings(gid) {
  if (cache.has(gid)) return cache.get(gid);
  let d = null;
  try {
    if (sb) {
      const { data } = await sb.from('guild_settings').select('data').eq('guild_id', gid).maybeSingle();
      d = data && data.data;
    } else d = local[gid];
  } catch (e) { console.error('getSettings', e.message); }
  d = d || {};
  cache.set(gid, d);
  return d;
}

export async function saveSettings(gid, d) {
  cache.set(gid, d);
  try {
    if (sb) await sb.from('guild_settings').upsert({ guild_id: gid, data: d, updated_at: new Date().toISOString() });
    else { local[gid] = d; fs.writeFileSync(file, JSON.stringify(local)); }
  } catch (e) { console.error('saveSettings', e.message); }
}
