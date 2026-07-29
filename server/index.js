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
