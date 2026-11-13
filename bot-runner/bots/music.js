import { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } from '@discordjs/voice';
import play from 'play-dl';
import { registerCommands } from './util.js';

if (process.env.YT_COOKIE) play.setToken({ youtube: { cookie: process.env.YT_COOKIE } });

const fmt = (s) => {
  s = Math.max(0, Math.floor(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

export function attachMusic(client) {
  const guilds = new Map(); // guildId -> state

  registerCommands(client, [
    { name: 'play', description: 'Search YouTube and play a song', options: [{ name: 'query', description: 'Song name', type: 3, required: true }] },
    { name: 'stop', description: 'Stop music and leave the voice channel' }
  ]);

  const pos = (st) => (st.offset + (st.playStart ? Date.now() - st.playStart : 0)) / 1000;

  function embed(st, ended) {
    const t = st.track, p = Math.min(pos(st), t.dur || 0), len = 20;
    const at = t.dur ? Math.min(len - 1, Math.floor((p / t.dur) * len)) : 0;
    const bar = '▬'.repeat(at) + '🔘' + '▬'.repeat(len - 1 - at);
    const e = new EmbedBuilder()
      .setColor(0x6c7bff)
      .setTitle(ended ? 'Finished: ' + t.title : (st.paused ? '⏸ ' : '▶ ') + t.title)
      .setURL(t.url)
      .setDescription(bar + '\n`' + fmt(p) + ' / ' + fmt(t.dur) + '`')
      .setFooter({ text: 'Requested by ' + t.by });
    if (t.thumb) e.setThumbnail(t.thumb);
    return e;
  }

  function row(st) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('mp:back').setLabel('⏪ 10s').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('mp:pause').setLabel(st.paused ? '▶ Resume' : '⏸ Pause').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('mp:fwd').setLabel('10s ⏩').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('mp:stop').setLabel('⏹ Stop').setStyle(ButtonStyle.Danger)
    );
  }

  const refresh = (st, ended) =>
    st.msg && st.msg.edit({ embeds: [embed(st, ended)], components: ended ? [] : [row(st)] }).catch(() => {});

  function destroy(guildId, ended) {
    const st = guilds.get(guildId);
    if (!st) return;
    guilds.delete(guildId);
    clearInterval(st.timer);
    try { st.player.stop(true); } catch {}
    try { st.connection.destroy(); } catch {}
    if (st.track) refresh(st, ended !== false);
  }

  async function startTrack(st, sec) {
    const s = await play.stream(st.track.url, { seek: sec });
    st.player.play(createAudioResource(s.stream, { inputType: s.type }));
    st.offset = sec * 1000;
    st.playStart = Date.now();
    st.paused = false;
  }

  function create(guild, vc) {
    const connection = joinVoiceChannel({ channelId: vc.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true });
    const player = createAudioPlayer();
    connection.subscribe(player);
    const st = { connection, player, channelId: vc.id, offset: 0, playStart: null, paused: false, track: null, msg: null, timer: null };
    player.on(AudioPlayerStatus.Idle, () => { if (guilds.get(guild.id) === st) destroy(guild.id, true); });
    player.on('error', (e) => { console.error('player', e.message); if (guilds.get(guild.id) === st) destroy(guild.id, true); });
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([entersState(connection, VoiceConnectionStatus.Signalling, 5000), entersState(connection, VoiceConnectionStatus.Connecting, 5000)]);
      } catch { if (guilds.get(guild.id) === st) destroy(guild.id, true); }
    });
    guilds.set(guild.id, st);
    return st;
  }

  async function onPlay(i) {
    const vc = i.member && i.member.voice && i.member.voice.channel;
    if (!vc) return i.reply({ content: 'Pehle kisi voice channel me join karo.', ephemeral: true });
    await i.deferReply();
    try {
      const found = await play.search(i.options.getString('query', true), { limit: 1, source: { youtube: 'video' } });
      if (!found.length) return i.editReply('Song nahi mila.');
      const v = found[0];
      if (guilds.has(i.guildId)) destroy(i.guildId, true);
      const st = create(i.guild, vc);
      st.track = { title: v.title || 'Unknown', url: v.url, dur: v.durationInSec || 0, thumb: v.thumbnails && v.thumbnails[0] && v.thumbnails[0].url, by: i.user.username };
      await startTrack(st, 0);
      st.msg = await i.editReply({ embeds: [embed(st)], components: [row(st)] });
      st.timer = setInterval(() => refresh(st), 10000);
    } catch (e) {
      console.error('play', e.message);
      destroy(i.guildId, true);
      await i.editReply('Play error: ' + String(e.message).slice(0, 200)).catch(() => {});
    }
  }

  async function onButton(i) {
    const st = guilds.get(i.guildId);
    if (!st || !st.track) return i.reply({ content: 'Abhi kuch play nahi ho raha.', ephemeral: true });
    if (!i.member.voice.channelId || i.member.voice.channelId !== st.channelId) return i.reply({ content: 'Bot ke voice channel me aao.', ephemeral: true });
    await i.deferUpdate();
    const act = i.customId.slice(3);
    try {
      if (act === 'stop') return destroy(i.guildId, true);
      if (act === 'pause') {
        if (st.paused) { st.player.unpause(); st.playStart = Date.now(); st.paused = false; }
        else { st.player.pause(); st.offset += Date.now() - st.playStart; st.playStart = null; st.paused = true; }
      } else {
        const max = Math.max(0, (st.track.dur || 0) - 2);
        await startTrack(st, Math.max(0, Math.min(max, pos(st) + (act === 'fwd' ? 10 : -10))));
      }
      refresh(st);
    } catch (e) { console.error('button', e.message); }
  }

  client.on(Events.InteractionCreate, (i) => {
    if (i.isChatInputCommand()) {
      if (i.commandName === 'play') return onPlay(i);
      if (i.commandName === 'stop') {
        if (!guilds.has(i.guildId)) return i.reply({ content: 'Kuch play nahi ho raha.', ephemeral: true });
        destroy(i.guildId, true);
        return i.reply('Stopped.');
      }
    } else if (i.isButton() && i.customId.startsWith('mp:')) return onButton(i);
  });
}
