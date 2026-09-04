// Morning commute via Google Routes API (traffic-aware), for both people.
// Two numbers each: duration leaving right now, and duration leaving at the
// departure time configured on the /settings page (e.g. 07:30).
// Only the API key stays in .env — addresses live in server/config.json.
//
// Quota safety: two people × two lookups = 4 requests per refresh, so the
// windows are twice as wide as they were for one person.
//   morning  (5–10, 5h)  every 10 min → 30 × 4 = 120
//   off-peak (10–23, 13h) every 20 min → 39 × 4 = 156
//   overnight (23–5)      cache only   → 0
// ~276 requests/day, under the 300/day quota cap. Narrowing either window
// puts it back over — see docs/google-maps-setup.md.

const config = require('../config');

const ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const MORNING_START = 5;
const MORNING_END = 10;
const NIGHT_START = 23;
const MORNING_MAX_AGE_MS = 10 * 60 * 1000;
const OFF_PEAK_MAX_AGE_MS = 20 * 60 * 1000;

const SLOTS = ['a', 'b'];

let lastFetchMs = 0;

function mockCommute() {
  const people = config.get().people;
  return {
    a: {
      name: people.a.name,
      label: people.a.commute.label,
      nowMinutes: 24,
      departMinutes: 31,
      departTime: people.a.commute.depart,
    },
    b: {
      name: people.b.name,
      label: people.b.commute.label,
      nowMinutes: 18,
      departMinutes: 22,
      departTime: people.b.commute.depart,
    },
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

async function computeRoute(origin, destination, departureTime) {
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

function isConfigured(person) {
  return Boolean(person.commute.origin && person.commute.destination);
}

async function routeFor(person) {
  const { origin, destination, depart, label } = person.commute;
  const [nowMinutes, departMinutes] = await Promise.all([
    computeRoute(origin, destination, null),
    computeRoute(origin, destination, nextDeparture(depart)),
  ]);
  return { name: person.name, label, nowMinutes, departMinutes, departTime: depart };
}

async function fetchCommute() {
  if (process.env.MOCK_COMMUTE === '1') return mockCommute();

  if (!process.env.GOOGLE_MAPS_API_KEY) {
    throw new Error('GOOGLE_MAPS_API_KEY not set in .env');
  }

  const people = config.get().people;
  const configured = SLOTS.filter((slot) => isConfigured(people[slot]));
  if (!configured.length) {
    throw new Error('no commute origin/destination set — add them on the /settings page');
  }

  // Freshness windows: morning = every 10 min, rest of the day = every 20 min,
  // overnight (23–5) = cache only, the widget is hidden
  const hour = new Date().getHours();
  const cached = require('../cache').get('commute');
  const inMorning = hour >= MORNING_START && hour < MORNING_END;
  const atNight = hour >= NIGHT_START || hour < MORNING_START;
  const maxAge = inMorning ? MORNING_MAX_AGE_MS : OFF_PEAK_MAX_AGE_MS;
  if (cached) {
    if (atNight) return cached;
    if (Date.now() - lastFetchMs < maxAge) return cached;
  }

  // One person's broken address must not blank out the other's commute, but
  // it should still be visible in the log rather than silently disappearing.
  const out = { a: null, b: null };
  const failures = [];
  for (const slot of configured) {
    try {
      out[slot] = await routeFor(people[slot]);
    } catch (err) {
      failures.push(`${people[slot].name}: ${err.message}`);
      console.error(`[commute] ${people[slot].name} failed:`, err.message);
    }
  }

  // Everyone configured failed — that's a source failure, not a partial result,
  // so let the poller mark it stale instead of caching a pair of nulls.
  if (failures.length === configured.length) {
    throw new Error(failures.join(' | '));
  }

  lastFetchMs = Date.now();
  return out;
}

module.exports = {
  key: 'commute',
  intervalMs: 5 * 60 * 1000,
  fetch: fetchCommute,
};
