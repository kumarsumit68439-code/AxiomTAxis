import net from 'node:net';
import { ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Routes } from 'discord.js';
import { getSettings, saveSettings } from './bots/util.js';
import { resolveChannel, fetchFeed } from './bots/yt.js';

// Dashboard management API. Auth: Authorization: Bearer <Discord OAuth access token>.
// The token owner must have Manage Server / Administrator / be owner in that guild.

const ID = ['id'];
const BOOL = ['bool'];
const S = (n) => ['str', n];
const N = (a, b) => ['num', a, b];
const E = (...v) => ['enum', v];
const PU = E('delete', 'timeout');
const rule = (extra) => ({ on: BOOL, punish: PU, minutes: N(1, 40320), ...extra });
const STEP = { action: E('warn', 'timeout', 'kick'), value: N(1, 999), unit: E('min', 'hour', 'day') };

const AUTOMOD = {
  enabled: BOOL, logChannelId: ID, ignoredRoles: ['ids', 25], ignoredChannels: ['ids', 50],
  invites: rule({ whitelist: ['words', 50] }),
  links: rule({ whitelist: ['words', 100] }),
  gif: rule({ tenor: BOOL, imgur: BOOL, direct: BOOL, channels: ['ids', 25] }),
  scam: rule({}),
  mentions: rule({ max: N(2, 30) }),
  spam: rule({ max: N(2, 20) }),
  words: rule({ list: ['words', 200] }),
  zalgo: rule({}),
  caps: rule({ threshold: N(30, 100) }),
  profanity: rule({ severe: BOOL, sexual: BOOL, hate: BOOL }),
  escalation: { on: BOOL, expireHours: N(1, 720), s1: STEP, s2: STEP, s3: STEP, s4: STEP }
};

const SCHEMA = {
  ai: { channelId: ID, provider: S(40), model: S(100), system: S(1500) },
  welcome: { enabled: BOOL, channelId: ID, message: S(500) },
  leave: { enabled: BOOL, channelId: ID, message: S(500) },
  counting: { channelId: ID },
  levels: { enabled: BOOL, channelId: ID },
  logging: { channelId: ID },
  suggestions: { enabled: BOOL, channelId: ID },
  memes: { enabled: BOOL, channelId: ID, intervalMin: N(5, 1440) },
  yt: { enabled: BOOL, channelId: ID, message: S(300) },
  automod: AUTOMOD,
  antinuke: { enabled: BOOL, limit: N(1, 10), seconds: N(5, 60), punishment: E('ban', 'kick', 'strip'), whitelist: ['ids', 25], logChannelId: ID },
  antiraid: { enabled: BOOL, joinLimit: N(3, 50), seconds: N(5, 120), minAccountDays: N(0, 365), action: E('kick', 'timeout', 'ban'), logChannelId: ID }
};

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra || {}; }
}

const isId = (v) => /^[0-9]{15,25}$/.test(String(v));
const isLeaf = (d) => Array.isArray(d);

function clean(def, v) {
  const t = def[0];
  if (t === 'bool') return v === true || v === 'true';
  if (v === null || v === undefined || v === '') {
    if (t === 'id') return null;
    if (t === 'str') return '';
    if (t === 'ids' || t === 'words') return [];
    return undefined;
  }
  if (t === 'id') return isId(v) ? String(v) : null;
  if (t === 'str') return String(v).slice(0, def[1]);
  if (t === 'num') { const n = Number(v); return Number.isFinite(n) ? Math.min(def[2], Math.max(def[1], Math.round(n))) : undefined; }
  if (t === 'enum') return def[1].includes(v) ? v : undefined;
  if (t === 'ids') return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(isId).slice(0, def[1]) : [];
  if (t === 'words') return Array.isArray(v) ? v.map((x) => String(x).trim().toLowerCase().slice(0, 80)).filter(Boolean).slice(0, def[1]) : [];
  return undefined;
}

function applyTree(target, def, patch) {
  for (const [k, d] of Object.entries(def)) {
    if (!(k in patch)) continue;
    if (isLeaf(d)) {
      const v = clean(d, patch[k]);
      if (v !== undefined) target[k] = v;
    } else if (patch[k] && typeof patch[k] === 'object') {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      applyTree(target[k], d, patch[k]);
    }
  }
}

