// Copy → config.js (or inject at build time from Vercel env)
// NEVER put bot token / service_role key here.

window.AXIOM_CONFIG = {
  SUPABASE_URL: 'https://YOUR_PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',

  CLIENT_ID: 'YOUR_DISCORD_CLIENT_ID',
  STATS_URL: 'https://your-bot-api.example.com',

  // Cloudflare Turnstile (https://dash.cloudflare.com → Turnstile)
  TURNSTILE_SITE_KEY: '0x4AAAAAAA...',

  // Google reCAPTCHA v2 Checkbox (https://www.google.com/recaptcha/admin)
  // Create "reCAPTCHA v2" → "I'm not a robot" Checkbox
  RECAPTCHA_SITE_KEY: '6Lc...'
};
