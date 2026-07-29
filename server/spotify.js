// Spotify Web API client: OAuth (authorize once via /spotify/login), token
// refresh, and playback control on the user's active Spotify Connect device.
// Requires Spotify Premium for playback control.
// App credentials live in .env; user tokens persist in spotify-tokens.json
// (gitignored — they grant control of the user's Spotify account).

const fs = require('fs');
const path = require('path');

const TOKEN_FILE = path.join(__dirname, 'spotify-tokens.json');
const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';
const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing';

let tokens = null;
try {
  tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
} catch {
  // not connected yet
}

function creds() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  return { id, secret };
}

function isConnected() {
  return Boolean(creds() && tokens && tokens.refresh_token);
}

function redirectUri() {
  const port = process.env.PORT || 3000;
  return `http://127.0.0.1:${port}/spotify/callback`;
}

function authUrl(state) {
  const c = creds();
  const params = new URLSearchParams({
    client_id: c.id,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SCOPES,
    state,
  });
  return `${ACCOUNTS}/authorize?${params}`;
}

async function tokenRequest(body) {
  const c = creds();
  const res = await globalThis.fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${c.id}:${c.secret}`).toString('base64'),
    },
    body: new URLSearchParams(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Spotify token HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function exchangeCode(code) {
  const json = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
  });
  tokens = {
    refresh_token: json.refresh_token,
    access_token: json.access_token,
    expires_at: Date.now() + (json.expires_in - 60) * 1000,
  };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2) + '\n');
}

async function accessToken() {
  if (!isConnected()) throw new Error('Spotify not connected');
  if (tokens.access_token && Date.now() < tokens.expires_at) return tokens.access_token;
  const json = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
  });
  tokens.access_token = json.access_token;
  tokens.expires_at = Date.now() + (json.expires_in - 60) * 1000;
  if (json.refresh_token) tokens.refresh_token = json.refresh_token;
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2) + '\n');
  return tokens.access_token;
}

async function api(method, endpoint, body) {
  const token = await accessToken();
  const res = await globalThis.fetch(`${API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Spotify HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const raw = await res.text();
  return raw ? JSON.parse(raw) : null;
}

// Find where to play: the active device, else the first available one
async function deviceId() {
  const json = await api('GET', '/me/player/devices');
  const devices = (json && json.devices) || [];
  const active = devices.find((d) => d.is_active) || devices[0];
  if (!active) {
    throw new Error(
      'no Spotify device is available — open Spotify on a phone, computer, or speaker first'
    );
  }
  return active.id;
}

// action: play | pause | next | previous | volume
// query/itemType: what to search and play (play only); volume: 0-100
async function control({ action, query, itemType = 'track', volume }) {
  const device = await deviceId();
  const dq = `?device_id=${encodeURIComponent(device)}`;

  switch (action) {
    case 'play': {
      if (query) {
        const search = await api(
          'GET',
          `/search?q=${encodeURIComponent(query)}&type=${itemType}&limit=1`
        );
        const item = search[`${itemType}s`]?.items?.[0];
        if (!item) return `Nothing found on Spotify for "${query}".`;
        const body =
          itemType === 'track' ? { uris: [item.uri] } : { context_uri: item.uri };
        await api('PUT', `/me/player/play${dq}`, body);
        const by = item.artists ? ` by ${item.artists.map((a) => a.name).join(', ')}` : '';
        return `Playing ${item.name}${by}.`;
      }
      await api('PUT', `/me/player/play${dq}`, {});
      return 'Resumed playback.';
    }
    case 'pause':
      await api('PUT', `/me/player/pause${dq}`);
      return 'Paused.';
    case 'next':
      await api('POST', `/me/player/next${dq}`);
      return 'Skipped to the next track.';
    case 'previous':
      await api('POST', `/me/player/previous${dq}`);
      return 'Went back a track.';
    case 'volume': {
      const v = Math.max(0, Math.min(100, Math.round(volume)));
      await api('PUT', `/me/player/volume${dq}&volume_percent=${v}`);
      return `Volume set to ${v} percent.`;
    }
    default:
      throw new Error(`unknown action: ${action}`);
  }
}

async function nowPlaying() {
  const json = await api('GET', '/me/player/currently-playing');
  if (!json || !json.item) return 'Nothing is playing right now.';
  const artists = (json.item.artists || []).map((a) => a.name).join(', ');
  const state = json.is_playing ? 'Now playing' : 'Paused';
  return `${state}: ${json.item.name}${artists ? ` by ${artists}` : ''}.`;
}

module.exports = { isConnected, authUrl, exchangeCode, control, nowPlaying, creds };
