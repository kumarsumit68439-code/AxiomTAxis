const cache = new Map();

// GET /api/me/guilds - servers where the logged-in Discord user can manage the bot, with botIn flag.
export async function handleMe(req, res, client) {
  const send = (status, obj) => { res.statusCode = status; res.end(JSON.stringify(obj)); };
  try {
    const h = String(req.headers.authorization || '');
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    if (!token) return send(401, { error: 'Missing Discord token. Logout and login again.' });
    let c = cache.get(token);
    if (!c || Date.now() - c.t > 30000) {
      const r = await fetch('https://discord.com/api/v10/users/@me/guilds', { headers: { Authorization: 'Bearer ' + token } });
      if (r.status === 401) return send(401, { error: 'Discord login expired. Logout and login again.' });
      if (r.status === 429) return send(429, { error: 'Discord rate limit. Try again in a few seconds.' });
      if (!r.ok) return send(502, { error: 'Discord API error ' + r.status });
      c = { t: Date.now(), list: await r.json() };
      if (cache.size > 500) cache.clear();
      cache.set(token, c);
    }
    const guilds = c.list
      .map((g) => {
        let p = 0n;
        try { p = BigInt(g.permissions); } catch {}
        const manage = !!(g.owner || (p & 0x8n) || (p & 0x20n));
        return { id: g.id, name: g.name, icon: g.icon, manage, botIn: !!(client && client.guilds.cache.has(g.id)) };
      })
      .filter((g) => g.manage)
      .sort((a, b) => (b.botIn - a.botIn) || a.name.localeCompare(b.name));
    send(200, { guilds });
  } catch (e) {
    console.error('api/me', e.message);
    send(500, { error: 'Server error' });
  }
}
