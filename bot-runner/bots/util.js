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

// Memory fallback: agar Supabase read/write fail ho (jaise table missing), settings process memory me
// rehti hain — pehle ye har 10 second me {} se reset ho jaati thi (memes type/enabled, AI channel gayab).
const mem = new Map();

// Error logs ko har minute me ek baar hi print karte hain (loop spam na ho).
const logAt = new Map();
function logOnce(tag, msg) {
  const k = tag + msg;
  const now = Date.now();
  if (now - (logAt.get(k) || 0) < 60000) return;
  logAt.set(k, now);
  console.error(tag, msg);
}

// Safe saves: har object ka read-time snapshot (bases) rakhte hain, taaki save sirf wahi sections likhe
// jo is handler ne badle, baaki (memes type/lock, ai channel, etc.) kabhi overwrite na ho.
const bases = new WeakMap();
const snap = (d) => {
  const o = {};
  for (const k of Object.keys(d)) o[k] = JSON.stringify(d[k]);
  return o;
};

export async function getSettings(gid) {
  const c = cache.get(gid);
  if (c && (!sb || Date.now() - c.t < TTL)) return c.d;
  let d = null;
  try {
    if (sb) {
      const { data, error } = await sb.from('guild_settings').select('data').eq('guild_id', gid).maybeSingle();
      if (error) throw new Error(error.message);
      d = data && data.data;
    } else d = local[gid];
  } catch (e) {
    logOnce('getSettings', e.message);
    const keep = mem.get(gid) || (c && c.d) || {};
    cache.set(gid, { d: keep, t: Date.now() });
    return keep;
  }
  d = d || mem.get(gid) || {};
  bases.set(d, snap(d));
  mem.set(gid, d);
  cache.set(gid, { d, t: Date.now() });
  return d;
}

export async function saveSettings(gid, d) {
  cache.set(gid, { d, t: Date.now() });
  mem.set(gid, d);
  try {
    if (sb) {
      let merged = d;
      const base = bases.get(d);
      if (base) {
        const changed = Object.keys(d).filter((k) => JSON.stringify(d[k]) !== base[k]);
        const removed = Object.keys(base).filter((k) => !(k in d));
        const { data, error: rerr } = await sb.from('guild_settings').select('data').eq('guild_id', gid).maybeSingle();
        if (rerr) throw new Error(rerr.message);
        const latest = (data && data.data) || {};
        merged = { ...latest };
        for (const k of changed) merged[k] = d[k];
        for (const k of removed) delete merged[k];
        for (const k of Object.keys(merged)) {
          if (!changed.includes(k)) d[k] = merged[k];
        }
      }
      const { error } = await sb.from('guild_settings').upsert({ guild_id: gid, data: merged, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      bases.set(d, snap(d));
    } else { local[gid] = d; fs.writeFileSync(file, JSON.stringify(local)); }
  } catch (e) { logOnce('saveSettings', e.message); }
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
