const enc = new TextEncoder();
const OPEN = ['/login.html', '/config.js', '/favicon.ico', '/robots.txt'];

export const config = { matcher: ['/((?!api/).*)'] };

function b64uBytes(s) {
  let t = s.split('-').join('+').split('_').join('/');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function validAuth(token, secret) {
  try {
    const i = token.indexOf('.');
    if (i < 1) return false;
    const p = token.slice(0, i);
    const sig = token.slice(i + 1);
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('HMAC', key, b64uBytes(sig), enc.encode(p));
    if (!ok) return false;
    const d = JSON.parse(new TextDecoder().decode(b64uBytes(p)));
    return d.k === 'auth' && d.exp > Date.now() / 1000;
  } catch { return false; }
}

const pass = () => new Response(null, { headers: { 'x-middleware-next': '1' } });

// Everything except the login page is private: no valid signed login cookie = redirect to /login.html.
export default async function middleware(request) {
  const path = new URL(request.url).pathname;
  if (OPEN.includes(path)) return pass();
  const secret = process.env.GATE_SECRET;
  const c = (request.headers.get('cookie') || '').split(';').map((x) => x.trim()).find((x) => x.startsWith('axiom_auth='));
  if (secret && c && (await validAuth(c.slice(11), secret))) return pass();
  return new Response(null, { status: 302, headers: { Location: '/login.html', 'Cache-Control': 'no-store' } });
}
