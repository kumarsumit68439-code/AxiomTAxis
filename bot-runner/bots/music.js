import { Events, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } from 'discord.js';
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } from '@discordjs/voice';
import play from 'play-dl';

if (process.env.YT_COOKIE) {
  try {
    play.setToken({ youtube: { cookie: process.env.YT_COOKIE } });
    console.log('play-dl: YT_COOKIE loaded');
  } catch (e) {
    console.error('play-dl cookie failed', e.message);
  }
}

export const commands = [
  {
    name: 'play',
    description: 'Search YouTube and play a song in a voice channel',
    dm_permission: false,
    options: [
      { name: 'query', description: 'Song name or YouTube URL', type: 3, required: true },
      {
        name: 'channel',
        description: 'Voice channel to join (select or paste ID). If empty, joins your current VC',
        type: 7,
        required: false,
        channel_types: [ChannelType.GuildVoice, ChannelType.GuildStageVoice]
      }
    ]
  },
  {
    name: 'join',
    description: 'Join a voice channel by selection or ID (no music yet)',
    dm_permission: false,
    options: [
      {
        name: 'channel',
        description: 'Voice channel to join',
        type: 7,
        required: true,
        channel_types: [ChannelType.GuildVoice, ChannelType.GuildStageVoice]
      }
    ]
  },
  { name: 'stop', description: 'Stop music and leave the voice channel', dm_permission: false }
];

