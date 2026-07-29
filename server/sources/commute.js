// Morning commute via Google Routes API (traffic-aware).
// Two numbers: duration leaving right now, and duration leaving at the
// configured departure time (COMMUTE_DEPART, e.g. 07:30).
//
// Quota safety: only polls during the morning window (matches when the
// frontend shows it). ~120 requests/day, well under a 300/day quota cap.

const ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const MORNING_START = 5;
const MORNING_END = 10;

function mockCommute() {
  return {
    label: process.env.COMMUTE_LABEL || 'Work',
    nowMinutes: 24,
    departMinutes: 31,
    departTime: process.env.COMMUTE_DEPART || '07:30',
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
  const body = {
    origin: { address: process.env.COMMUTE_ORIGIN },
    destination: { address: process.env.COMMUTE_DEST },
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

  if (!process.env.GOOGLE_MAPS_API_KEY || !process.env.COMMUTE_ORIGIN || !process.env.COMMUTE_DEST) {
    throw new Error('GOOGLE_MAPS_API_KEY, COMMUTE_ORIGIN, or COMMUTE_DEST not set in .env');
  }

  // Outside the morning window the widget is hidden — skip the API calls
  // and keep whatever is cached rather than burning quota
  const hour = new Date().getHours();
  const cached = require('../cache').get('commute');
  if ((hour < MORNING_START || hour >= MORNING_END) && cached) return cached;

  const departTime = process.env.COMMUTE_DEPART || '07:30';
  const [nowMinutes, departMinutes] = await Promise.all([
    computeRoute(null),
    computeRoute(nextDeparture(departTime)),
  ]);

  return {
    label: process.env.COMMUTE_LABEL || 'Work',
    nowMinutes,
    departMinutes,
    departTime,
  };
}

module.exports = {
  key: 'commute',
  intervalMs: 5 * 60 * 1000,
  fetch: fetchCommute,
};
