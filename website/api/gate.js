const { sign, setCookies, ip, readJson, json } = require('./_lib');

const form = (o) => new URLSearchParams(o);

// Step 1: verify BOTH Cloudflare Turnstile and Google reCAPTCHA, then allow the Discord login step.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const { TURNSTILE_SECRET, RECAPTCHA_SECRET, GATE_SECRET } = process.env;
  if (!GATE_SECRET || !TURNSTILE_SECRET || !RECAPTCHA_SECRET) {
    return json(res, 500, { error: 'Server not configured (GATE_SECRET, TURNSTILE_SECRET, RECAPTCHA_SECRET).' });
  }
  const b = await readJson(req);
  if (!b.turnstile || !b.recaptcha) return json(res, 400, { error: 'Complete both captchas first.' });
  const remote = ip(req);
  let t = {}, r = {};
  try {
    [t, r] = await Promise.all([
      fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form({ secret: TURNSTILE_SECRET, response: String(b.turnstile), remoteip: remote }) }).then((x) => x.json()),
      fetch('https://www.google.com/recaptcha/api/siteverify', { method: 'POST', body: form({ secret: RECAPTCHA_SECRET, response: String(b.recaptcha), remoteip: remote }) }).then((x) => x.json())
    ]);
  } catch { return json(res, 502, { error: 'Captcha service unreachable. Try again.' }); }
  if (!t.success || !r.success) return json(res, 403, { error: 'Captcha verification failed. Try again.' });
  setCookies(res, [['axiom_gate', sign({ k: 'gate', exp: Math.floor(Date.now() / 1000) + 600 }), 600]]);
  return json(res, 200, { ok: true });
};
