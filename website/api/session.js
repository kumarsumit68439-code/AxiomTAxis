const { sign, verify, cookies, setCookies, readJson, json } = require('./_lib');

// Step 2: after Discord login (Supabase session), exchange the access token for the signed site cookie.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const { SUPABASE_URL, SUPABASE_ANON_KEY, GATE_SECRET } = process.env;
  if (!GATE_SECRET || !SUPABASE_URL || !SUPABASE_ANON_KEY) return json(res, 500, { error: 'Server not configured.' });
  const gate = verify(cookies(req).axiom_gate, 'gate');
  if (!gate) return json(res, 403, { error: 'Captcha check expired. Verify the captchas again.' });
  const b = await readJson(req);
  const tok = String(b.access_token || '');
  if (!tok) return json(res, 400, { error: 'Missing token.' });
  let user;
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + tok } });
    if (!r.ok) return json(res, 401, { error: 'Login not valid. Try again.' });
    user = await r.json();
  } catch { return json(res, 502, { error: 'Auth service unreachable.' }); }
  if (!user || !user.id || !(user.app_metadata && user.app_metadata.provider === 'discord')) return json(res, 403, { error: 'Discord login required.' });
  const days30 = 30 * 24 * 3600;
  setCookies(res, [
    ['axiom_auth', sign({ k: 'auth', uid: user.id, exp: Math.floor(Date.now() / 1000) + days30 }), days30],
    ['axiom_gate', '', 0]
  ]);
  return json(res, 200, { ok: true });
};
