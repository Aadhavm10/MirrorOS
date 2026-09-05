// Phone-editable settings, persisted to server/config.json (gitignored).
// Secrets stay in .env — this file is only for harmless preferences.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'config.json');

function defaults() {
  return {
    weather: {
      city: 'Richardson, TX',
      latitude: 32.9483,
      longitude: -96.7299,
      // TZ is the one env read left here: Node needs it at process start for
      // date maths, so it can't be a phone setting like the rest of this file.
      timezone: process.env.TZ || 'America/Chicago',
    },
    // Two people share the mirror. Keyed 'a'/'b' rather than an array because
    // load()'s merge spreads each section as an object — an array would come
    // back as {0:…,1:…}. Names and addresses are set on the /settings page;
    // only the two CalDAV credential pairs live in .env.
    people: {
      a: {
        name: 'Me',
        commute: { origin: '', destination: '', depart: '07:30', label: 'Work' },
        // Calendar display names to hide from the mirror, chosen on /settings.
        excludeCalendars: [],
      },
      b: {
        name: 'Partner',
        commute: { origin: '', destination: '', depart: '08:00', label: 'Work' },
        excludeCalendars: [],
      },
    },
    display: {
      mode: 'sleek', // 'sleek' | 'full'
      // Which person's column to show: 'both', or a single slot. Kept separate
      // from `mode` on purpose — they're independent axes, and folding them
      // together would mean four values that each have to answer "sleek or
      // full?" as well. Inert in sleek mode, which shows no columns at all.
      showPeople: 'both', // 'both' | 'a' | 'b'
      sleep: { enabled: false, start: '23:00', end: '06:00', mode: 'dim' },
    },
  };
}

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

let config = load();

// Bumped on every change so the mirror can notice one without waiting for its
// 60s data poll. In memory on purpose — a restart resets it to 0, which reads
// as a change to the display and correctly makes it re-fetch everything.
let revision = 0;

function load() {
  const base = defaults();
  let legacyCommute = null;
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const section of Object.keys(base)) {
      if (saved[section] && typeof saved[section] === 'object') {
        base[section] = { ...base[section], ...saved[section] };
      }
    }
    if (saved.commute && typeof saved.commute === 'object') legacyCommute = saved.commute;
  } catch {
    // no config.json yet, or malformed — run on defaults
  }
  // The greeting was removed from the mirror; drop the key an older
  // config.json would otherwise carry forward on the next write.
  delete base.display.greeting;
  // The merge above is shallow per top-level section, so a saved `display`
  // replaces base.display.sleep wholesale — a config.json written before
  // sleep.mode existed would leave it undefined. Normalise to the default.
  if (base.display.sleep.mode !== 'off') base.display.sleep.mode = 'dim';
  // Unlike sleep.mode this survives the merge (it's a direct key of `display`,
  // not nested), but a hand-edited config.json could still put anything here
  // and the frontend compares it against a slot name every render.
  if (!['both', 'a', 'b'].includes(base.display.showPeople)) {
    base.display.showPeople = 'both';
  }

  // Same shallow-merge problem for people: a saved `people` replaces each
  // person wholesale, so fill any field the saved copy was missing.
  const seed = defaults().people;
  for (const slot of ['a', 'b']) {
    base.people[slot] = { ...seed[slot], ...(base.people[slot] || {}) };
    base.people[slot].commute = {
      ...seed[slot].commute,
      ...(base.people[slot].commute || {}),
    };
    // A hand-edited config.json could put anything here; the filter indexes it
    // as an array on every calendar poll, so coerce rather than trust it.
    if (!Array.isArray(base.people[slot].excludeCalendars)) {
      base.people[slot].excludeCalendars = [];
    }
  }

  // Migration: before the mirror supported two people there was a single
  // top-level `commute`. defaults() no longer lists it, so the loop above
  // skips it entirely — carry it onto person A rather than silently losing
  // an address the user already typed in.
  if (legacyCommute && !base.people.a.commute.origin) {
    base.people.a.commute = { ...base.people.a.commute, ...legacyCommute };
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
  if (partial.people && typeof partial.people === 'object') {
    for (const slot of ['a', 'b']) {
      const p = partial.people[slot];
      if (!p || typeof p !== 'object') continue;
      const target = config.people[slot];
      if (typeof p.name === 'string' && p.name.trim()) {
        target.name = p.name.trim().slice(0, 20);
      }
      if (Array.isArray(p.excludeCalendars)) {
        target.excludeCalendars = p.excludeCalendars
          .filter((n) => typeof n === 'string' && n.trim())
          .map((n) => n.trim().slice(0, 80))
          .slice(0, 30);
      }
      if (p.commute && typeof p.commute === 'object') {
        const { origin, destination, depart, label } = p.commute;
        if (typeof origin === 'string') target.commute.origin = origin.trim();
        if (typeof destination === 'string') target.commute.destination = destination.trim();
        if (typeof depart === 'string' && HHMM.test(depart.trim())) {
          target.commute.depart = depart.trim();
        }
        if (typeof label === 'string' && label.trim()) target.commute.label = label.trim();
      }
    }
  }
  if (partial.display && typeof partial.display === 'object') {
    const d = partial.display;
    if (d.mode === 'sleek' || d.mode === 'full') config.display.mode = d.mode;
    if (['both', 'a', 'b'].includes(d.showPeople)) config.display.showPeople = d.showPeople;
    if (d.sleep && typeof d.sleep === 'object') {
      const { enabled, start, end, mode } = d.sleep;
      if (typeof enabled === 'boolean') config.display.sleep.enabled = enabled;
      if (mode === 'dim' || mode === 'off') config.display.sleep.mode = mode;
      if (typeof start === 'string' && HHMM.test(start.trim())) config.display.sleep.start = start.trim();
      if (typeof end === 'string' && HHMM.test(end.trim())) config.display.sleep.end = end.trim();
    }
  }
  revision += 1;
  fs.writeFileSync(FILE, JSON.stringify(config, null, 2) + '\n');
  return config;
}

function rev() {
  return revision;
}

// Bump the revision without writing config.json — for "the cached data behind
// these settings has caught up", which the mirror also needs to hear about.
function touch() {
  revision += 1;
}

module.exports = { get, update, rev, touch };
