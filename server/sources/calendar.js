const ICAL = require('ical.js');
const { DAVClient } = require('tsdav');

// How far out to look for the next few events. This is a search bound, not a
// display window: the mirror shows the next handful whenever they fall, so a
// quiet week shouldn't leave the column blank. Wide enough to always find
// something, bounded so an open-ended recurring event can't expand forever.
const LOOK_AHEAD_DAYS = 120;

// Two iCloud accounts, one per person. Slot 'a' keeps the original unsuffixed
// env var names so an existing .env keeps working untouched.
const ACCOUNTS = {
  a: { username: 'CALDAV_USERNAME', password: 'CALDAV_PASSWORD' },
  b: { username: 'CALDAV_USERNAME_B', password: 'CALDAV_PASSWORD_B' },
};

const SLOTS = ['a', 'b'];

// Logged-in DAVClient per slot. Cleared on failure so the next poll re-logs in
// rather than reusing a client whose session went bad.
const _clients = { a: null, b: null };

function credsFor(slot) {
  const { username, password } = ACCOUNTS[slot];
  return { username: process.env[username], password: process.env[password] };
}

function hasCreds(slot) {
  const { username, password } = credsFor(slot);
  return Boolean(username && password);
}

async function getClient(slot) {
  if (_clients[slot]) return _clients[slot];
  const client = new DAVClient({
    serverUrl: 'https://caldav.icloud.com',
    credentials: credsFor(slot),
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });
  await client.login();
  _clients[slot] = client;
  return _clients[slot];
}

// Titles are returned as plain text — the frontend escapes at render time, and
// the assistant reads them as prose. Escaping here would double up in both.
function parseEvents(icsData, rangeStart, rangeEnd) {
  const events = [];
  try {
    const jcal = ICAL.parse(icsData);
    const comp = new ICAL.Component(jcal);
    for (const vevent of comp.getAllSubcomponents('vevent')) {
      const event = new ICAL.Event(vevent);
      const isAllDay = event.startDate.isDate;
      // All-day events start at midnight but stay relevant all day —
      // compare them against the start of today, not the current time
      const minStart = isAllDay
        ? new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate())
        : rangeStart;

      if (event.isRecurring()) {
        const expand = new ICAL.RecurExpansion({
          component: vevent,
          dtstart: event.startDate,
        });
        let next;
        while ((next = expand.next())) {
          const d = next.toJSDate();
          if (d > rangeEnd) break;
          if (d >= minStart) {
            events.push({ title: event.summary || '(No title)', startISO: d.toISOString(), isAllDay });
          }
        }
      } else {
        const d = event.startDate.toJSDate();
        if (d >= minStart && d <= rangeEnd) {
          events.push({ title: event.summary || '(No title)', startISO: d.toISOString(), isAllDay });
        }
      }
    }
  } catch {
    // skip malformed calendar objects
  }
  return events;
}

// Dev-only fake events so the calendar layout can be verified in all
// time-of-day modes before real CalDAV credentials exist
function mockEvents() {
  const now = new Date();
  const at = (dayOffset, hour, min = 0) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, min).toISOString();
  return [
    { title: 'Gym', startISO: at(0, 18, 30), isAllDay: false },
    { title: 'Dinner with family', startISO: at(0, 20, 0), isAllDay: false },
    { title: 'Team standup', startISO: at(1, 9, 0), isAllDay: false },
    { title: 'Dentist appointment', startISO: at(1, 14, 30), isAllDay: false },
    { title: 'Trash day', startISO: at(2, 0, 0), isAllDay: true },
  ].filter(e => new Date(e.startISO) >= now || e.isAllDay);
}

// Calendar names this person has chosen to hide, lowercased for comparison.
function excludedFor(slot) {
  const person = require('../config').get().people[slot] || {};
  return new Set((person.excludeCalendars || []).map((n) => String(n).toLowerCase()));
}

// Names of every VEVENT calendar on an account, for the settings page's
// checkbox list. Subscribed feeds never reach here — tsdav's fetchCalendars()
// leaves them out, which is also why a subscribed holidays feed would never
// have shown on the mirror in the first place.
async function listCalendars(slot) {
  if (!hasCreds(slot)) return [];
  const client = await getClient(slot);
  const calendars = await client.fetchCalendars();
  return calendars
    .filter((c) => !c.components || c.components.includes('VEVENT'))
    .map((c) => c.displayName || '(unnamed)');
}

