const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad(n) { return String(n).padStart(2, '0'); }

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- Dev previews -----------------------------------------------------------
const params = new URLSearchParams(location.search);
if (params.has('dev')) document.body.classList.add('dev-mode');
if (params.has('no-motion')) document.body.classList.add('no-motion');
const forcedLayout = params.get('layout');   // full | sleek
const forcedVoice = params.get('voice');      // listening | thinking | speaking
const forcedSleep = params.has('sleep');

// --- Settings (from /api/data) ---------------------------------------------
let settings = {
  timezone: undefined,
  display: {
    mode: 'sleek',
    greeting: { name: '', customLine: '' },
    sleep: { enabled: false, start: '23:00', end: '06:00' },
  },
};

function zonedNow(tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz || undefined,
    hour12: false, hour: '2-digit', minute: '2-digit',
    weekday: 'long', month: 'long', day: 'numeric',
  }).formatToParts(new Date());
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0;
  return {
    hour,
    minute: parseInt(get('minute'), 10),
    time: `${pad(hour)}:${get('minute')}`,
    date: `${get('weekday')}, ${get('month')} ${get('day')}`,
  };
}

function greetingWord(hour) {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  if (hour >= 18 && hour < 22) return 'Good evening';
  return 'Good night';
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
  document.getElementById('date').textContent = z.date;

  const g = settings.display.greeting || {};
  const word = greetingWord(z.hour);
  document.getElementById('greeting-line1').textContent = g.name ? `${word}, ${g.name}` : word;
  document.getElementById('greeting-line2').textContent = g.customLine || '';

  const sleeping = forcedSleep || inSleepWindow(z.hour, z.minute, settings.display.sleep);
  document.body.classList.toggle('sleeping', sleeping);
}

// --- Weather / pollen / commute --------------------------------------------
function renderWeather(w) {
  if (!w) return;
  document.getElementById('weather-temp').textContent = `${w.temp}°`;
  document.getElementById('weather-condition').textContent = w.condition;
  document.getElementById('weather-city').textContent = w.city || '';
  document.getElementById('weather-high-low').textContent = `H: ${w.high}°  L: ${w.low}°`;
  document.getElementById('weather-rain').textContent = `Rain: ${w.rainChance}%`;
  renderWeek(w.week);
}

function renderWeek(week) {
  const el = document.getElementById('week-section');
  if (!week || !week.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="rail-heading">WEEK</div><div id="weather-week">' +
    week.map((d) => `
      <div class="week-day">
        <div class="week-day-name">${d.day}</div>
        <div class="week-day-temps">${d.high}° <span>${d.low}°</span></div>
      </div>`).join('') + '</div>';
}

function renderPollen(pollen) {
  const el = document.getElementById('weather-pollen');
  if (!pollen || pollen.length === 0) { el.textContent = ''; return; }
  const active = pollen.filter((p) => p.value > 0);
  el.textContent = 'Pollen: ' + (active.length
    ? active.map((p) => `${p.name} ${p.category}`).join(' · ')
    : 'None');
}

function renderCommute(c) {
  const el = document.getElementById('commute-section');
  if (!c) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="commute-line">
      <span class="commute-label">${esc(c.label)}</span>
      <span class="commute-now">${c.nowMinutes} min now</span>
      <span class="commute-depart">${c.departMinutes} min at ${c.departTime}</span>
    </div>`;
}

// --- Calendar ---------------------------------------------------------------
function fmtClock12(d) {
  const h = d.getHours();
  return `${h % 12 || 12}:${pad(d.getMinutes())} ${h >= 12 ? 'PM' : 'AM'}`;
}

function fmtEventLabel(startISO, isAllDay) {
  const d = new Date(startISO);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86400000);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  let label;
  if (day.getTime() === today.getTime()) label = 'Today';
  else if (day.getTime() === tomorrow.getTime()) label = 'Tomorrow';
  else label = DAYS[d.getDay()];
  return isAllDay ? `${label} · All day` : `${label} · ${fmtClock12(d)}`;
}

function todaysFirst(events) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), dt = now.getDate();
  return (events || []).find((e) => {
    const t = new Date(e.startISO);
    return t.getFullYear() === y && t.getMonth() === m && t.getDate() === dt;
  });
}

function nextUpcoming(events) {
  const now = Date.now();
  return (events || []).find((e) => new Date(e.startISO).getTime() >= now) || (events || [])[0];
}

function renderTodayEvent(events) {
  const el = document.getElementById('today-event');
  const e = todaysFirst(events);
  el.innerHTML = e
    ? `<div class="cal-event-title">${esc(e.title)}</div>
       <div class="cal-event-time">Today · ${e.isAllDay ? 'All day' : fmtClock12(new Date(e.startISO))}</div>`
    : '';
}

function renderNextEvent(events) {
  const el = document.getElementById('next-event');
  const e = nextUpcoming(events);
  el.innerHTML = e
    ? `<div class="rail-heading">NEXT</div>
       <div class="cal-event-title">${esc(e.title)}</div>
       <div class="cal-event-time">${fmtEventLabel(e.startISO, e.isAllDay)}</div>`
    : '';
}

// --- News -------------------------------------------------------------------
function renderNews(news) {
  const el = document.getElementById('news-section');
  if (!news || !news.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="rail-heading">NEWS</div>' +
    news.map((n) => `<div class="news-item">${esc(n.title)}</div>`).join('');
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
    renderWeather(data.weather);
    renderPollen(data.pollen);
    renderCommute(data.commute);
    renderTodayEvent(data.calendar);
    renderNextEvent(data.calendar);
    renderNews(data.news);
  } catch (err) {
    console.error('[mirror] fetchData failed:', err.message);
  }
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

if (forcedVoice) {
  const sample = { listening: '', thinking: 'what’s the weather tomorrow', speaking: 'Tomorrow looks sunny with a high of 88.' };
  setVoice(forcedVoice, sample[forcedVoice] || '');
} else {
  fetchVoiceState();
  setInterval(fetchVoiceState, 1000);
}
