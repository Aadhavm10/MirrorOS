require('dotenv').config();

const express = require('express');
const path = require('path');
const cache = require('./cache');
const config = require('./config');
const { startPolling, refreshAll } = require('./poller');
const { fetchWithTimeout } = require('./http');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());

app.get('/api/data', (req, res) => {
  const { weather, display, people } = config.get();
  res.set('Cache-Control', 'no-store');
  res.json({
    ...cache.getAll(),
    // Only the names — the mirror labels each column with them. Addresses stay
    // out of the display payload; the settings page reads those from /api/config.
    settings: {
      timezone: weather.timezone,
      display,
      people: { a: { name: people.a.name }, b: { name: people.b.name } },
    },
    health: cache.health(),
  });
});

// Phone settings page (add to home screen on iOS for an app-like feel)
app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'settings.html'));
});

// Calendar names on each account, for the settings page's hide-a-calendar
// checkboxes. Hits iCloud live rather than the poll cache — it's only opened
// when someone has the settings page in front of them.
app.get('/api/calendars', async (req, res) => {
  const calendar = require('./sources/calendar');
  const out = {};
  for (const slot of ['a', 'b']) {
    try {
      out[slot] = await calendar.listCalendars(slot);
    } catch (err) {
      console.error(`[calendars] listing "${slot}" failed:`, err.message);
      out[slot] = [];
    }
  }
  res.set('Cache-Control', 'no-store');
  res.json(out);
});

app.get('/api/config', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(config.get());
});

app.post('/api/config', (req, res) => {
  // Two bumps on purpose. config.update() bumps immediately, so settings the
  // display can act on alone (layout mode, sleep window) land within a rev poll
  // instead of queueing behind a slow commute fetch. The second bump
  // fires once refreshAll() has actually replaced the cached data, which is the
  // only moment a new city or commute has anything different to show.
  const updated = config.update(req.body);
  refreshAll().catch(() => {}).finally(() => config.touch());
  res.json(updated);
});

// Changes nothing on its own — it's the cheap thing the mirror polls every few
// seconds so it knows when a full /api/data fetch is worth doing.
// Fresh per process start. The mirror reloads the whole page when it changes,
// which is how new frontend files reach the glass — bumping rev only re-fetches
// data, and app.js/style.css would stay on the old version until someone
// restarted the kiosk by hand.
const BOOT_ID = require('crypto').randomBytes(8).toString('hex');

app.get('/api/rev', (req, res) => {
  res.set('Cache-Control', 'no-store'); // a cached rev defeats the whole point
  res.json({ rev: config.rev(), boot: BOOT_ID });
});

// Pull the latest code and restart. See server/update.js for what it will and
// won't do; this half owns the restart, because only the process can exit.
app.post('/api/update', async (req, res) => {
  let result;
  try {
    result = await require('./update').run();
  } catch (err) {
    console.error('[update] failed:', err.message);
    return res.status(502).json({ ok: false, message: `git pull failed: ${err.message}` });
  }
  res.json(result);

  if (result.ok && result.changed) {
    // Exit non-zero on purpose: systemd's Restart=always doesn't care, but
    // Windows Task Scheduler only restarts a task it considers failed, and a
    // clean exit(0) there would leave the mirror dark until someone noticed.
    console.log(`[update] ${result.message} — restarting`);
    setTimeout(() => process.exit(1), 500);
  }
});

// City search for the settings page (Open-Meteo geocoding, no API key)
app.get('/api/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`;
    const r = await fetchWithTimeout(url);
    if (!r.ok) throw new Error(`geocoding HTTP ${r.status}`);
    const json = await r.json();
    res.json((json.results || []).map((c) => ({
      name: c.name,
      region: c.admin1 || '',
      country: c.country_code || '',
      latitude: c.latitude,
      longitude: c.longitude,
      timezone: c.timezone || '',
    })));
  } catch (err) {
    console.error('[geocode] failed:', err.message);
    res.status(502).json({ error: 'geocoding failed' });
  }
});