function applyPatch(s, patch) {
  for (const [sec, fields] of Object.entries(patch || {})) {
    const def = SCHEMA[sec];
    if (!def || !fields || typeof fields !== 'object') continue;
    s[sec] = s[sec] || {};
    if (sec === 'counting' && 'channelId' in fields) {
      const v = clean(ID, fields.channelId);
      if (s.counting.channelId !== v) s.counting.count = 0;
    }
    applyTree(s[sec], def, fields);
  }
}

function view(s) {
  const lv = s.levels || {};
  const ct = s.counting || {};
  return {
    ai: s.ai || {}, welcome: s.welcome || {}, leave: s.leave || {},
    counting: { channelId: ct.channelId || null, count: ct.count || 0 },
    levels: { enabled: !!lv.enabled, channelId: lv.channelId || null, members: Object.keys(lv.users || {}).length },
    logging: s.logging || {}, suggestions: s.suggestions || {}, memes: s.memes || {}, yt: s.yt || {},
    automod: s.automod || {}, antinuke: s.antinuke || {}, antiraid: s.antiraid || {},
    ticket: s.ticket || {}, verification: s.verification || {}, commands: s.commands || {}, profile: s.profile || {}
  };
}

function snapshot(guild, s) {
  const T = ChannelType;
  const channels = guild.channels.cache
    .filter((c) => [T.GuildText, T.GuildAnnouncement, T.GuildCategory, T.GuildVoice, T.GuildStageVoice, T.GuildForum].includes(c.type))
    .map((c) => ({ id: c.id, name: c.name, type: c.type }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const roles = guild.roles.cache
    .filter((r) => r.id !== guild.id && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name }));
  return { guild: { id: guild.id, name: guild.name }, settings: view(s), channels, roles };
}

const guildCache = new Map();
async function userGuilds(token) {
  const c = guildCache.get(token);
  if (c && Date.now() - c.t < 60000) return c.list;
  const r = await fetch('https://discord.com/api/v10/users/@me/guilds', { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 401) throw new HttpError(401, 'Discord login expired. Logout and login again.');
  if (r.status === 429) throw new HttpError(429, 'Discord rate limit. Try again in a few seconds.');
  if (!r.ok) throw new HttpError(502, 'Discord API error ' + r.status);
  const list = await r.json();
  if (guildCache.size > 500) guildCache.clear();
  guildCache.set(token, { t: Date.now(), list });
  return list;
}

async function authorize(token, gid, client) {
  if (!token) throw new HttpError(401, 'Missing Discord token. Logout and login again.');
  const list = await userGuilds(token);
  const g = list.find((x) => x.id === gid);
  if (!g) throw new HttpError(403, 'You are not in this server.');
  let p = 0n;
  try { p = BigInt(g.permissions); } catch {}
  if (!(g.owner || (p & 0x8n) || (p & 0x20n))) throw new HttpError(403, 'Manage Server permission is required.');
  const guild = client && client.guilds.cache.get(gid);
  if (!guild) throw new HttpError(404, 'Bot is not in this server yet.', { botMissing: true });
  return guild;
}

function textCh(guild, id) {
  const ch = guild.channels.cache.get(String(id || ''));
  if (!ch || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(ch.type)) throw new HttpError(400, 'Select a valid text channel.');
  return ch;
}

async function safeSend(ch, payload) {
  try { return await ch.send(payload); } catch {
    throw new HttpError(400, 'Bot cannot send in #' + ch.name + '. Give it View Channel, Send Messages and Embed Links there.');
  }
}

const DATA_IMG = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/;

async function imgData(url) {
  // Direct upload from the dashboard arrives as a data: URL.
  if (url.startsWith('data:')) {
    const m = DATA_IMG.exec(url);
    if (!m) throw new HttpError(400, 'Upload must be a PNG, JPG, GIF or WEBP image.');
    if (Buffer.byteLength(m[2], 'base64') > 8 * 1024 * 1024) throw new HttpError(400, 'Image is larger than 8MB.');
    return url;
  }
  let u;
  try { u = new URL(url); } catch { throw new HttpError(400, 'Invalid image URL.'); }
  const host = u.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(u.protocol) || net.isIP(host) || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new HttpError(400, 'Use a public image URL (https://...).');
  let r;
  try { r = await fetch(u.href, { redirect: 'follow' }); } catch { throw new HttpError(400, 'Could not download the image.'); }
  if (!r.ok) throw new HttpError(400, 'Image download failed (' + r.status + ').');
  const type = String(r.headers.get('content-type') || '').split(';')[0].trim();
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(type)) throw new HttpError(400, 'URL must be a direct PNG, JPG, GIF or WEBP image.');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 8 * 1024 * 1024) throw new HttpError(400, 'Image is larger than 8MB.');
  return 'data:' + type + ';base64,' + buf.toString('base64');
}

