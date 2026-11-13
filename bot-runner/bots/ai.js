import { Events, MessageFlags } from 'discord.js';
import MODELS from '../models.js';
import { getSettings, saveSettings, MANAGE } from './util.js';

const URL = process.env.AXIOM_API_URL || 'https://axiom-ai-sand.vercel.app/api/v1/chat/completions';
const DEFAULTS = { provider: 'groq', model: 'openai/gpt-oss-20b', system: 'You are a helpful Discord assistant. Keep replies concise.' };

// Model + system prompt: website/dashboard only. Discord: channel on/off + status.
export const commands = [
  {
    name: 'ai',
    description: 'AI chat channel (model/prompt set from website only)',
    default_member_permissions: MANAGE,
    dm_permission: false,
    options: [
      {
        name: 'channel',
        description: 'AI replies to every message in this channel (no mention needed)',
        type: 1,
        options: [
          { name: 'channel', description: 'Text channel', type: 7, required: true, channel_types: [0] }
        ]
      },
      { name: 'off', description: 'Turn AI chat off', type: 1 },
      { name: 'status', description: 'Show AI settings', type: 1 }
    ]
  }
];

async function askAI(cfg, messages) {
  const key = process.env.AXIOM_API_KEY;
  if (!key) throw new Error('AXIOM_API_KEY not set');
  const res = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      provider: cfg.provider,
      messages,
      stream: false,
      temperature: 0.7,
      max_tokens: 1024
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && (data.error.message || data.error)) || 'API ' + res.status);
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '(empty reply)';
}

const chunk = (t, n = 1900) => {
  const o = [];
  for (let i = 0; i < t.length; i += n) o.push(t.slice(i, i + n));
  return o;
};

export function attach(client) {
  const history = new Map();
  const queue = new Map();

  client.on(Events.InteractionCreate, async (i) => {
    if (i.commandName !== 'ai') return;
    try {
      if (!i.isChatInputCommand()) return;
      const s = await getSettings(i.guildId);
      s.ai = s.ai || {};
      const eph = (content) => i.reply({ content, flags: MessageFlags.Ephemeral });
      const sub = i.options.getSubcommand();

      if (sub === 'channel') {
        const ch = i.options.getChannel('channel', true);
        s.ai.channelId = ch.id;
        await saveSettings(i.guildId, s);
        return eph('AI chat on in <#' + ch.id + '>. Model/prompt website se set hote hain.');
      }
      if (sub === 'off') {
        delete s.ai.channelId;
        await saveSettings(i.guildId, s);
        return eph('AI chat off.');
      }
      const c = { ...DEFAULTS, ...s.ai };
      return eph(
        'Channel: ' + (s.ai.channelId ? '<#' + s.ai.channelId + '>' : 'not set') +
        '\nProvider/model: ' + c.provider + ' / ' + c.model +
        '\nPrompt: ' + (c.system || DEFAULTS.system).slice(0, 120) +
        '\n_(Model & prompt website/dashboard se set hote hain)_'
      );
    } catch (e) {
      console.error('ai cmd', e.message);
    }
  });

  client.on(Events.MessageCreate, (m) => {
    if (m.author.bot || !m.guild || !m.content.trim()) return;
    getSettings(m.guildId).then((s) => {
      if (!s.ai || s.ai.channelId !== m.channelId) return;
      const prev = queue.get(m.channelId) || Promise.resolve();
      queue.set(
        m.channelId,
        prev.then(() => handle(m, { ...DEFAULTS, ...s.ai })).catch((e) => console.error('ai', e.message))
      );
    });
  });

  async function handle(m, cfg) {
    const h = history.get(m.channelId) || [];
    h.push({
      role: 'user',
      content: (m.member && m.member.displayName || m.author.username) + ': ' + m.content
    });
    while (h.length > 12) h.shift();
    history.set(m.channelId, h);
    await m.channel.sendTyping().catch(() => {});
    const typing = setInterval(() => m.channel.sendTyping().catch(() => {}), 8000);
    try {
      const reply = await askAI(cfg, [{ role: 'system', content: cfg.system }, ...h]);
      h.push({ role: 'assistant', content: reply });
      while (h.length > 12) h.shift();
      const parts = chunk(reply);
      await m.reply({ content: parts[0], allowedMentions: { parse: [], repliedUser: false } });
      for (const p of parts.slice(1)) await m.channel.send({ content: p, allowedMentions: { parse: [] } });
    } catch (e) {
      await m.reply({
        content: 'AI error: ' + String(e.message).slice(0, 300),
        allowedMentions: { parse: [], repliedUser: false }
      }).catch(() => {});
    } finally {
      clearInterval(typing);
    }
  }
}