const fmt = (s) => {
  s = Math.max(0, Math.floor(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

async function resolveVideo(query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Song name / URL empty.');

  try {
    const kind = play.yt_validate(q);
    if (kind === 'video') {
      const info = await play.video_info(q);
      const v = info.video_details;
      const url = v.url || q;
      if (!url) throw new Error('Video URL missing from YouTube.');
      return {
        title: v.title || 'Unknown',
        url,
        dur: Number(v.durationInSec) || 0,
        thumb: v.thumbnails && v.thumbnails[0] && v.thumbnails[0].url
      };
    }
  } catch (e) {
    if (/Sign in|confirm|bot|403|401/i.test(String(e.message))) {
      throw new Error('YouTube block: Railway pe valid YT_COOKIE set karo (browser se logged-in cookie). ' + String(e.message).slice(0, 120));
    }
  }

  let found = [];
  try {
    found = await play.search(q, { limit: 5, source: { youtube: 'video' } });
  } catch (e) {
    throw new Error('YouTube search fail: ' + String(e.message).slice(0, 180) + (process.env.YT_COOKIE ? '' : ' — YT_COOKIE set nahi hai.'));
  }
  if (!found || !found.length) throw new Error('Song nahi mila: ' + q);

  for (const v of found) {
    const url = v.url || (v.id ? 'https://www.youtube.com/watch?v=' + v.id : null);
    if (!url) continue;
    return {
      title: v.title || 'Unknown',
      url,
      dur: Number(v.durationInSec) || 0,
      thumb: v.thumbnails && v.thumbnails[0] && v.thumbnails[0].url
    };
  }
  throw new Error('Search result me valid YouTube URL nahi mili. Cookie refresh karo ya pure YouTube link se /play try karo.');
}

export function attach(client) {
  const guilds = new Map();
  const pos = (st) => (st.offset + (st.playStart ? Date.now() - st.playStart : 0)) / 1000;

  function embed(st, ended) {
    const t = st.track, p = Math.min(pos(st), t.dur || 0), len = 20;
    const at = t.dur ? Math.min(len - 1, Math.floor((p / t.dur) * len)) : 0;
    const bar = '▬'.repeat(at) + '🔘' + '▬'.repeat(len - 1 - at);
    const e = new EmbedBuilder()
      .setColor(0xf97316)
      .setTitle(ended ? 'Finished: ' + t.title : (st.paused ? '⏸ ' : '▶ ') + t.title)
      .setURL(t.url)
      .setDescription(bar + '\n`' + fmt(p) + ' / ' + fmt(t.dur) + '`')
      .setFooter({ text: 'Requested by ' + t.by });
    if (t.thumb) e.setThumbnail(t.thumb);
    return e;
  }

  const row = (st) => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mp:back').setLabel('⏪ 10s').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mp:pause').setLabel(st.paused ? '▶ Resume' : '⏸ Pause').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('mp:fwd').setLabel('10s ⏩').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mp:stop').setLabel('⏹ Stop').setStyle(ButtonStyle.Danger)
  );

  const refresh = (st, ended) =>
    st.msg && st.msg.edit({ embeds: [embed(st, ended)], components: ended ? [] : [row(st)] }).catch(() => {});

  function destroy(guildId) {
    const st = guilds.get(guildId);
    if (!st) return;
    guilds.delete(guildId);
    clearInterval(st.timer);
    try { st.player.stop(true); } catch {}
    try { st.connection.destroy(); } catch {}
    if (st.track) refresh(st, true);
  }

  async function startTrack(st, sec) {
    if (!st.track || !st.track.url) throw new Error('Track URL missing (not found url).');
    const s = await play.stream(st.track.url, { seek: sec });
    st.player.play(createAudioResource(s.stream, { inputType: s.type }));
    st.offset = sec * 1000;
    st.playStart = Date.now();
    st.paused = false;
  }

  function create(guild, vc) {
    const connection = joinVoiceChannel({
      channelId: vc.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true
    });
    const player = createAudioPlayer();
    connection.subscribe(player);
    const st = { connection, player, channelId: vc.id, offset: 0, playStart: null, paused: false, track: null, msg: null, timer: null };
    player.on(AudioPlayerStatus.Idle, () => { if (guilds.get(guild.id) === st) destroy(guild.id); });
    player.on('error', (e) => { console.error('player', e.message); if (guilds.get(guild.id) === st) destroy(guild.id); });
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000)
        ]);
      } catch {
        if (guilds.get(guild.id) === st) destroy(guild.id);
      }
    });
    guilds.set(guild.id, st);
    return st;
  }

  function resolveVC(i) {
    const opt = i.options.getChannel('channel', false);
    if (opt) {
      if (opt.type !== ChannelType.GuildVoice && opt.type !== ChannelType.GuildStageVoice) {
        return { error: 'Sirf voice / stage channel select karo.' };
      }
      return { channel: opt };
    }
    const memberVC = i.member && i.member.voice && i.member.voice.channel;
    if (memberVC) return { channel: memberVC };
    return { error: 'Kisi voice channel me join karo, ya /play me channel select / ID do.' };
  }

  function canJoin(channel, me) {
    if (!channel) return 'Channel nahi mila.';
    if (!me) return 'Bot member nahi mila.';
    const perms = channel.permissionsFor(me);
    if (!perms) return 'Permissions check nahi ho paya.';
    if (!perms.has(PermissionFlagsBits.Connect)) return 'Bot ko is channel me **Connect** permission nahi hai.';
    if (!perms.has(PermissionFlagsBits.Speak)) return 'Bot ko is channel me **Speak** permission nahi hai.';
    return null;
  }

  async function onPlay(i) {
    const resolved = resolveVC(i);
    if (resolved.error) return i.reply({ content: resolved.error, flags: MessageFlags.Ephemeral });
    const vc = resolved.channel;
    const me = i.guild.members.me;
    const permErr = canJoin(vc, me);
    if (permErr) return i.reply({ content: permErr, flags: MessageFlags.Ephemeral });

    await i.deferReply();
    try {
      const v = await resolveVideo(i.options.getString('query', true));
      if (guilds.has(i.guildId)) destroy(i.guildId);
      const st = create(i.guild, vc);
      st.track = {
        title: v.title,
        url: v.url,
        dur: v.dur,
        thumb: v.thumb,
        by: i.user.username
      };
      await startTrack(st, 0);
      st.msg = await i.editReply({ embeds: [embed(st)], components: [row(st)] });
      st.timer = setInterval(() => refresh(st), 10000);
    } catch (e) {
      console.error('play', e.message);
      destroy(i.guildId);
      await i.editReply('Play error: ' + String(e.message).slice(0, 280)).catch(() => {});
    }
  }

  async function onJoin(i) {
    const vc = i.options.getChannel('channel', true);
    if (vc.type !== ChannelType.GuildVoice && vc.type !== ChannelType.GuildStageVoice) {
      return i.reply({ content: 'Sirf voice / stage channel select karo.', flags: MessageFlags.Ephemeral });
    }
    const me = i.guild.members.me;
    const permErr = canJoin(vc, me);
    if (permErr) return i.reply({ content: permErr, flags: MessageFlags.Ephemeral });

    if (guilds.has(i.guildId)) destroy(i.guildId);
    create(i.guild, vc);
    return i.reply({
      content: `Joined **${vc.name}** (\`${vc.id}\`). Ab \`/play song\` se music chalao.`,
      flags: MessageFlags.Ephemeral
    });
  }

  async function onButton(i) {
    const st = guilds.get(i.guildId);
    if (!st || !st.track) return i.reply({ content: 'Abhi kuch play nahi ho raha.', flags: MessageFlags.Ephemeral });
    if (!i.member.voice.channelId || i.member.voice.channelId !== st.channelId) {
      return i.reply({ content: 'Bot ke voice channel me aao.', flags: MessageFlags.Ephemeral });
    }
    await i.deferUpdate();
    const act = i.customId.slice(3);
    try {
      if (act === 'stop') return destroy(i.guildId);
      if (act === 'pause') {
        if (st.paused) {
          st.player.unpause();
          st.playStart = Date.now();
          st.paused = false;
        } else {
          st.player.pause();
          st.offset += Date.now() - st.playStart;
          st.playStart = null;
          st.paused = true;
        }
      } else {
        const max = Math.max(0, (st.track.dur || 0) - 2);
        await startTrack(st, Math.max(0, Math.min(max, pos(st) + (act === 'fwd' ? 10 : -10))));
      }
      refresh(st);
    } catch (e) {
      console.error('button', e.message);
    }
  }

  client.on(Events.InteractionCreate, (i) => {
    if (i.isChatInputCommand()) {
      if (i.commandName === 'play') return onPlay(i);
      if (i.commandName === 'join') return onJoin(i);
      if (i.commandName === 'stop') {
        if (!guilds.has(i.guildId)) return i.reply({ content: 'Kuch play nahi ho raha.', flags: MessageFlags.Ephemeral });
        destroy(i.guildId);
        return i.reply('Stopped.');
      }
    } else if (i.isButton() && i.customId.startsWith('mp:')) return onButton(i);
  });
}
