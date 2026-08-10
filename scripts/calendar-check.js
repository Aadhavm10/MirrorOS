#!/usr/bin/env node
// Diagnose an empty calendar section.
//
// server/sources/calendar.js swallows per-calendar errors on purpose — one
// broken calendar must not take the mirror down. That's right for production
// and useless for debugging, so this script does the same walk out loud:
// which calendars the account has, what each one returns, and why any of them
// failed.
//
//   node scripts/calendar-check.js
//
// Prints no credentials and no event titles beyond what you already see on the
// mirror, so the output is safe to share.

require('dotenv').config();
const { DAVClient } = require('tsdav');
const ICAL = require('ical.js');

const LOOK_AHEAD_DAYS = 7;

async function main() {
  const { CALDAV_USERNAME, CALDAV_PASSWORD } = process.env;
  console.log('username set:', Boolean(CALDAV_USERNAME));
  console.log('password set:', Boolean(CALDAV_PASSWORD));
  if (!CALDAV_USERNAME || !CALDAV_PASSWORD) {
    console.log('\n-> Credentials missing from .env. Nothing else to test.');
    return;
  }
  if (/^\w{4}-\w{4}-\w{4}-\w{4}$/.test(CALDAV_PASSWORD)) {
    console.log('password shape: looks like an app-specific password ✓');
  } else {
    console.log('password shape: NOT xxxx-xxxx-xxxx-xxxx — iCloud needs an ' +
      'app-specific password, not your Apple ID password');
  }

  const client = new DAVClient({
    serverUrl: 'https://caldav.icloud.com',
    credentials: { username: CALDAV_USERNAME, password: CALDAV_PASSWORD },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });

  await client.login();
  console.log('\nlogin: OK');

  const calendars = await client.fetchCalendars();
  console.log(`calendars found: ${calendars.length}\n`);

  const now = new Date();
  const end = new Date(now.getTime() + LOOK_AHEAD_DAYS * 24 * 60 * 60 * 1000);
  console.log(`window: ${now.toISOString()}  ->  ${end.toISOString()}\n`);

  let grandTotal = 0;

  for (const calendar of calendars) {
    const name = calendar.displayName || '(unnamed)';
    const types = (calendar.components || []).join(',') || 'unknown';
    process.stdout.write(`- ${name}  [${types}]  `);

    // Same query the mirror makes.
    let windowed = null;
    let windowErr = null;
    try {
      windowed = await client.fetchCalendarObjects({
        calendar,
        timeRange: { start: now.toISOString(), end: end.toISOString() },
      });
    } catch (err) {
      windowErr = err.message;
    }

    if (windowErr) {
      console.log(`ERROR in windowed query: ${windowErr}`);
    } else {
      console.log(`${windowed.length} object(s) in the next ${LOOK_AHEAD_DAYS} days`);
      grandTotal += windowed.length;
    }

    // If the windowed query came back empty, ask again without the time filter.
    // That distinguishes "this calendar is empty" from "iCloud didn't like the
    // time-range filter on this calendar", which look identical to the mirror.
    if (!windowErr && windowed.length === 0) {
      try {
        const all = await client.fetchCalendarObjects({ calendar });
        if (all.length > 0) {
          let soonest = null;
          for (const obj of all) {
            if (!obj.data) continue;
            try {
              const comp = new ICAL.Component(ICAL.parse(obj.data));
              for (const vevent of comp.getAllSubcomponents('vevent')) {
                const d = new ICAL.Event(vevent).startDate.toJSDate();
                if (d > now && (!soonest || d < soonest)) soonest = d;
              }
            } catch { /* skip malformed */ }
          }
          console.log(`    unfiltered: ${all.length} object(s) exist here` +
            (soonest ? `, next upcoming ${soonest.toISOString()}` : ', none upcoming'));
          if (soonest && soonest <= end) {
            console.log('    -> an event IS in range but the windowed query ' +
              'missed it: the time-range filter is the problem');
          }
        }
      } catch (err) {
        console.log(`    unfiltered query also failed: ${err.message}`);
      }
    }
  }

  console.log(`\ntotal objects in window across all calendars: ${grandTotal}`);
  if (grandTotal === 0) {
    console.log(
      '\n-> Nothing scheduled in the next 7 days in ANY iCloud calendar on this\n' +
      '   account. If your phone shows events this week, they probably live in a\n' +
      '   Google/Exchange account that Apple Calendar displays alongside iCloud —\n' +
      '   CalDAV to icloud.com cannot see those.'
    );
  }
}

main().catch((err) => {
  console.error('\nFAILED:', err.message);
  console.error('\n401/403 -> wrong app-specific password, or 2FA not enabled on the Apple ID.');
  process.exit(1);
});
