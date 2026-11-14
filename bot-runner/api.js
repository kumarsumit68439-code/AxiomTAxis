import { ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getSettings, saveSettings } from './bots/util.js';
import { postMeme } from './bots/memes.js';

// Dashboard API. Every call must carry the user's Discord OAuth token; it is checked against
// Discord (user must have Manage Server / Administrator / be owner in that guild, and the bot must be in it).

const err = (status, message) => Object.assign(new Error(message), { status });
const flag = (v) => v === true || v === 'true';
const num = (v, min, max, d) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d; };
const snow = (v) => (/^[0-9]{17,20}$/.test(String(v || '')) ? String(v) : null);
const str = (v, max) => String(v == null ? '' : v).slice(0, max);
const pick = (v, list, d) => (list.includes(v) ? v : d);
const TEXT = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const chanId = (g, v, types) => {
  const id = snow(v);
  const c = id && g.channels.cache.get(id);
  return c && (!types || types.includes(c.type)) ? id : null;
};
const list = (v, re) => (Array.isArray(v) ? v : String(v || '').split(re));

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > 60000) { reject(err(413, 'Body too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(err(400, 'Invalid JSON')); }
    });
    req.on('error', () => reject(err(400, 'Bad request')));
  });
}

const guildCache = new Map();
async function userGuilds(token) {
  const c = guildCache.get(token);
  if (c && Date.now() - c.t < 60000) return c.list;
  const r = await fetch('https://discord.com/api/v10/users/@me/guilds', { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw err(401, 'Discord session expired. Logout and login again.');
  const l = await r.json();
  if (guildCache.size > 200) guildCache.clear();
  guildCache.set(token, { t: Date.now(), list: l });
  return l;
}
async function authGuild(req, gid, client) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!token) throw err(401, 'Missing Discord token. Logout and login again.');
  const g = (await userGuilds(token)).find((x) => x.id === gid);
  if (!g) throw err(403, 'You are not in this server.');
  const perm = BigInt(g.permissions || '0');
  if (!(g.owner || (perm & 0x8n) || (perm & 0x20n))) throw err(403, 'You need Manage Server permission.');
  const guild = client.guilds.cache.get(gid);
  if (!guild) throw err(404, 'Bot is not in this server. Invite the bot first.');
  return guild;
}

const SECTIONS = {
  logging: (d, g) => ({ channelId: chanId(g, d.channelId, TEXT) }),
  suggestions: (d, g) => ({ enabled: flag(d.enabled), channelId: chanId(g, d.channelId, TEXT) }),
  yt: (d, g, old) => {
    const prev = new Map(((old && old.subs) || []).map((s) => [s.id, s]));
    const subs = [];
    for (const s of Array.isArray(d.subs) ? d.subs.slice(0, 10) : []) {
      const id = str(s && s.id, 40);
      if (!/^UC[A-Za-z0-9_-]{22}$/.test(id) || subs.some((x) => x.id === id)) continue;
      subs.push({ id, name: str(s.name, 60), last: prev.get(id) ? prev.get(id).last : undefined });
    }
    return { enabled: flag(d.enabled), channelId: chanId(g, d.channelId, TEXT), message: str(d.message, 500), subs };
  },
  memes: (d, g) => ({
    enabled: flag(d.enabled),
    channelId: chanId(g, d.channelId, TEXT),
    intervalMin: num(d.intervalMin, 5, 1440, 60),
    subreddit: /^[A-Za-z0-9_]{1,21}$/.test(String(d.subreddit || '')) ? String(d.subreddit) : ''
  }),
  automod: (d) => ({
    enabled: flag(d.enabled),
    invites: flag(d.invites),
    links: flag(d.links),
    spam: flag(d.spam),
    caps: flag(d.caps),
    mentions: flag(d.mentions),
    maxMentions: num(d.maxMentions, 2, 20, 5),
    spamCount: num(d.spamCount, 3, 15, 5),
    spamSeconds: num(d.spamSeconds, 2, 30, 6),
    words: list(d.words, /[,;|]/).map((w) => str(w, 32).trim().toLowerCase()).filter(Boolean).slice(0, 100),
    action: pick(d.action, ['delete', 'timeout'], 'delete'),
    timeoutMin: num(d.timeoutMin, 1, 1440, 10)
  }),
  antinuke: (d) => ({
    enabled: flag(d.enabled),
    limit: num(d.limit, 1, 10, 3),
    windowSec: num(d.windowSec, 10, 120, 30),
    punishment: pick(d.punishment, ['removeroles', 'kick', 'ban'], 'removeroles'),
    protectChannels: flag(d.protectChannels),
    protectRoles: flag(d.protectRoles),
    protectBans: flag(d.protectBans),
    whitelist: list(d.whitelist, /[^0-9]+/).map(snow).filter(Boolean).slice(0, 25)
  }),
  antiraid: (d) => ({
    enabled: flag(d.enabled),
    joins: num(d.joins, 3, 50, 8),
    windowSec: num(d.windowSec, 5, 120, 10),
    action: pick(d.action, ['kick', 'timeout', 'ban'], 'kick'),
    minAccountAgeDays: num(d.minAccountAgeDays, 0, 30, 0)
  })
};

