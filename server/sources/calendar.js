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

      if (event.isRecurring()) {
        const expand = new ICAL.RecurExpansion({
          component: vevent,
          dtstart: event.startDate,
        });
        let next;
        while ((next = expand.next())) {
          const d = next.toJSDate();
          if (d > rangeEnd) break;
          if (d >= rangeStart) {
            events.push({ title: esc(event.summary || '(No title)'), startISO: d.toISOString(), isAllDay });
          }
        }
      } else {
        const d = event.startDate.toJSDate();
        if (d >= rangeStart && d <= rangeEnd) {
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

// Exported separately so createEvent() can be added later without restructuring
module.exports = {
  key: 'calendar',
  intervalMs: 5 * 60 * 1000,
  fetch: fetchCalendar,
};
