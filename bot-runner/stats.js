import http from 'node:http';

// Tiny public stats API used by the website (GET /stats). No secrets are exposed.
export function startStats(get) {
  const port = Number(process.env.PORT) || 3000;
  http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    const { client, mode } = get();
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
  }).listen(port, () => console.log('Stats API on port', port));
}