async function saveSection(guild, body) {
  const fn = SECTIONS[body && body.section];
  if (!fn) throw err(400, 'Unknown section');
  const s = await getSettings(guild.id);
  const clean = fn(body.data || {}, guild, s[body.section]);
  s[body.section] = { ...(s[body.section] || {}), ...clean };
  await saveSettings(guild.id, s);
  return { ok: true, data: s[body.section] };
}

async function removePanel(guild, channelId, messageId) {
  if (!channelId || !messageId) return;
  const ch = guild.channels.cache.get(channelId);
  if (ch && ch.isTextBased()) {
    const m = await ch.messages.fetch(messageId).catch(() => null);
    if (m) await m.delete().catch(() => {});
  }
}
async function sendPanel(ch, payload) {
  try { return await ch.send(payload); } catch { throw err(400, 'Bot cannot send messages in that channel. Check its permissions.'); }
}
const embed = (t, d) => new EmbedBuilder().setColor(0xf97316).setTitle(t).setDescription(d);

async function runAction(guild, b) {
  const type = b && b.type;
  const s = await getSettings(guild.id);
  const me = guild.members.me;

  if (type === 'verification.setup') {
    const chId = chanId(guild, b.channelId, TEXT);
    const role = guild.roles.cache.get(snow(b.roleId) || '');
    if (!chId) throw err(400, 'Select a text channel.');
    if (!role) throw err(400, 'Select a role.');
    if (role.managed || !me || role.position >= me.roles.highest.position) throw err(400, 'Bot role must be above that role in Server Settings > Roles.');
    await removePanel(guild, s.verification && s.verification.channelId, s.verification && s.verification.panelMessageId);
    const msg = await sendPanel(guild.channels.cache.get(chId), {
      embeds: [embed('Server Verification', 'Neeche **Verify** button dabao. Role milne ke baad aap channels dekh sakte ho.')],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify:btn').setLabel('Verify').setStyle(ButtonStyle.Success).setEmoji('✅'))]
    });
    s.verification = { channelId: chId, roleId: role.id, enabled: true, panelMessageId: msg.id };
    await saveSettings(guild.id, s);
    return { ok: true, settings: { verification: s.verification } };
  }
  if (type === 'verification.off') {
    await removePanel(guild, s.verification && s.verification.channelId, s.verification && s.verification.panelMessageId);
    s.verification = { channelId: null, roleId: null, enabled: false };
    await saveSettings(guild.id, s);
    return { ok: true, settings: { verification: s.verification } };
  }

  if (type === 'ticket.setup') {
    const chId = chanId(guild, b.channelId, TEXT);
    if (!chId) throw err(400, 'Select a text channel for the panel.');
    const catId = chanId(guild, b.categoryId, [ChannelType.GuildCategory]);
    const roleId = snow(b.supportRoleId) && guild.roles.cache.has(snow(b.supportRoleId)) ? snow(b.supportRoleId) : null;
    await removePanel(guild, s.ticket && s.ticket.panelChannelId, s.ticket && s.ticket.panelMessageId);
    const msg = await sendPanel(guild.channels.cache.get(chId), {
      embeds: [embed('Support Tickets', 'Help chahiye? Neeche **Open Ticket** dabao. Ek private channel banega.')],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket:open').setLabel('Open Ticket').setStyle(ButtonStyle.Primary).setEmoji('🎫'))]
    });
    s.ticket = { enabled: true, panelChannelId: chId, categoryId: catId, supportRoleId: roleId, panelMessageId: msg.id };
    await saveSettings(guild.id, s);
    return { ok: true, settings: { ticket: s.ticket } };
  }
  if (type === 'ticket.off') {
    await removePanel(guild, s.ticket && s.ticket.panelChannelId, s.ticket && s.ticket.panelMessageId);
    s.ticket = { enabled: false };
    await saveSettings(guild.id, s);
    return { ok: true, settings: { ticket: s.ticket } };
  }

  if (type === 'command.set') {
    const name = str(b.name, 32).toLowerCase();
    const reply = str(b.reply, 1800).trim();
    if (!/^[a-z0-9_-]{1,32}$/.test(name)) throw err(400, 'Name can only use a-z, 0-9, - and _.');
    if (!reply) throw err(400, 'Reply text is empty.');
    s.commands = s.commands || {};
    if (!s.commands[name] && Object.keys(s.commands).length >= 50) throw err(400, 'Max 50 commands.');
    s.commands[name] = reply;
    await saveSettings(guild.id, s);
    return { ok: true, settings: { commands: s.commands } };
  }
  if (type === 'command.delete') {
    const name = str(b.name, 32).toLowerCase();
    if (s.commands) delete s.commands[name];
    await saveSettings(guild.id, s);
    return { ok: true, settings: { commands: s.commands || {} } };
  }

  if (type === 'memes.send') {
    if (!s.memes || !s.memes.channelId) throw err(400, 'Save a meme channel first.');
    const ok = await postMeme(guild, s.memes).catch(() => false);
    if (!ok) throw err(502, 'Could not fetch a meme right now. Try again.');
    return { ok: true };
  }
  throw err(400, 'Unknown action');
}

