// Morning commute via Google Routes API (traffic-aware).
// Two numbers: duration leaving right now, and duration leaving at the
// departure time configured on the /settings page (e.g. 07:30).
// Only the API key stays in .env — addresses live in server/config.json.
//
// Quota safety: fresh every 5 min during the morning window (rush hour),
// every 20 min the rest of the day, nothing overnight (widget hidden).
// Morning 5h×12×2 = 120 + off-peak 13h×3×2 = 78 → ~198 requests/day,
// under the 300/day quota cap.

const config = require('../config');

const ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const MORNING_START = 5;
const MORNING_END = 10;
const NIGHT_START = 23;
const OFF_PEAK_MAX_AGE_MS = 20 * 60 * 1000;

let lastFetchMs = 0;

function mockCommute() {
  const { label, depart } = config.get().commute;
  return {
    label,
    nowMinutes: 24,
    departMinutes: 31,
    departTime: depart,
  };
}

// Next occurrence of HH:MM — today if still ahead, otherwise tomorrow
function nextDeparture(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  if (d.getTime() <= now.getTime() + 60000) d.setDate(d.getDate() + 1);
  return d;
}

async function computeRoute(departureTime) {
  const { origin, destination } = config.get().commute;
  const body = {
    origin: { address: origin },
    destination: { address: destination },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
  };
  if (departureTime) body.departureTime = departureTime.toISOString();

  const res = await globalThis.fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': 'routes.duration',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Routes API HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  const duration = json.routes?.[0]?.duration; // e.g. "1487s"
  if (!duration) throw new Error('Routes API returned no route');
  return Math.round(parseInt(duration, 10) / 60);
}

async function fetchCommute() {
  if (process.env.MOCK_COMMUTE === '1') return mockCommute();

  const { origin, destination, depart } = config.get().commute;
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    throw new Error('GOOGLE_MAPS_API_KEY not set in .env');
  }
  if (!origin || !destination) {
    throw new Error('commute origin/destination not set — add them on the /settings page');
  }

  // Freshness windows: morning = every poll (5 min), rest of the day =
  // every 20 min, overnight (23–5) = cache only, the widget is hidden
  const hour = new Date().getHours();
  const cached = require('../cache').get('commute');
  const inMorning = hour >= MORNING_START && hour < MORNING_END;
  const atNight = hour >= NIGHT_START || hour < MORNING_START;
  if (cached) {
    if (atNight) return cached;
    if (!inMorning && Date.now() - lastFetchMs < OFF_PEAK_MAX_AGE_MS) return cached;
  }

  const [nowMinutes, departMinutes] = await Promise.all([
    computeRoute(null),
    computeRoute(nextDeparture(depart)),
  ]);
  lastFetchMs = Date.now();

  return {
    label: config.get().commute.label,
    nowMinutes,
    departMinutes,
    departTime: depart,
  };
}

module.exports = {
  key: 'commute',
  intervalMs: 5 * 60 * 1000,
  fetch: fetchCommute,
};
