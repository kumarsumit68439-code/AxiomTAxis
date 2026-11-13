const fs = require('fs');
const path = require('path');
const cfg = { CLIENT_ID: process.env.DISCORD_CLIENT_ID || '' };
fs.writeFileSync(path.join(__dirname, 'config.js'), 'window.AXIOM_CONFIG=' + JSON.stringify(cfg) + ';\n');
console.log('config.js written');
