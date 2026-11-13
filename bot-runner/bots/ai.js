import { Events } from 'discord.js';

const URL = process.env.AXIOM_API_URL || 'https://axiom-ai-sand.vercel.app/api/v1/chat/completions';

async function askAI(cfg, messages) {
  const key = process.env.AXIOM_API_KEY;
  if (!key) throw new Error('AXIOM_API_KEY not set on Railway');
  const body = { model: cfg.model, messages, stream: false, temperature: 0.7, max_tokens: 1024 };
  if (cfg.provider) body.provider = cfg.provider;
  const res = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && (data.error.message || data.error)) || 'API ' + res.status);
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '(empty reply)';
}

function chunk(text, n = 1900) {
  const out = [];
  for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n));
  return out;
}

export function attachAI(client, cfg) {
  const history = new Map(); // channelId -> [{role, content}]
  const queue = new Map();   // channelId -> promise chain

  client.on(Events.MessageCreate, (m) => {
    if (m.author.bot || !m.guild) return;
    const ok = cfg.channelId ? m.channelId === cfg.channelId : m.channel.name === 'ai-chat';
    if (!ok || !m.content.trim()) return;
    const prev = queue.get(m.channelId) || Promise.resolve();
    const next = prev.then(() => handle(m)).catch((e) => console.error('ai', e.message));
    queue.set(m.channelId, next);
  });

  async function handle(m) {
    const h = history.get(m.channelId) || [];
    h.push({ role: 'user', content: (m.member?.displayName || m.author.username) + ': ' + m.content });
    while (h.length > 12) h.shift();
    history.set(m.channelId, h);
    await m.channel.sendTyping().catch(() => {});
    const typing = setInterval(() => m.channel.sendTyping().catch(() => {}), 8000);
    try {
      const sys = cfg.system || 'You are a helpful Discord assistant.';
      const reply = await askAI(cfg, [{ role: 'system', content: sys }, ...h]);
      h.push({ role: 'assistant', content: reply });
      while (h.length > 12) h.shift();
      const parts = chunk(reply);
      await m.reply({ content: parts[0], allowedMentions: { repliedUser: false } });
      for (const p of parts.slice(1)) await m.channel.send({ content: p, allowedMentions: { parse: [] } });
    } catch (e) {
      await m.reply({ content: 'AI error: ' + String(e.message).slice(0, 300), allowedMentions: { repliedUser: false } }).catch(() => {});
    } finally { clearInterval(typing); }
  }
}
