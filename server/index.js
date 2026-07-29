require('dotenv').config();

const express = require('express');
const path = require('path');
const cache = require('./cache');
const config = require('./config');
const { startPolling, refreshAll } = require('./poller');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());

app.get('/api/data', (req, res) => {
  res.json(cache.getAll());
});

// Phone settings page (add to home screen on iOS for an app-like feel)
app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'settings.html'));
});

app.get('/api/config', (req, res) => {
  res.json(config.get());
});

app.post('/api/config', (req, res) => {
  const updated = config.update(req.body);
  refreshAll().catch(() => {}); // pick up new settings without waiting for the next poll
  res.json(updated);
});

// City search for the settings page (Open-Meteo geocoding, no API key)
app.get('/api/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`;
    const r = await globalThis.fetch(url);
    if (!r.ok) throw new Error(`geocoding HTTP ${r.status}`);
    const json = await r.json();
    res.json((json.results || []).map((c) => ({
      name: c.name,
      region: c.admin1 || '',
      country: c.country_code || '',
      latitude: c.latitude,
      longitude: c.longitude,
    })));
  } catch (err) {
    console.error('[geocode] failed:', err.message);
    res.status(502).json({ error: 'geocoding failed' });
  }
});

// Create an iCloud calendar event (syncs to all Apple devices)
app.post('/api/calendar/event', async (req, res) => {
  const { title, startISO, durationMinutes = 60, isAllDay = false } = req.body || {};

  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
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
    });
    refreshAll().catch(() => {}); // show the new event on the mirror right away
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

app.listen(PORT, () => {
  console.log(`MirrorOS running at http://localhost:${PORT}`);
});
