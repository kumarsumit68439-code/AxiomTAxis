import { Events, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getSettings } from './util.js';

export const commands = [];

const DP = { invites: 'timeout', links: 'timeout', gif: 'delete', scam: 'timeout', mentions: 'timeout', spam: 'timeout', words: 'timeout', zalgo: 'delete', caps: 'delete', profanity: 'delete' };
const DM = { invites: 10, links: 15, gif: 5, scam: 60, mentions: 30, spam: 5, words: 15, zalgo: 10, caps: 5, profanity: 5 };
const LABEL = { invites: 'Discord invites', links: 'Website links', gif: 'GIFs', scam: 'Scam / phishing', mentions: 'Mass mentions', spam: 'Spam', words: 'Banned words', zalgo: 'Glitch text', caps: 'Excessive caps', profanity: 'Profanity' };
const DEFAULT_ALLOWED = ['youtube.com', 'spotify.com', 'tenor.com', 'giphy.com'];
const WS = /\s+/;

const SCAM = ['free nitro', 'nitro for free', 'nitro gift', 'discord-gift', 'discordgift', 'discord-nitro', 'discordnitro', 'dlscord', 'discorcl', 'discrod.', 'steamcommunlty', 'steamcommunnity', 'steancommunity', 'steamgift', 'grabify', 'iplogger', '2no.co', 'yip.su'];
const DICT = {
  severe: ['fuck', 'fucking', 'fucker', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'motherfucker', 'madarchod', 'bhenchod', 'behenchod', 'chutiya', 'gandu', 'randi', 'harami'],
  sexual: ['porn', 'pornhub', 'xxx', 'nude', 'nudes', 'blowjob', 'handjob', 'cumshot', 'onlyfans leak'],
  hate: ['kys', 'kill yourself', 'go die']
};

const spam = new Map();
const viol = new Map();

const padded = (low) => ' ' + low.replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' ';

function wordHit(low, pad, pattern) {
  const p = String(pattern).toLowerCase();
  const a = p.startsWith('*'), b = p.endsWith('*');
  const core = p.split('*').join('').trim();
  if (!core) return false;
  if (a && b) return low.includes(core);
  if (a) return pad.split(' ').some((t) => t.endsWith(core));
  if (b) return pad.split(' ').some((t) => t.startsWith(core));
  return pad.includes(' ' + core + ' ');
}

function hostOf(token) {
  let t = token;
  while (t.length && '<(["\''.includes(t[0])) t = t.slice(1);
  if (t.startsWith('www.')) t = 'http://' + t;
  if (!t.includes('://')) return null;
  try {
    const h = new URL(t).hostname.toLowerCase();
    return h.startsWith('www.') ? h.slice(4) : h;
  } catch { return null; }
}

function inviteCodes(low) {
  const out = [];
  for (const key of ['discord.gg/', 'discord.com/invite/', 'discordapp.com/invite/']) {
    let i = 0;
    while ((i = low.indexOf(key, i)) >= 0) {
      i += key.length;
      let j = i;
      while (j < low.length && /[a-z0-9-]/.test(low[j])) j++;
      out.push(low.slice(i, j));
    }
  }
  return out;
}

function glitchy(text) {
  let marks = 0, zw = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if ((c >= 0x300 && c <= 0x36f) || (c >= 0x1ab0 && c <= 0x1aff) || (c >= 0x20d0 && c <= 0x20ff) || (c >= 0xfe20 && c <= 0xfe2f)) marks++;
    else if (c === 0x200b || c === 0x200c || c === 0x200d || c === 0x2060 || c === 0xfeff) zw++;
  }
  return marks >= 6 || zw >= 3;
}

