// Daily pollen levels via Google Pollen API, using the same key as commute.
// Location follows the weather city in server/config.json.
//
// Quota safety: forecasts update ~daily, so poll every 3 hours → 8
// requests/day, far under the 100/day quota cap.

const config = require('../config');

const ENDPOINT = 'https://pollen.googleapis.com/v1/forecast:lookup';

module.exports = {
  key: 'pollen',
  intervalMs: 3 * 60 * 60 * 1000,
  async fetch() {
    if (!process.env.GOOGLE_MAPS_API_KEY) {
      throw new Error('GOOGLE_MAPS_API_KEY not set in .env');
    }
    const { latitude, longitude } = config.get().weather;
    const url = `${ENDPOINT}?key=${process.env.GOOGLE_MAPS_API_KEY}` +
      `&location.latitude=${latitude}&location.longitude=${longitude}&days=1`;

    const res = await globalThis.fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Pollen API HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    const types = json.dailyInfo?.[0]?.pollenTypeInfo || [];

    // One entry per type (Tree/Grass/Weed): name, category, 0–5 index.
    // Types out of season have no indexInfo — report them as 0/None.
    return types.map((t) => ({
      name: t.displayName || t.code,
      category: t.indexInfo?.category || 'None',
      value: t.indexInfo?.value || 0,
    }));
  },
};