async function fetchForSlot(slot) {
  let client;
  try {
    client = await getClient(slot);
  } catch (err) {
    _clients[slot] = null;
    throw err;
  }

  const now = new Date();
  const end = new Date(now.getTime() + LOOK_AHEAD_DAYS * 24 * 60 * 60 * 1000);

  let calendars;
  try {
    calendars = await client.fetchCalendars();
  } catch (err) {
    _clients[slot] = null;
    throw err;
  }

  const allEvents = [];
  const excluded = excludedFor(slot);

  for (const calendar of calendars) {
    if (excluded.has(String(calendar.displayName || '').toLowerCase())) continue;
    let objects;
    try {
      objects = await client.fetchCalendarObjects({
        calendar,
        timeRange: { start: now.toISOString(), end: end.toISOString() },
      });
    } catch (err) {
      // One unreadable calendar must not take the whole section down, so keep
      // going — but say so. Silently continuing here makes a total failure look
      // identical to an empty week, which is a miserable thing to debug.
      console.error(
        `[calendar] skipped "${calendar.displayName || 'unnamed'}":`, err.message
      );
      continue;
    }
    for (const obj of objects) {
      if (obj.data) allEvents.push(...parseEvents(obj.data, now, end));
    }
  }

  allEvents.sort((a, b) => new Date(a.startISO) - new Date(b.startISO));
  // A few more than the display max (5) so the frontend has some slack
  return allEvents.slice(0, 8);
}

async function fetchCalendar() {
  if (process.env.MOCK_CALENDAR === '1') {
    const events = mockEvents().slice(0, 6);
    return { a: events, b: events.slice(0, 3).reverse() };
  }

  const configured = SLOTS.filter(hasCreds);
  if (!configured.length) {
    throw new Error('CALDAV_USERNAME or CALDAV_PASSWORD not set in .env');
  }

  // One person's broken credentials must not blank out the other's calendar.
  // Same reasoning as the per-calendar skip above: keep going, but say so.
  const out = { a: null, b: null };
  const failures = [];
  for (const slot of configured) {
    try {
      out[slot] = await fetchForSlot(slot);
    } catch (err) {
      failures.push(`${slot}: ${err.message}`);
      console.error(`[calendar] account "${slot}" failed:`, err.message);
    }
  }

  // Everyone configured failed — a source failure, not a partial result, so
  // let the poller mark it stale rather than caching a pair of nulls.
  if (failures.length === configured.length) {
    throw new Error(failures.join(' | '));
  }
  return out;
}

// --- Write support ---------------------------------------------------------

// RFC 5545 text escaping for SUMMARY
function icsEscape(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// 2026-07-30T15:00:00.000Z → 20260730T150000Z
function icsUtc(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// Local calendar date of a Date → 20260730 (server TZ matches the user's)
function icsDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function buildIcs({ uid, title, start, durationMinutes, isAllDay }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MirrorOS//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${icsUtc(new Date())}`,
    `SUMMARY:${icsEscape(title)}`,
  ];
  if (isAllDay) {
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    lines.push(`DTSTART;VALUE=DATE:${icsDate(start)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDate(end)}`);
  } else {
    const end = new Date(start.getTime() + durationMinutes * 60000);
    lines.push(`DTSTART:${icsUtc(start)}`);
    lines.push(`DTEND:${icsUtc(end)}`);
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

// `person` is the slot to write to ('a' or 'b'); defaults to 'a', which is
// whoever owns the original unsuffixed CALDAV_* credentials.
async function createEvent({ title, startISO, durationMinutes = 60, isAllDay = false, person = 'a' }) {
  const slot = SLOTS.includes(person) ? person : 'a';
  if (!hasCreds(slot)) {
    throw new Error(`CalDAV credentials for "${slot}" not set in .env`);
  }

  let client;
  try {
    client = await getClient(slot);
  } catch (err) {
    _clients[slot] = null;
    throw err;
  }

  const calendars = await client.fetchCalendars();
  const target = calendars.find(
    (c) => !c.components || c.components.includes('VEVENT')
  );
  if (!target) throw new Error('no VEVENT-capable calendar found');

  const uid = `mirroros-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const iCalString = buildIcs({
    uid,
    title,
    start: new Date(startISO),
    durationMinutes,
    isAllDay,
  });

  const res = await client.createCalendarObject({
    calendar: target,
    filename: `${uid}.ics`,
    iCalString,
  });
  if (!res.ok) {
    throw new Error(`CalDAV create failed: HTTP ${res.status}`);
  }
  return { uid, calendar: target.displayName || target.url };
}

// { key, intervalMs, fetch } is the poller's source contract;
// createEvent rides alongside for write access
module.exports = {
  key: 'calendar',
  intervalMs: 5 * 60 * 1000,
  fetch: fetchCalendar,
  createEvent,
  listCalendars,
};