function detect(msg, c) {
  const text = msg.content || '';
  const low = text.toLowerCase();
  const pad = padded(low);
  const on = (k) => c[k] && c[k].on;

  if (on('scam') && SCAM.some((t) => low.includes(t))) return 'scam';
  if (on('invites')) {
    const allow = (c.invites.whitelist || []).map((x) => String(x).split('/').pop());
    if (inviteCodes(low).some((code) => !allow.includes(code))) return 'invites';
  }
  if (on('links')) {
    const allow = c.links.whitelist || DEFAULT_ALLOWED;
    for (const tok of low.split(WS)) {
      const h = hostOf(tok);
      if (!h || h === 'discord.gg' || h === 'discord.com' || h === 'discordapp.com') continue;
      if (!allow.some((d) => h === d || h.endsWith('.' + d))) return 'links';
    }
  }
  if (on('gif') && !(c.gif.channels || []).includes(msg.channelId)) {
    const g = c.gif;
    const att = [...msg.attachments.values()].some((a) => String(a.contentType || '').includes('gif') || String(a.name || '').toLowerCase().endsWith('.gif'));
    if (g.tenor !== false && (low.includes('tenor.com') || low.includes('giphy.com'))) return 'gif';
    if (g.imgur !== false && (low.includes('imgur.com') || low.includes('.gif'))) return 'gif';
    if (g.direct !== false && att) return 'gif';
  }
  if (on('mentions')) {
    const n = msg.mentions.users.size + msg.mentions.roles.size;
    if (msg.mentions.everyone || n > (c.mentions.max || 5)) return 'mentions';
  }
  if (on('spam')) {
    const key = msg.guildId + ':' + msg.author.id;
    const now = Date.now();
    const arr = (spam.get(key) || []).filter((t) => now - t < 5000);
    arr.push(now);
    spam.set(key, arr);
    if (arr.length > (c.spam.max || 5)) { spam.delete(key); return 'spam'; }
  }
  if (on('words') && (c.words.list || []).some((p) => wordHit(low, pad, p))) return 'words';
  if (on('zalgo') && glitchy(text)) return 'zalgo';
  if (on('caps') && text.length >= 15) {
    const letters = Array.from(text).filter((ch) => ch.toLowerCase() !== ch.toUpperCase());
    const upper = letters.filter((ch) => ch === ch.toUpperCase());
    if (letters.length >= 10 && (upper.length / letters.length) * 100 >= (c.caps.threshold || 70)) return 'caps';
  }
  if (on('profanity')) {
    for (const k of ['severe', 'sexual', 'hate']) {
      if (c.profanity[k] !== false && DICT[k].some((w) => pad.includes(' ' + w + ' '))) return 'profanity';
    }
  }
  return null;
}

const fmt = (ms) => { const m = Math.round(ms / 60000); return m >= 1440 ? Math.round(m / 1440) + 'd' : m >= 60 ? Math.round(m / 60) + 'h' : m + 'm'; };

export function attach(client) {
  async function act(msg, c, k) {
    const r = c[k];
    let action = (r.punish || DP[k]) === 'timeout' ? 'timeout' : 'delete';
    let ms = (r.minutes || DM[k]) * 60000;
    if (c.escalation && c.escalation.on) {
      const key = msg.guildId + ':' + msg.author.id;
      const now = Date.now();
      const win = (c.escalation.expireHours || 24) * 3600000;
      const arr = (viol.get(key) || []).filter((t) => now - t < win);
      arr.push(now);
      viol.set(key, arr);
      const st = c.escalation['s' + Math.min(arr.length, 4)] || {};
      action = st.action || 'warn';
      const mult = st.unit === 'day' ? 1440 : st.unit === 'hour' ? 60 : 1;
      ms = (st.value || 1) * mult * 60000;
    }
    ms = Math.min(ms, 28 * 24 * 3600000);
    if (msg.deletable) await msg.delete().catch(() => {});
    let result = 'Message deleted';
    if (action === 'timeout' && msg.member.moderatable) {
      const ok = await msg.member.timeout(ms, 'AutoMod: ' + LABEL[k]).then(() => true).catch(() => false);
      if (ok) result += ' + muted ' + fmt(ms);
    } else if (action === 'kick' && msg.member.kickable) {
      const ok = await msg.member.kick('AutoMod: ' + LABEL[k]).then(() => true).catch(() => false);
      if (ok) result += ' + kicked';
    }
    const warn = await msg.channel.send({ content: msg.author + ', ' + LABEL[k] + ' are not allowed here.', allowedMentions: { users: [msg.author.id] } }).catch(() => null);
    if (warn) setTimeout(() => warn.delete().catch(() => {}), 5000);
    const ch = c.logChannelId && msg.guild.channels.cache.get(c.logChannelId);
    if (ch && ch.isTextBased()) {
      const e = new EmbedBuilder().setColor(0xef4444).setTitle('AutoMod: ' + LABEL[k])
        .setDescription(msg.author.tag + ' (' + msg.author.id + ') in <#' + msg.channelId + '>')
        .addFields({ name: 'Action', value: result, inline: true }).setTimestamp();
      await ch.send({ embeds: [e] }).catch(() => {});
    }
  }

  client.on(Events.MessageCreate, async (msg) => {
    if (!msg.guild || msg.author.bot || !msg.member) return;
    try {
      const s = await getSettings(msg.guildId);
      const c = s.automod;
      if (!c || !c.enabled) return;
      const perms = msg.member.permissions;
      if (perms.has(PermissionFlagsBits.Administrator) || perms.has(PermissionFlagsBits.ManageMessages)) return;
      if ((c.ignoredChannels || []).includes(msg.channelId) || (msg.channel.parentId && (c.ignoredChannels || []).includes(msg.channel.parentId))) return;
      if ((c.ignoredRoles || []).length && msg.member.roles.cache.some((r) => c.ignoredRoles.includes(r.id))) return;
      const k = detect(msg, c);
      if (k) await act(msg, c, k);
    } catch (e) { console.error('automod', e.message); }
  });
}
