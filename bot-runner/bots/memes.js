import { Events, EmbedBuilder, MessageFlags, ChannelType } from 'discord.js';
import { getSettings, saveSettings, MANAGE } from './util.js';

export const commands = [
  { name: 'meme', description: 'Get a random meme', dm_permission: false },
  {
    name: 'memes',
    description: 'Auto-meme channel (posts every N minutes without commands)',
    default_member_permissions: MANAGE,
    dm_permission: false,
    options: [
      {
        name: 'set',
        description: 'Enable auto memes in a channel',
        type: 1,
        options: [
          { name: 'channel', description: 'Channel for auto memes', type: 7, required: true, channel_types: [ChannelType.GuildText] },
          { name: 'minutes', description: 'Interval in minutes (default 1, min 1)', type: 4, required: false, min_value: 1, max_value: 1440 }
        ]
      },
      { name: 'off', description: 'Disable auto memes', type: 1 },
      { name: 'status', description: 'Show auto-meme settings', type: 1 }
    ]
  }
];

async function getMeme() {
  const sources = [
    async () => {
      const r = await fetch('https://meme-api.com/gimme');
      if (!r.ok) return null;
      const m = await r.json();
      if (m && m.url && !m.nsfw && !m.spoiler) return m;
      return null;
    },
    async () => {
      const subs = ['memes', 'dankmemes', 'me_irl', 'wholesomememes', 'funny'];
      const sub = subs[Math.floor(Math.random() * subs.length)];
      const r = await fetch('https://www.reddit.com/r/' + sub + '/hot.json?limit=25', {
        headers: { 'user-agent': 'AxiomTAxisBot/1.0' }
      });
      if (!r.ok) return null;
      const j = await r.json();
      const posts = (j.data && j.data.children || [])
        .map((c) => c.data)
        .filter((p) => p && !p.over_18 && !p.spoiler && p.url && /\.(jpg|jpeg|png|gif|webp)$/i.test(p.url.split('?')[0]));
      if (!posts.length) return null;
      const p = posts[Math.floor(Math.random() * posts.length)];
      return { title: p.title, url: p.url, postLink: 'https://reddit.com' + p.permalink, subreddit: p.subreddit };
    }
  ];
  for (const src of sources) {
    for (let i = 0; i < 2; i++) {
      try {
        const m = await src();
        if (m) return m;
      } catch {}
    }
  }
  return null;
}

const embedOf = (m) =>
  new EmbedBuilder()
    .setColor(0xf97316)
    .setTitle(String(m.title || 'Meme').slice(0, 250))
    .setURL(m.postLink || null)
    .setImage(m.url)
    .setFooter({ text: 'r/' + (m.subreddit || 'memes') });

export function attach(client) {
  client.on(Events.InteractionCreate, async (i) => {
    try {
      if (i.isChatInputCommand() && i.commandName === 'meme') {
        await i.deferReply();
        const m = await getMeme();
        if (!m) return i.editReply('Meme nahi mila, thodi der baad try karo.');
        return i.editReply({ embeds: [embedOf(m)] });
      }
      if (!i.isChatInputCommand() || i.commandName !== 'memes') return;
      const s = await getSettings(i.guildId);
      s.memes = s.memes || {};
      const sub = i.options.getSubcommand();
      if (sub === 'set') {
        const ch = i.options.getChannel('channel', true);
        const mins = i.options.getInteger('minutes') || 1;
        s.memes = { enabled: true, channelId: ch.id, intervalMin: Math.max(1, Math.min(1440, mins)) };
        await saveSettings(i.guildId, s);
        return i.reply({
          content: `Auto memes **on** in ${ch} every **${s.memes.intervalMin}** min (no command needed).`,
          flags: MessageFlags.Ephemeral
        });
      }
      if (sub === 'off') {
        s.memes.enabled = false;
        await saveSettings(i.guildId, s);
        return i.reply({ content: 'Auto memes off.', flags: MessageFlags.Ephemeral });
      }
      if (sub === 'status') {
        const c = s.memes;
        return i.reply({
          content:
            `**Auto Memes**\nEnabled: ${c && c.enabled ? 'Yes' : 'No'}\nChannel: ${c && c.channelId ? '<#' + c.channelId + '>' : '—'}\nInterval: ${c && c.intervalMin ? c.intervalMin : 1} min`,
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (e) {
      console.error('meme cmd', e.message);
    }
  });

  const last = new Map();
  client.once(Events.ClientReady, () => {
    setInterval(async () => {
      for (const guild of client.guilds.cache.values()) {
        try {
          const s = await getSettings(guild.id);
          const c = s.memes;
          if (!c || !c.enabled || !c.channelId) continue;
          const every = Math.max(1, Number(c.intervalMin) || 1) * 60000;
          const now = Date.now();
          if (!last.has(guild.id)) {
            last.set(guild.id, now);
            continue;
          }
          if (now - last.get(guild.id) < every) continue;
          last.set(guild.id, now);
          const ch = guild.channels.cache.get(c.channelId);
          if (!ch || !ch.isTextBased()) continue;
          const m = await getMeme();
          if (m) await ch.send({ embeds: [embedOf(m)] }).catch(() => {});
        } catch (e) {
          console.error('memes tick', e.message);
        }
      }
    }, 30000);
  });
}
