import { Events, MessageFlags } from 'discord.js';
import MODELS from '../models.js';
import { getSettings, saveSettings, MANAGE } from './util.js';

const URL = process.env.AXIOM_API_URL || 'https://axiom-ai-sand.vercel.app/api/v1/chat/completions';
const DEFAULTS = { provider: 'groq', model: 'openai/gpt-oss-20b', system: 'You are a helpful Discord assistant. Keep replies concise.' };

// Har AI reply ke saath ye rules jaate hain: seedha jawab, kisi ko tag/mention nahi, emoji vibe ke hisaab se.
const STYLE_RULES =
  'Reply directly in the channel like a normal chat message. Never tag, ping or mention anyone (no @user, no @everyone) and never start with the person\'s name. ' +
  'Match the vibe of the message and use fitting emojis naturally.';
const LIGHT_RULES =
  'The user sent only an emoji, a GIF or a sticker. Reply with 1 to 5 emojis that match its mood or meaning, plus at most 6 words if it helps. No long text.';

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

const GIF_RE = /https?:\/\/(?:[\w-]+\.)?(?:tenor\.com|giphy\.com)\S*/i;
const EMOJI_ONLY_STRIP = /:\w+:|\u200d|\ufe0f|\p{Extended_Pictographic}|\p{Regional_Indicator}|\s/gu;

// Message ko AI ke samajhne layak text me badalta hai (emoji / GIF / sticker / image bhi).
// light = sirf emoji, GIF ya sticker bheja gaya hai.
function describe(m) {
  let t = (m.content || '').replace(/<a?:(\w+):\d+>/g, ':$1:').trim();
  const tags = [];
  const g = t.match(GIF_RE);
  if (g) {
    let slug = '';
    try {
      const seg = decodeURIComponent(new globalThis.URL(g[0]).pathname.split('/').filter(Boolean).pop() || '');
      slug = seg.replace(/-?\d+$/, '').replace(/-?gifs?$/i, '').replace(/[-_]+/g, ' ').trim();
    } catch {}
    tags.push('[GIF' + (slug ? ': ' + slug : '') + ']');
    t = t.replace(g[0], '').trim();
  }
  if (m.stickers && m.stickers.size) {
    for (const st of m.stickers.values()) tags.push('[sticker: ' + st.name + ']');
  }
  if (m.attachments && m.attachments.size) {
    for (const a of m.attachments.values()) {
      const ct = String(a.contentType || '');
      if (ct.includes('gif')) tags.push('[GIF: ' + (a.name || 'gif') + ']');
      else if (ct.startsWith('image/')) tags.push('[image: ' + (a.name || 'image') + ']');
      else tags.push('[file: ' + (a.name || 'file') + ']');
    }
  }
  const text = (t + ' ' + tags.join(' ')).trim();
  const media = tags.some((x) => x.startsWith('[GIF') || x.startsWith('[sticker'));
  const emojiOnly = t !== '' && t.replace(EMOJI_ONLY_STRIP, '') === '';
  const light = (media && t === '') || (emojiOnly && tags.length === 0);
  return { text, light };
}

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
    if (m.author.bot || !m.guild) return;
    getSettings(m.guildId).then((s) => {
      if (!s.ai || s.ai.channelId !== m.channelId) return;
      const d = describe(m);
      if (!d.text) return;
      const prev = queue.get(m.channelId) || Promise.resolve();
      queue.set(
        m.channelId,
        prev.then(() => handle(m, d, { ...DEFAULTS, ...s.ai })).catch((e) => console.error('ai', e.message))
      );
    }).catch((e) => console.error('ai msg', e.message));
  });

  async function handle(m, d, cfg) {
    const h = history.get(m.channelId) || [];
    h.push({
      role: 'user',
      content: (m.member && m.member.displayName || m.author.username) + ': ' + d.text
    });
    while (h.length > 12) h.shift();
    history.set(m.channelId, h);
    await m.channel.sendTyping().catch(() => {});
    const typing = setInterval(() => m.channel.sendTyping().catch(() => {}), 8000);
    try {
      const sys = (cfg.system || DEFAULTS.system) + '\n\n' + STYLE_RULES;
      const msgs = [{ role: 'system', content: sys }, ...h];
      if (d.light) msgs.push({ role: 'system', content: LIGHT_RULES });
      const reply = await askAI(cfg, msgs);
      h.push({ role: 'assistant', content: reply });
      while (h.length > 12) h.shift();
      // Seedha channel me bhejte hain: na reply-tag, na mention, na ping.
      for (const p of chunk(reply)) await m.channel.send({ content: p, allowedMentions: { parse: [] } });
      if (d.light) {
        const em = reply.match(/\p{Extended_Pictographic}/u);
        if (em) await m.react(em[0]).catch(() => {});
      }
    } catch (e) {
      await m.channel.send({
        content: 'AI error: ' + String(e.message).slice(0, 300),
        allowedMentions: { parse: [] }
      }).catch(() => {});
    } finally {
      clearInterval(typing);
    }
  }
}
