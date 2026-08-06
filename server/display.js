// Physical display power, on the sleep schedule from server/config.js.
//
// CSS dimming isn't enough: behind two-way glass in a dark room a dimmed panel
// still reads as a glowing grey rectangle. With display.sleep.mode = 'off' the
// panel actually powers down.
//
// This is the only place the server shells out, so it is built to fail safe —
// every command is fire-and-forget with a timeout, and any error is logged and
// swallowed. A display that won't blank must never take the mirror down.

const { execFile } = require('child_process');
const path = require('path');
const config = require('./config');

const TICK_MS = 30 * 1000;        // finer than the 60s data poll, so schedule
                                  // edges land within half a minute
const VOICE_HOLD_MS = 2 * 60 * 1000;  // stay awake this long after talking
const CMD_TIMEOUT_MS = 15 * 1000;

const PS_SCRIPT = path.join(__dirname, '..', 'deploy', 'display-power.ps1');

let lastState = null;      // 'on' | 'off' | null (unknown — e.g. just booted)
let voiceHoldUntil = 0;
let warnedUnsupported = false;

// --- Schedule ---------------------------------------------------------------
// NOTE: this duplicates inSleepWindow() in public/app.js. Kept separate on
// purpose: sharing would need a module loadable both by the browser (no build
// step) and by require(), and making the server authoritative would delay the
// visual dim from 1s to the 60s data poll. Eight stable lines — if you change
// the logic here, change it there too.
function zonedHourMinute(tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz || undefined, hour12: false, hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || '0';
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0;
  return { hour, minute: parseInt(get('minute'), 10) };
}

function inSleepWindow(hour, minute, sleep) {
  if (!sleep || !sleep.enabled) return false;
  const cur = hour * 60 + minute;
  const [sh, sm] = sleep.start.split(':').map(Number);
  const [eh, em] = sleep.end.split(':').map(Number);
  const s = sh * 60 + sm, e = eh * 60 + em;
  if (s === e) return false;
  return s < e ? (cur >= s && cur < e) : (cur >= s || cur < e);
}

// --- Platform commands ------------------------------------------------------
function commandFor(state) {
  if (process.platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
             '-File', PS_SCRIPT, '-State', state],
    };
  }
  if (process.platform === 'darwin') {
    // Dev machine only, so the schedule can be exercised without a Surface.
    return state === 'off'
      ? { file: 'pmset', args: ['displaysleepnow'] }
      : { file: 'caffeinate', args: ['-u', '-t', '1'] };
  }
  return null;
}

function apply(state) {
  // MIRROR_DISPLAY_DRYRUN=1 logs what it would do without touching the panel —
  // for checking the schedule without blanking the screen you're working on.
  if (process.env.MIRROR_DISPLAY_DRYRUN === '1') {
    console.log(`[display] (dry run) would turn display ${state}`);
    lastState = state;
    return;
  }

  const cmd = commandFor(state);
  if (!cmd) {
    if (!warnedUnsupported) {
      console.warn(`[display] no power control for platform ${process.platform} — ` +
        'sleep will dim only');
      warnedUnsupported = true;
    }
    return;
  }
  execFile(cmd.file, cmd.args, { timeout: CMD_TIMEOUT_MS }, (err) => {
    if (err) {
      // Leave lastState as-is so the next tick retries rather than assuming
      // the panel reached the state we asked for.
      lastState = null;
      console.error(`[display] could not turn display ${state}:`, err.message);
      return;
    }
    console.log(`[display] display ${state}`);
  });
  lastState = state;
}

// --- Tick -------------------------------------------------------------------
function tick() {
  const { display, weather } = config.get();
  const sleep = display.sleep || {};

  // 'dim' is the default and means hands off — the CSS dim is the whole effect,
  // and this module issues no commands at all.
  if (sleep.mode !== 'off') {
    lastState = null;   // we're not driving the panel; forget what we last set
    return;
  }

  const { hour, minute } = zonedHourMinute(weather.timezone);
  const asleep = inSleepWindow(hour, minute, sleep);
  const held = Date.now() < voiceHoldUntil;
  const want = (!asleep || held) ? 'on' : 'off';

  if (want !== lastState) apply(want);
}

// Any voice state POST counts, including 'idle' — the daemon posts idle when a
// conversation ends, so the hold is measured from the end of the exchange.
function noteVoiceActivity() {
  voiceHoldUntil = Date.now() + VOICE_HOLD_MS;
  const sleep = (config.get().display || {}).sleep || {};
  if (sleep.mode === 'off' && lastState !== 'on') apply('on');
}

function start() {
  tick();
  setInterval(tick, TICK_MS);
}

module.exports = { start, noteVoiceActivity };