async function overview(guild) {
  const s = await getSettings(guild.id);
  const me = guild.members.me;
  const channels = [...guild.channels.cache.values()]
    .filter((c) => [0, 2, 4, 5, 13].includes(c.type))
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((c) => ({ id: c.id, name: c.name, type: c.type }));
  const roles = [...guild.roles.cache.values()]
    .filter((r) => r.id !== guild.id)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, managed: r.managed, assignable: !r.managed && !!me && r.position < me.roles.highest.position }));
  const keys = ['verification', 'ticket', 'commands', 'logging', 'suggestions', 'yt', 'memes', 'automod', 'antinuke', 'antiraid'];
  const settings = {};
  for (const k of keys) settings[k] = s[k];
  return { guild: { id: guild.id, name: guild.name }, channels, roles, settings };
}

export async function handleApi(req, res, client) {
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  try {
    const m = (req.url || '').split('?')[0].match(/^[/]api[/]guild[/]([0-9]{17,20})(?:[/](settings|action))?$/);
    if (!m) throw err(404, 'Not found');
    if (!client || !client.isReady()) throw err(503, 'Bot is starting, try again in a minute.');
    const guild = await authGuild(req, m[1], client);
    if (req.method === 'GET' && !m[2]) return send(res, 200, await overview(guild));
    if (req.method === 'POST' && m[2]) {
      const body = await readBody(req);
      return send(res, 200, m[2] === 'settings' ? await saveSection(guild, body) : await runAction(guild, body));
    }
    throw err(405, 'Method not allowed');
  } catch (e) {
    if (!e.status) console.error('api', e.message);
    send(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
  }
}