const ACTIONS = {
  async 'ticket.setup'(guild, b, s) {
    const ch = textCh(guild, b.channelId);
    let cat = null;
    if (b.categoryId) {
      cat = guild.channels.cache.get(String(b.categoryId));
      if (!cat || cat.type !== ChannelType.GuildCategory) throw new HttpError(400, 'Invalid category.');
    }
    if (b.supportRoleId && !guild.roles.cache.has(String(b.supportRoleId))) throw new HttpError(400, 'Invalid support role.');
    const embed = new EmbedBuilder().setColor(0xf97316)
      .setTitle(String(b.title || 'Support Tickets').slice(0, 100))
      .setDescription(String(b.description || 'Help chahiye? Neeche **Open Ticket** button dabao.\nEk private channel banega jahan aap support se baat kar sakte ho.').slice(0, 1500));
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:open').setLabel('Open Ticket').setStyle(ButtonStyle.Primary).setEmoji('🎫')
    );
    await safeSend(ch, { embeds: [embed], components: [row] });
    s.ticket = { enabled: true, panelChannelId: ch.id, categoryId: cat ? cat.id : null, supportRoleId: b.supportRoleId || null };
    return 'Ticket panel sent to #' + ch.name;
  },
  async 'ticket.off'(guild, b, s) {
    s.ticket = { enabled: false };
    return 'Ticket system disabled.';
  },
  async 'verification.setup'(guild, b, s) {
    const ch = textCh(guild, b.channelId);
    const role = guild.roles.cache.get(String(b.roleId || ''));
    if (!role || role.id === guild.id || role.managed) throw new HttpError(400, 'Select a valid role.');
    const me = guild.members.me;
    if (me && role.position >= me.roles.highest.position) throw new HttpError(400, 'Move the bot role above "' + role.name + '" in Server Settings > Roles.');
    const embed = new EmbedBuilder().setColor(0xf97316)
      .setTitle(String(b.title || 'Server Verification').slice(0, 100))
      .setDescription(String(b.description || 'Is server me join karne ke liye neeche **Verify** button dabao.\nRole milne ke baad aap channels dekh sakte ho.').slice(0, 1500));
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('verify:btn').setLabel('Verify').setStyle(ButtonStyle.Success).setEmoji('✅')
    );
    await safeSend(ch, { embeds: [embed], components: [row] });
    s.verification = { channelId: ch.id, roleId: role.id };
    return 'Verification panel sent to #' + ch.name;
  },
  async 'verification.off'(guild, b, s) {
    s.verification = { channelId: null, roleId: null };
    return 'Verification disabled.';
  },
  async 'command.add'(guild, b, s) {
    const name = String(b.name || '').toLowerCase().trim();
    const reply = String(b.reply || '').trim().slice(0, 1800);
    if (!/^[a-z0-9_-]{1,32}$/.test(name)) throw new HttpError(400, 'Name: a-z, 0-9, - and _ only (max 32).');
    if (!reply) throw new HttpError(400, 'Reply text is required.');
    s.commands = s.commands || {};
    if (!s.commands[name] && Object.keys(s.commands).length >= 50) throw new HttpError(400, 'Max 50 commands.');
    s.commands[name] = reply;
    return 'Command saved. Members use /c ' + name;
  },
  async 'command.delete'(guild, b, s) {
    const name = String(b.name || '').toLowerCase();
    if (s.commands) delete s.commands[name];
    return 'Command deleted.';
  },
  async 'counting.reset'(guild, b, s) {
    s.counting = s.counting || {};
    s.counting.count = 0;
    return 'Count reset to 0.';
  },
  async 'automod.reset'(guild, b, s) {
    s.automod = {};
    return 'AutoMod settings reset.';
  },
  async 'yt.add'(guild, b, s) {
    let id, feed;
    try { id = await resolveChannel(b.input); feed = await fetchFeed(id); } catch (e) { throw new HttpError(400, e.message); }
    s.yt = s.yt || {};
    s.yt.items = s.yt.items || [];
    if (s.yt.items.some((x) => x.id === id)) throw new HttpError(400, 'Already added.');
    if (s.yt.items.length >= 5) throw new HttpError(400, 'Max 5 YouTube channels.');
    s.yt.items.push({ id, name: feed.title, lastId: feed.videos[0] ? feed.videos[0].id : null });
    if (s.yt.enabled === undefined) s.yt.enabled = true;
    return 'Added ' + feed.title + '. New uploads will be posted.';
  },
  async 'yt.remove'(guild, b, s) {
    if (s.yt && s.yt.items) s.yt.items = s.yt.items.filter((x) => x.id !== b.id);
    return 'Removed.';
  },
  async 'profile.save'(guild, b, s) {
    const prev = s.profile || {};
    const nick = String(b.nick || '').trim().slice(0, 32);
    const bio = String(b.bio || '').trim().slice(0, 190);
    const av = String(b.avatarUrl || '').trim();
    const bn = String(b.bannerUrl || '').trim();
    const body = { nick: nick || null, bio: bio || null };
    if (av && av !== prev.avatarUrl) body.avatar = await imgData(av);
    if (bn && bn !== prev.bannerUrl) body.banner = await imgData(bn);
    try {
      await guild.client.rest.patch(Routes.guildMember(guild.id, '@me'), { body });
    } catch (e) {
      throw new HttpError(400, 'Discord rejected the profile update: ' + ((e.rawError && e.rawError.message) || e.message));
    }
    // Uploaded images (data: URLs) are not stored in settings, only real URLs are.
    s.profile = { nick, bio, avatarUrl: av.startsWith('data:') ? '' : av, bannerUrl: bn.startsWith('data:') ? '' : bn };
    return 'Bot profile updated for this server.';
  },
  async 'profile.reset'(guild, b, s) {
    try {
      await guild.client.rest.patch(Routes.guildMember(guild.id, '@me'), { body: { nick: null, avatar: null, banner: null, bio: null } });
    } catch (e) {
      throw new HttpError(400, 'Discord rejected the reset: ' + ((e.rawError && e.rawError.message) || e.message));
    }
    s.profile = {};
    return 'Bot profile reset to default.';
  }
};

