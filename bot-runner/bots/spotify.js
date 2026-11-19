import play from 'play-dl';

const SPOTIFY_ID = (process.env.SPOTIFY_CLIENT_ID || '').trim();
const SPOTIFY_SECRET = (process.env.SPOTIFY_CLIENT_SECRET || '').trim();
let spotifyToken = null;
let spotifyTokenExp = 0;

export function hasSpotify() {
  return !!(SPOTIFY_ID && SPOTIFY_SECRET);
}

export function initSpotifyPlayDl() {
  if (!hasSpotify()) {
    console.warn('Spotify: set SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET on Railway');
    return false;
  }
  try {
    play.setToken({
      spotify: {
        client_id: SPOTIFY_ID,
        client_secret: SPOTIFY_SECRET,
        market: process.env.SPOTIFY_MARKET || 'IN'
      }
    });
    console.log('play-dl: Spotify client id/secret loaded');
    return true;
  } catch (e) {
    console.warn('play-dl Spotify token', e.message);
    return false;
  }
}

export function parseSpotifyUrl(input) {
  const s = String(input || '').trim();
  let m = s.match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|playlist)\/([A-Za-z0-9]{10,})/i);
  if (m) return { type: m[1].toLowerCase(), id: m[2] };
  m = s.match(/spotify:(track|album|playlist):([A-Za-z0-9]{10,})/i);
  if (m) return { type: m[1].toLowerCase(), id: m[2] };
  return null;
}

async function getSpotifyAppToken() {
  if (!hasSpotify()) return null;
  if (spotifyToken && Date.now() < spotifyTokenExp - 30000) return spotifyToken;
  const basic = Buffer.from(SPOTIFY_ID + ':' + SPOTIFY_SECRET).toString('base64');
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + basic,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(10000)
  });
  if (!r.ok) {
    const err = await r.text().catch(() => '');
    throw new Error('Spotify auth fail (' + r.status + '): ' + String(err).slice(0, 120));
  }
  const j = await r.json();
  spotifyToken = j.access_token;
  spotifyTokenExp = Date.now() + (Number(j.expires_in) || 3600) * 1000;
  return spotifyToken;
}

async function spotifyApi(path) {
  const token = await getSpotifyAppToken();
  if (!token) return null;
  const r = await fetch('https://api.spotify.com/v1/' + path, {
    headers: { Authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(12000)
  });
  if (!r.ok) {
    console.warn('spotify api', path, r.status);
    return null;
  }
  return r.json();
}

/** Resolve Spotify link or name → { searchQ, title, thumb, dur, spotifyUrl } */
export async function spotifyToQuery(query) {
  if (!hasSpotify()) return null;
  const parsed = parseSpotifyUrl(query);
  let searchQ = null;
  let meta = null;

  if (parsed && parsed.type === 'track') {
    const t = await spotifyApi('tracks/' + parsed.id);
    if (t && t.name) {
      const artists = (t.artists || []).map((a) => a.name).filter(Boolean).join(', ');
      searchQ = (artists ? artists + ' - ' : '') + t.name;
      meta = {
        spotifyUrl: t.external_urls && t.external_urls.spotify,
        title: (artists ? artists + ' — ' : '') + t.name,
        thumb: t.album && t.album.images && t.album.images[0] && t.album.images[0].url,
        dur: Math.round((Number(t.duration_ms) || 0) / 1000)
      };
    }
  } else if (parsed && parsed.type === 'album') {
    const a = await spotifyApi('albums/' + parsed.id);
    if (a && a.tracks && a.tracks.items && a.tracks.items[0]) {
      const tr = a.tracks.items[0];
      const artists = (tr.artists || a.artists || []).map((x) => x.name).filter(Boolean).join(', ');
      searchQ = (artists ? artists + ' - ' : '') + tr.name;
      meta = {
        spotifyUrl: a.external_urls && a.external_urls.spotify,
        title: (artists ? artists + ' — ' : '') + tr.name + ' (album)',
        thumb: a.images && a.images[0] && a.images[0].url
      };
    }
  } else if (parsed && parsed.type === 'playlist') {
    const pl = await spotifyApi('playlists/' + parsed.id + '/tracks?limit=1');
    const item = pl && pl.items && pl.items[0] && pl.items[0].track;
    if (item && item.name) {
      const artists = (item.artists || []).map((x) => x.name).filter(Boolean).join(', ');
      searchQ = (artists ? artists + ' - ' : '') + item.name;
      meta = {
        spotifyUrl: item.external_urls && item.external_urls.spotify,
        title: (artists ? artists + ' — ' : '') + item.name + ' (playlist)',
        thumb: item.album && item.album.images && item.album.images[0] && item.album.images[0].url
      };
    }
  } else {
    const data = await spotifyApi('search?type=track&limit=5&q=' + encodeURIComponent(query));
    const track = data && data.tracks && data.tracks.items && data.tracks.items[0];
    if (track && track.name) {
      const artists = (track.artists || []).map((a) => a.name).filter(Boolean).join(', ');
      searchQ = (artists ? artists + ' - ' : '') + track.name;
      meta = {
        spotifyUrl: track.external_urls && track.external_urls.spotify,
        title: (artists ? artists + ' — ' : '') + track.name,
        thumb: track.album && track.album.images && track.album.images[0] && track.album.images[0].url,
        dur: Math.round((Number(track.duration_ms) || 0) / 1000)
      };
    }
  }

  if (!searchQ) return null;
  return { searchQ, ...(meta || {}) };
}
