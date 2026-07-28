const BASE = 'https://api.open-meteo.com/v1/forecast';
const PARAMS = [
  'latitude=32.9483',
  'longitude=-96.7299',
  'current=temperature_2m,weathercode,precipitation_probability',
  'daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max',
  'temperature_unit=fahrenheit',
  'timezone=America/Chicago',
  'forecast_days=2',
].join('&');

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
    const res = await globalThis.fetch(`${BASE}?${PARAMS}`);
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const json = await res.json();
    return {
      temp: Math.round(json.current.temperature_2m),
      high: Math.round(json.daily.temperature_2m_max[0]),
      low: Math.round(json.daily.temperature_2m_min[0]),
      condition: WMO[json.current.weathercode] ?? 'Unknown',
      rainChance: json.daily.precipitation_probability_max[0],
    };
  },
};
