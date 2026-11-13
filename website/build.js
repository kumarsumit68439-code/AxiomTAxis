const fs = require('fs');
const path = require('path');
const cfg = {
  CLIENT_ID: process.env.DISCORD_CLIENT_ID || '',
  STATS_URL: (process.env.STATS_URL || '').replace(/\/+$/, ''),
  SUPPORT_URL: process.env.SUPPORT_URL || '',
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || ''
};
fs.writeFileSync(path.join(__dirname, 'config.js'), 'window.AXIOM_CONFIG=' + JSON.stringify(cfg) + ';\n');
console.log('config.js written');