// Create an iCloud calendar event (syncs to all Apple devices)
app.post('/api/calendar/event', async (req, res) => {
  const { title, startISO, durationMinutes = 60, isAllDay = false, person = 'a' } = req.body || {};

  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  if (person !== 'a' && person !== 'b') {
    return res.status(400).json({ error: "person must be 'a' or 'b'" });
  }
  const start = new Date(startISO);
  if (!startISO || Number.isNaN(start.getTime())) {
    return res.status(400).json({ error: 'startISO must be a valid date-time' });
  }
  const duration = Number(durationMinutes);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 24 * 60) {
    return res.status(400).json({ error: 'durationMinutes must be between 1 and 1440' });
  }

  try {
    const result = await require('./sources/calendar').createEvent({
      title: title.trim(),
      startISO,
      durationMinutes: duration,
      isAllDay: Boolean(isAllDay),
      person,
    });
    // Re-fetch, then bump the rev so the mirror pulls it in seconds rather than
    // on the next minute boundary.
    refreshAll().catch(() => {}).finally(() => config.touch());
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    console.error('[calendar] createEvent failed:', err.message);
    res.status(502).json({ error: 'could not create event on iCloud' });
  }
});

// Voice indicator state: reported by the voice daemon, polled by the frontend
let voiceState = { state: 'idle', text: '', at: 0 };

app.post('/api/voice/state', (req, res) => {
  const { state, text } = req.body || {};
  if (!['idle', 'listening', 'thinking', 'speaking'].includes(state)) {
    return res.status(400).json({ error: 'state must be idle|listening|thinking|speaking' });
  }
  voiceState = { state, text: String(text || '').slice(0, 300), at: Date.now() };
  // Talking to the mirror wakes the panel and holds it awake for a couple of
  // minutes. Fires on 'idle' too, so the hold runs from the end of the exchange.
  require('./display').noteVoiceActivity();
  res.json({ ok: true });
});

app.get('/api/voice/state', (req, res) => {
  res.json(voiceState);
});

// Spotify OAuth: visit /spotify/login once in a browser to connect the account
const spotify = require('./spotify');
let spotifyAuthState = null;

app.get('/spotify/login', (req, res) => {
  if (!spotify.creds()) {
    return res
      .status(503)
      .send('Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env first (see docs/spotify-setup.md).');
  }
  spotifyAuthState = require('crypto').randomBytes(16).toString('hex');
  res.redirect(spotify.authUrl(spotifyAuthState));
});

app.get('/spotify/callback', async (req, res) => {
  if (!req.query.code || req.query.state !== spotifyAuthState) {
    return res.status(400).send('Spotify authorization failed — try /spotify/login again.');
  }
  spotifyAuthState = null;
  try {
    await spotify.exchangeCode(String(req.query.code));
    res.send('Spotify connected ✓ — you can close this tab and talk to the mirror.');
  } catch (err) {
    console.error('[spotify] token exchange failed:', err.message);
    res.status(502).send('Spotify token exchange failed — check the server log.');
  }
});

// Now playing, polled by the mirror every 10s. Stays quiet until the account
// is linked via /spotify/login — no Spotify call is made when disconnected.
app.get('/api/spotify/now-playing', async (req, res) => {
  if (!spotify.isConnected()) return res.json({ connected: false, playing: null });
  try {
    res.json({ connected: true, playing: await spotify.nowPlayingData() });
  } catch (err) {
    console.error('[spotify] now-playing failed:', err.message);
    res.status(502).json({ connected: true, playing: null });
  }
});

// Voice assistant brain (text in → spoken-style text out).
// The voice pipeline posts transcripts here; also handy for curl testing.
app.post('/api/assistant', async (req, res) => {
  const text = String((req.body && req.body.text) || '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: 'ANTHROPIC_API_KEY not set in .env — create one at console.anthropic.com',
    });
  }
  try {
    const reply = await require('./assistant').ask(text);
    res.json({ reply });
  } catch (err) {
    console.error('[assistant] failed:', err.message);
    res.status(502).json({ error: 'assistant failed' });
  }
});

const sources = [
  require('./sources/weather'),
  require('./sources/calendar'),
  require('./sources/commute'),
  require('./sources/pollen'),
];

startPolling(sources);
require('./display').start();

// Last line of defence. Node's default is to kill the process on an unhandled
// rejection, and a dead mirror is worse than a degraded one: nobody is watching
// the console, and Task Scheduler gives up after a few restarts. The sources
// already never crash the server (poller.js) — this catches anything that
// slipped past, keeps the last good data on the glass, and leaves a trail in
// the log for whoever goes looking.
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandled rejection:', (reason && reason.stack) || reason);
});

process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaught exception:', err.stack || err.message);
});

app.listen(PORT, () => {
  console.log(`MirrorOS running at http://localhost:${PORT}`);
});
