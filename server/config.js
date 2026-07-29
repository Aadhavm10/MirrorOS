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
    },
  };
}

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
    const { city, latitude, longitude } = partial.weather;
    if (typeof city === 'string' && city.trim()) config.weather.city = city.trim();
    if (Number.isFinite(latitude) && Math.abs(latitude) <= 90) config.weather.latitude = latitude;
    if (Number.isFinite(longitude) && Math.abs(longitude) <= 180) config.weather.longitude = longitude;
  }
  fs.writeFileSync(FILE, JSON.stringify(config, null, 2) + '\n');
  return config;
}

module.exports = { get, update };
