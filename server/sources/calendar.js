const ICAL = require('ical.js');
const { DAVClient } = require('tsdav');

const LOOK_AHEAD_DAYS = 7;

let _client = null;

async function getClient() {
  if (_client) return _client;
  const client = new DAVClient({
    serverUrl: 'https://caldav.icloud.com',
    credentials: {
      username: process.env.CALDAV_USERNAME,
      password: process.env.CALDAV_PASSWORD,
    },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });
  await client.login();
  _client = client;
  return _client;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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
            events.push({ title: esc(event.summary || '(No title)'), startISO: d.toISOString(), isAllDay });
          }
        }
      } else {
        const d = event.startDate.toJSDate();
        if (d >= minStart && d <= rangeEnd) {
          events.push({ title: esc(event.summary || '(No title)'), startISO: d.toISOString(), isAllDay });
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

async function fetchCalendar() {
  if (process.env.MOCK_CALENDAR === '1') {
    return mockEvents().slice(0, 6);
  }

  if (!process.env.CALDAV_USERNAME || !process.env.CALDAV_PASSWORD) {
    throw new Error('CALDAV_USERNAME or CALDAV_PASSWORD not set in .env');
  }

  let client;
  try {
    client = await getClient();
  } catch (err) {
    _client = null;
    throw err;
  }

  const now = new Date();
  const end = new Date(now.getTime() + LOOK_AHEAD_DAYS * 24 * 60 * 60 * 1000);

  let calendars;
  try {
    calendars = await client.fetchCalendars();
  } catch (err) {
    _client = null;
    throw err;
  }

  const allEvents = [];

  for (const calendar of calendars) {
    let objects;
    try {
      objects = await client.fetchCalendarObjects({
        calendar,
        timeRange: { start: now.toISOString(), end: end.toISOString() },
      });
    } catch {
      continue;
    }
    for (const obj of objects) {
      if (obj.data) allEvents.push(...parseEvents(obj.data, now, end));
    }
  }

  allEvents.sort((a, b) => new Date(a.startISO) - new Date(b.startISO));
  // Return more than the display max (3) so the frontend can filter by
  // mode (e.g. evening needs tomorrow's first event even if today is busy)
  return allEvents.slice(0, 6);
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

async function createEvent({ title, startISO, durationMinutes = 60, isAllDay = false }) {
  if (!process.env.CALDAV_USERNAME || !process.env.CALDAV_PASSWORD) {
    throw new Error('CALDAV credentials not set in .env');
  }

  let client;
  try {
    client = await getClient();
  } catch (err) {
    _client = null;
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
};
