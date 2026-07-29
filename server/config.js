// Phone-editable settings, persisted to server/config.json (gitignored).
// Secrets stay in .env — this file is only for harmless preferences.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'config.json');

function defaults() {
  return {
    weather: {
      city: 'Richardson, TX',
      latitude: parseFloat(process.env.WEATHER_LAT) || 32.9483,
      longitude: parseFloat(process.env.WEATHER_LON) || -96.7299,
      timezone: process.env.TZ || 'America/Chicago',
    },
    commute: {
      origin: process.env.COMMUTE_ORIGIN || '',
      destination: process.env.COMMUTE_DEST || '',
      depart: process.env.COMMUTE_DEPART || '07:30',
      label: process.env.COMMUTE_LABEL || 'Work',
    },
    display: {
      mode: 'sleek', // 'sleek' | 'full'
      greeting: { name: 'Gorgeous', customLine: '' },
      sleep: { enabled: false, start: '23:00', end: '06:00' },
    },
    news: {
      mode: 'national', // 'national' | 'local' | 'topic'
      query: '',
    },
  };
}

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

let config = load();

function load() {
  const base = defaults();
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const section of Object.keys(base)) {
      if (saved[section] && typeof saved[section] === 'object') {
        base[section] = { ...base[section], ...saved[section] };
      }
    }
  } catch {
    // no config.json yet, or malformed — run on defaults
  }
  return base;
}

function get() {
  return config;
}

// Accepts a partial config; only known sections/fields are applied.
function update(partial = {}) {
  if (partial.weather && typeof partial.weather === 'object') {
    const { city, latitude, longitude, timezone } = partial.weather;
    if (typeof city === 'string' && city.trim()) config.weather.city = city.trim();
    if (Number.isFinite(latitude) && Math.abs(latitude) <= 90) config.weather.latitude = latitude;
    if (Number.isFinite(longitude) && Math.abs(longitude) <= 180) config.weather.longitude = longitude;
    if (typeof timezone === 'string' && timezone.trim()) config.weather.timezone = timezone.trim();
  }
  if (partial.commute && typeof partial.commute === 'object') {
    const { origin, destination, depart, label } = partial.commute;
    if (typeof origin === 'string') config.commute.origin = origin.trim();
    if (typeof destination === 'string') config.commute.destination = destination.trim();
    if (typeof depart === 'string' && HHMM.test(depart.trim())) {
      config.commute.depart = depart.trim();
    }
    if (typeof label === 'string' && label.trim()) config.commute.label = label.trim();
  }
  if (partial.display && typeof partial.display === 'object') {
    const d = partial.display;
    if (d.mode === 'sleek' || d.mode === 'full') config.display.mode = d.mode;
    if (d.greeting && typeof d.greeting === 'object') {
      const { name, customLine } = d.greeting;
      if (typeof name === 'string') config.display.greeting.name = name.trim().slice(0, 40);
      if (typeof customLine === 'string') config.display.greeting.customLine = customLine.trim().slice(0, 80);
    }
    if (d.sleep && typeof d.sleep === 'object') {
      const { enabled, start, end } = d.sleep;
      if (typeof enabled === 'boolean') config.display.sleep.enabled = enabled;
      if (typeof start === 'string' && HHMM.test(start.trim())) config.display.sleep.start = start.trim();
      if (typeof end === 'string' && HHMM.test(end.trim())) config.display.sleep.end = end.trim();
    }
  }
  if (partial.news && typeof partial.news === 'object') {
    const { mode, query } = partial.news;
    if (['national', 'local', 'topic'].includes(mode)) config.news.mode = mode;
    if (typeof query === 'string') config.news.query = query.trim().slice(0, 60);
  }
  fs.writeFileSync(FILE, JSON.stringify(config, null, 2) + '\n');
  return config;
}

module.exports = { get, update };
