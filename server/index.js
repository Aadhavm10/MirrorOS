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
