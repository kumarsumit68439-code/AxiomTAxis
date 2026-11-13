const fs = require('fs');
const path = require('path');
const cfg = {
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || ''
};
fs.writeFileSync(path.join(__dirname, 'config.js'), 'window.AXIOM_CONFIG=' + JSON.stringify(cfg) + ';\n');
console.log('config.js written');
