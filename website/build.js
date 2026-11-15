const fs = require('fs');
const path = require('path');

const cfg = {
  CLIENT_ID: process.env.DISCORD_CLIENT_ID || '',
  STATS_URL: (process.env.STATS_URL || '').replace(/\/+$/, ''),
  SUPPORT_URL: process.env.SUPPORT_URL || '',
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
  TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY || '',
  RECAPTCHA_SITE_KEY: process.env.RECAPTCHA_SITE_KEY || ''
};
fs.writeFileSync(path.join(__dirname, 'config.js'), 'window.AXIOM_CONFIG=' + JSON.stringify(cfg) + ';\n');

// Only the site files go into public/. Server code (api/, middleware.js, build.js) is never published as static files.
const out = path.join(__dirname, 'public');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const SKIP = new Set(['public', 'api', 'node_modules', 'build.js', 'middleware.js', 'vercel.json', 'package.json']);
for (const f of fs.readdirSync(__dirname)) {
  if (SKIP.has(f) || f.startsWith('.')) continue;
  const p = path.join(__dirname, f);
  if (fs.statSync(p).isFile()) fs.copyFileSync(p, path.join(out, f));
}
console.log('built public/ with', fs.readdirSync(out).length, 'files');