function send(res, status, obj) {
  res.statusCode = status;
  res.end(JSON.stringify(obj));
}

function readBody(req, max = 200000) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > max) { reject(new HttpError(413, 'Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(new HttpError(400, 'Invalid JSON')); } });
    req.on('error', reject);
  });
}

export async function handleApi(req, res, client) {
  try {
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'api' || parts[1] !== 'guilds' || !isId(parts[2])) throw new HttpError(404, 'Not found');
    const h = String(req.headers.authorization || '');
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    const guild = await authorize(token, parts[2], client);
    const s = await getSettings(guild.id);
    const sub = parts[3] || '';
    if (req.method === 'GET' && !sub) return send(res, 200, snapshot(guild, s));
    if (req.method === 'PUT' && sub === 'settings') {
      const b = await readBody(req);
      applyPatch(s, b.patch);
      await saveSettings(guild.id, s);
      return send(res, 200, { ok: true, settings: view(s) });
    }
    if (req.method === 'POST' && sub === 'actions') {
      // Bigger limit: profile uploads (avatar + banner) arrive as base64 data URLs. Auth already passed above.
      const b = await readBody(req, 24 * 1024 * 1024);
      const fn = ACTIONS[b.action];
      if (!fn) throw new HttpError(400, 'Unknown action');
      const message = await fn(guild, b, s);
      await saveSettings(guild.id, s);
      return send(res, 200, { ok: true, message });
    }
    throw new HttpError(404, 'Not found');
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error('api', e.message);
    send(res, status, { error: status === 500 ? 'Server error' : e.message, ...(e.extra || {}) });
  }
}
