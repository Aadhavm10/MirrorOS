const config = require('../config');

const BASE = 'https://api.open-meteo.com/v1/forecast';

function buildParams() {
  const { latitude, longitude, timezone } = config.get().weather;
  return [
    `latitude=${latitude}`,
    `longitude=${longitude}`,
    'current=temperature_2m,weathercode,precipitation_probability',
    'daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    'temperature_unit=fahrenheit',
    `timezone=${encodeURIComponent(timezone || process.env.TZ || 'America/Chicago')}`,
    'forecast_days=8', // today + the next 7 for the week row
  ].join('&');
}

const DAY_ABBREV = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const WMO = {
  0: 'Clear',
  1: 'Mostly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Freezing Fog',
  51: 'Light Drizzle', 53: 'Drizzle', 55: 'Heavy Drizzle',
  61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain',
  71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow', 77: 'Snow Grains',
  80: 'Showers', 81: 'Showers', 82: 'Heavy Showers',
  85: 'Snow Showers', 86: 'Heavy Snow Showers',
  95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
};

module.exports = {
  key: 'weather',
  intervalMs: 5 * 60 * 1000,
  async fetch() {
    const res = await globalThis.fetch(`${BASE}?${buildParams()}`);
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const json = await res.json();
    // Days 1–7 (tomorrow onward); today's numbers are already shown big
    const week = json.daily.time.slice(1, 8).map((date, i) => ({
      day: DAY_ABBREV[new Date(`${date}T12:00:00`).getDay()],
      high: Math.round(json.daily.temperature_2m_max[i + 1]),
      low: Math.round(json.daily.temperature_2m_min[i + 1]),
    }));
    return {
      city: config.get().weather.city,
      temp: Math.round(json.current.temperature_2m),
      high: Math.round(json.daily.temperature_2m_max[0]),
      low: Math.round(json.daily.temperature_2m_min[0]),
      condition: WMO[json.current.weathercode] ?? 'Unknown',
      rainChance: json.daily.precipitation_probability_max[0],
      week,
    };
  },
};
