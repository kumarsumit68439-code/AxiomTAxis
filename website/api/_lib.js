const crypto = require('crypto');

const secret = () => process.env.GATE_SECRET || '';

function sign(payload) {
  const s = secret();
  if (!s) throw new Error('GATE_SECRET missing');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', s).update(p).digest('base64url');
  return p + '.' + sig;
}

function verify(token, kind) {
  try {
    const s = secret();
    if (!s || !token) return null;
    const i = token.indexOf('.');
    if (i < 1) return null;
    const p = token.slice(0, i);
    const a = Buffer.from(token.slice(i + 1));
    const b = Buffer.from(crypto.createHmac('sha256', s).update(p).digest('base64url'));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const d = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (d.k !== kind || d.exp < Date.now() / 1000) return null;
    return d;
  } catch { return null; }
}

function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((x) => {
    const i = x.indexOf('=');
    if (i > 0) out[x.slice(0, i).trim()] = x.slice(i + 1).trim();
  });
  return out;
}

// list: [[name, value, maxAgeSeconds], ...]
function setCookies(res, list) {
  res.setHeader('Set-Cookie', list.map(([n, v, age]) => n + '=' + v + '; Max-Age=' + age + '; Path=/; HttpOnly; Secure; SameSite=Lax'));
}

function ip(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

module.exports = { sign, verify, cookies, setCookies, ip, readJson, json };
