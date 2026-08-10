const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n) { return String(n).padStart(2, '0'); }

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- Icons ------------------------------------------------------------------
// Inline SVG only — no external files, no build step. Stroked with currentColor
// so they inherit the surrounding text colour and stay monochrome.

const ICONS = {
  sun:
    '<circle cx="12" cy="12" r="5"/>' +
    '<path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4' +
    'M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
  cloud:
    '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
  'partly-cloudy':
    '<circle cx="7.5" cy="7.5" r="3"/>' +
    '<path d="M7.5 1.6v1.4M7.5 12v1.4M1.6 7.5h1.4M12 7.5h1.4' +
    'M3.3 3.3l1 1M11.7 3.3l-1 1"/>' +
    '<g transform="translate(7.5 9) scale(0.62)">' +
    '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></g>',
  fog:
    '<path d="M3 8h18M5 12h14M3 16h18M6 20h12"/>',
  rain:
    '<path d="M20 16.6A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/>' +
    '<path d="M8 18v3M12 19v3M16 18v3"/>',
  snow:
    '<path d="M20 16.6A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/>' +
    '<path d="M8 19v.01M12 21v.01M16 19v.01M8 22v.01M16 22v.01"/>',
  thunder:
    '<path d="M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9"/>' +
    '<path d="M13 11l-4 6h6l-4 6"/>',
  car:
    '<path d="M4 17v-4.6l2-5A2 2 0 0 1 7.9 6h8.2a2 2 0 0 1 1.9 1.4l2 5V17"/>' +
    '<path d="M4 12.6h16"/>' +
    '<circle cx="7.6" cy="17" r="1.8"/><circle cx="16.4" cy="17" r="1.8"/>',
  pollen:
    '<circle cx="12" cy="12" r="2.6"/>' +
    '<path d="M12 4v.01M12 20v.01M4 12v.01M20 12v.01' +
    'M6.3 6.3v.01M17.7 17.7v.01M6.3 17.7v.01M17.7 6.3v.01"/>',
  news:
    '<path d="M4 5h13v14H4z"/><path d="M17 9h3v8a2 2 0 0 1-2 2"/>' +
    '<path d="M7 9h7M7 12.5h7M7 16h4"/>',
  music:
    '<path d="M9 18V5l12-2v13"/>' +
    '<circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
};

