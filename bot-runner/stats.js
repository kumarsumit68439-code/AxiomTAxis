import http from 'node:http';
import { handleApi } from './api.js';
import { handleMe } from './me.js';

// Public stats (GET /stats) + authenticated dashboard API (/api/...).
export function startStats(get) {
  const port = Number(process.env.PORT) || 3000;
  http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    const { client, mode } = get();
    if (req.url && req.url.startsWith('/api/me')) return handleMe(req, res, client);
    if (req.url && req.url.startsWith('/api/')) return handleApi(req, res, client);
    if (req.url && req.url.startsWith('/stats')) {
      const ready = !!(client && client.isReady());
      const body = { online: ready, mode, uptime: Math.floor(process.uptime()) };
      if (ready) {
        body.tag = client.user.tag;
        body.avatar = client.user.displayAvatarURL({ size: 256, extension: 'png' });
        body.servers = client.guilds.cache.size;
        body.users = client.guilds.cache.reduce((n, g) => n + (g.memberCount || 0), 0);
        body.ping = Math.round(client.ws.ping);
      }
      return res.end(JSON.stringify(body));
    }
    res.end(JSON.stringify({ ok: true }));
  }).listen(port, () => console.log('Stats + dashboard API on port', port));
}