function icon(name, size) {
  const body = ICONS[name] || ICONS.cloud;
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24"` +
    ' fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round"' +
    ` stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

// --- Dev previews -----------------------------------------------------------
const params = new URLSearchParams(location.search);
if (params.has('dev')) document.body.classList.add('dev-mode');
if (params.has('no-motion')) document.body.classList.add('no-motion');
// ?center — hairline on the mirror's centre line, to check the clock sits on it
if (params.has('center')) document.body.classList.add('show-center');
// ?mirror — draw the whole mirror around the panel; the real acceptance test
if (params.has('mirror')) document.body.classList.add('mirror-mode');
const forcedLayout = params.get('layout');   // full | sleek
const forcedVoice = params.get('voice');      // listening | thinking | speaking
const forcedSleep = params.has('sleep');
// ?stale=calendar,weather — preview the offline/stale treatment without waiting
const forcedStale = (params.get('stale') || '').split(',').filter(Boolean);
// ?spotify — sample track, so the layout can be checked before the account is
// linked (which only happens at handoff, on the recipient's Spotify)
const forcedSpotify = params.has('spotify');

// The orb is built and styled but not shown on the mirror right now.
// Flip to true (or use ?voice=speaking) to bring it back.
const SHOW_VOICE_ORB = false;

// --- Settings (from /api/data) ---------------------------------------------
let settings = {
  timezone: undefined,
  display: {
    mode: 'sleek',
    sleep: { enabled: false, start: '23:00', end: '06:00', mode: 'dim' },
  },
};

function zonedNow(tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz || undefined,
    hour12: false, hour: '2-digit', minute: '2-digit',
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }).formatToParts(new Date());
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0;
  return {
    hour,
    minute: parseInt(get('minute'), 10),
    time: `${pad(hour)}:${get('minute')}`,
    weekday: get('weekday'),
    date: `${get('month')} ${get('day')}, ${get('year')}`,
  };
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

function applyLayout() {
  const mode = (forcedLayout || settings.display.mode) === 'full' ? 'full' : 'sleek';
  document.body.classList.toggle('layout-full', mode === 'full');
  document.body.classList.toggle('layout-sleek', mode !== 'full');
}

function updateClock() {
  const z = zonedNow(settings.timezone);
  document.getElementById('clock').textContent = z.time;
  document.getElementById('day').textContent = z.weekday;
  document.getElementById('date').textContent = z.date;

  const sleeping = forcedSleep || inSleepWindow(z.hour, z.minute, settings.display.sleep);
  document.body.classList.toggle('sleeping', sleeping);
}

// --- Weather ----------------------------------------------------------------
function renderWeather(w) {
  if (!w) return;
  document.getElementById('weather-icon').innerHTML = icon(w.icon || 'cloud', 60);
  document.getElementById('weather-temp').textContent = `${w.temp}°`;
  document.getElementById('weather-condition').textContent = w.condition;
  document.getElementById('weather-city').textContent = w.city || '';
  document.getElementById('weather-high-low').textContent = `H: ${w.high}°  L: ${w.low}°`;
  document.getElementById('weather-rain').textContent = `Rain: ${w.rainChance}%`;
  renderWeek(w.week);
}

// No heading — the week row reads as part of the weather block above it
function renderWeek(week) {
  const el = document.getElementById('week-section');
  if (!week || !week.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<div id="weather-week">' + week.map((d) => `
    <div class="week-day">
      <div class="week-day-name">${esc(d.day).toUpperCase()}</div>
      <div class="week-day-icon">${icon(d.icon || 'cloud', 30)}</div>
      <div class="week-day-temps">${d.high}°<span>${d.low}°</span></div>
    </div>`).join('') + '</div>';
}

// One quiet line under the weather — only the types actually in season.
function renderPollen(pollen) {
  const el = document.getElementById('weather-pollen');
  if (!pollen || pollen.length === 0) { el.textContent = ''; return; }
  const active = pollen.filter((p) => p.value > 0);
  el.textContent = 'Pollen: ' + (active.length
    ? active.map((p) => `${p.name} ${p.value}/5`).join(' · ')
    : 'None');
}

function renderCommute(c) {
  const el = document.getElementById('commute-section');
  if (!c) { el.innerHTML = ''; return; }
  el.innerHTML =
    `<div class="section-heading">COMMUTE · ${esc(c.label).toUpperCase()}</div>` +
    `<div class="icon-block">${icon('car', 44)}<div class="rows">` +
    `<div class="row"><span>Now</span><span>${c.nowMinutes} min</span></div>` +
    `<div class="row"><span>Leave at ${esc(c.departTime)}</span>` +
    `<span>${c.departMinutes} min</span></div>` +
    '</div></div>';
}

// --- Calendar ---------------------------------------------------------------
function fmtClock12(d) {
  const h = d.getHours();
  return `${h % 12 || 12}:${pad(d.getMinutes())} ${h >= 12 ? 'PM' : 'AM'}`;
}

// An empty calendar and an unreachable one look identical unless we say so.
function calendarDown(health) {
  return Boolean(health && health.calendar && health.calendar.stale);
}

function renderCalendar(events, health) {
  const el = document.getElementById('calendar-section');
  const list = (events || []).slice(0, 5);

  if (list.length) {
    el.classList.remove('unavailable');
    el.innerHTML =
      '<div class="section-heading">CALENDAR</div>' +
      list.map((e) => {
        const d = new Date(e.startISO);
        return '<div class="cal-row">' +
          `<span class="cal-day">${DAYS[d.getDay()]}</span>` +
          `<span class="cal-date">${MONTHS[d.getMonth()]} ${d.getDate()}</span>` +
          `<span class="cal-time">${e.isAllDay ? 'All day' : fmtClock12(d)}</span>` +
          `<span class="cal-title">${esc(e.title)}</span>` +
        '</div>';
      }).join('');
  } else if (calendarDown(health)) {
    el.classList.add('unavailable');
    el.innerHTML =
      '<div class="section-heading">CALENDAR</div>' +
      '<div class="cal-note">Calendar unavailable</div>';
  } else {
    el.classList.remove('unavailable');
    el.innerHTML = '';
  }
}

// --- Spotify ----------------------------------------------------------------
// Its own endpoint on a 10s poll rather than a cached source: a track that
// changed two minutes ago is worse than showing nothing. Stays empty until the
// account is linked at /spotify/login.

function renderSpotify(p) {
  const el = document.getElementById('spotify-section');
  if (!p || !p.track) { el.innerHTML = ''; return; }
  el.classList.toggle('paused', !p.isPlaying);
  el.innerHTML =
    '<div class="section-heading">NOW PLAYING</div>' +
    `<div class="icon-block">${icon('music', 44)}<div class="rows">` +
    `<div class="np-track">${esc(p.track)}</div>` +
    (p.artist ? `<div class="np-artist">${esc(p.artist)}</div>` : '') +
    '</div></div>';
}

async function fetchSpotify() {
  try {
    const res = await fetch('/api/spotify/now-playing');
    const d = await res.json();
    renderSpotify(d && d.playing);
  } catch { /* server briefly unreachable — leave the last track up */ }
}

// --- News -------------------------------------------------------------------
function renderNews(news) {
  const el = document.getElementById('news-section');
  if (!news || !news.length) { el.innerHTML = ''; return; }
  el.innerHTML =
    '<div class="section-heading">NEWS</div>' +
    `<div class="icon-block">${icon('news', 44)}<div class="rows">` +
    news.map((n) => `<div class="news-item">${esc(n.title)}</div>`).join('') +
    '</div></div>';
}

// --- Health -----------------------------------------------------------------
// The mirror should never quietly show yesterday's data as if it were current,
// and an empty calendar must not look the same as an unreachable one.

const SOURCE_LABELS = {
  weather: 'Weather', calendar: 'Calendar', commute: 'Commute',
  pollen: 'Pollen', news: 'News',
};

const HEALTH_SECTIONS = {
  weather: ['weather-section', 'week-section'],
  calendar: ['calendar-section'],
  commute: ['commute-section'],
  pollen: ['weather-pollen'],
  news: ['news-section'],
};

function applyForcedStale(health) {
  if (!forcedStale.length) return health;
  const out = { ...(health || {}) };
  for (const key of forcedStale) {
    out[key] = { configured: true, stale: true, ageMs: 42 * 60 * 1000, failures: 3 };
  }
  return out;
}

function renderHealth(health) {
  const line = document.getElementById('health-line');
  if (!health) { line.textContent = ''; return; }

  // Only sources that have worked before can be "stale" — one that has never
  // succeeded is unconfigured (no Google key, say), not broken.
  const stale = Object.keys(health).filter((k) => health[k].stale);
  const live = Object.keys(health).filter((k) => health[k].configured);

  for (const [key, ids] of Object.entries(HEALTH_SECTIONS)) {
    const isStale = Boolean(health[key] && health[key].stale);
    for (const id of ids) {
      const el = document.getElementById(id);
      // Don't dim a section whose content is already an "unavailable" notice —
      // that text is the signal, and it needs to stay readable.
      if (el) el.classList.toggle('stale', isStale && !el.classList.contains('unavailable'));
    }
  }

  if (stale.length === 0) {
    line.textContent = '';
  } else if (live.length > 0 && stale.length === live.length) {
    // Everything at once means the network is down, not five broken APIs
    const newest = Math.min(...stale.map((k) => health[k].ageMs));
    line.textContent = `Offline — data from ${fmtAge(newest)} ago`;
  } else {
    const names = stale.map((k) => SOURCE_LABELS[k] || k);
    line.textContent = `${names.join(' and ')} not updating`;
  }
}

function fmtAge(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

// --- Data poll --------------------------------------------------------------
async function fetchData() {
  try {
    const res = await fetch('/api/data');
    const data = await res.json();
    if (data.settings) {
      settings = { ...settings, ...data.settings };
      applyLayout();
      updateClock();
    }
    const health = applyForcedStale(data.health);
    renderWeather(data.weather);
    renderPollen(data.pollen);
    renderCommute(data.commute);
    renderCalendar(data.calendar, health);
    renderNews(data.news);
    renderHealth(health);
  } catch (err) {
    console.error('[mirror] fetchData failed:', err.message);
  }
}

// --- Settings-change poll ---------------------------------------------------
// /api/data is a full payload and a full re-render, so it stays on 60s. This
// asks the server a much cheaper question — "has anything changed?" — often
// enough that a save on the phone shows up on the glass while you're still
// holding it.
let lastRev = null;

async function pollRev() {
  try {
    const res = await fetch('/api/rev', { cache: 'no-store' });
    const { rev } = await res.json();
    // First response only seeds the baseline; boot already called fetchData().
    if (lastRev !== null && rev !== lastRev) fetchData();
    lastRev = rev;
  } catch { /* server restarting — the next tick retries */ }
}

// --- Voice orb --------------------------------------------------------------
function setVoice(state, text) {
  const body = document.body;
  const orb = document.querySelector('.orb-circle');
  const cap = document.getElementById('voice-caption');
  if (!state || state === 'idle') { body.classList.remove('voice-active'); return; }
  body.classList.add('voice-active');
  orb.classList.remove('orb-listening', 'orb-thinking', 'orb-speaking');
  orb.classList.add(`orb-${state}`);
  if (state === 'listening') cap.textContent = 'Listening…';
  else if (state === 'thinking') cap.textContent = text ? `“${text}”` : 'Thinking…';
  else cap.textContent = text || '';
}

async function fetchVoiceState() {
  try {
    const res = await fetch('/api/voice/state');
    const v = await res.json();
    if (!v || v.state === 'idle' || Date.now() - v.at > 20000) setVoice('idle');
    else setVoice(v.state, v.text);
  } catch { /* server briefly unreachable — leave as-is */ }
}

// --- Boot -------------------------------------------------------------------
applyLayout();
updateClock();
setInterval(updateClock, 1000);

fetchData();
setInterval(fetchData, 60 * 1000);

pollRev();
setInterval(pollRev, 2000);

if (forcedSpotify) {
  renderSpotify({ isPlaying: true, track: 'Nights', artist: 'Frank Ocean' });
} else {
  fetchSpotify();
  setInterval(fetchSpotify, 10 * 1000);
}

if (forcedVoice) {
  const sample = { listening: '', thinking: 'what’s the weather tomorrow', speaking: 'Tomorrow looks sunny with a high of 88.' };
  setVoice(forcedVoice, sample[forcedVoice] || '');
} else if (SHOW_VOICE_ORB) {
  fetchVoiceState();
  setInterval(fetchVoiceState, 1000);
}
