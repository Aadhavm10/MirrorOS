const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

function pad(n) {
  return String(n).padStart(2, '0');
}

function updateClock() {
  const now = new Date();
  const h = pad(now.getHours());
  const m = pad(now.getMinutes());
  document.getElementById('clock').textContent = `${h}:${m}`;
  document.getElementById('date').textContent =
    `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`;

  updateMode(now.getHours());
}

let currentMode = null;
let lastData = null;

// Dev: force a mode with ?mode=morning|day|evening|night to preview layouts
const FORCED_MODE = new URLSearchParams(location.search).get('mode');

function updateMode(hour) {
  let mode;
  if (FORCED_MODE)                  mode = FORCED_MODE;
  else if (hour >= 5 && hour < 10)  mode = 'morning';
  else if (hour >= 10 && hour < 18) mode = 'day';
  else if (hour >= 18 && hour < 23) mode = 'evening';
  else                               mode = 'night';

  if (mode === currentMode) return;
  currentMode = mode;

  const body = document.body;
  body.classList.remove('mode-morning', 'mode-day', 'mode-evening', 'mode-night');
  body.classList.add(`mode-${mode}`);

  // Re-filter calendar for the new mode without waiting for the next poll
  if (lastData) renderCalendar(lastData.calendar);
}

function renderWeather(w) {
  if (!w) return;
  document.getElementById('weather-temp').textContent = `${w.temp}°`;
  document.getElementById('weather-condition').textContent = w.condition;
  document.getElementById('weather-high-low').textContent = `H: ${w.high}°  L: ${w.low}°`;
  document.getElementById('weather-rain').textContent = `Rain: ${w.rainChance}%`;
}

function renderCommute(c) {
  const section = document.getElementById('commute-section');
  if (!c) { section.innerHTML = ''; return; }
  section.innerHTML = `
    <div class="commute-line">
      <span class="commute-label">${c.label}</span>
      <span class="commute-now">${c.nowMinutes} min now</span>
      <span class="commute-depart">${c.departMinutes} min at ${c.departTime}</span>
    </div>
  `;
}

function formatEventTime(startISO, isAllDay) {
  const d = new Date(startISO);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86400000);
  const eventDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  let dayLabel;
  if (eventDay.getTime() === today.getTime())         dayLabel = 'Today';
  else if (eventDay.getTime() === tomorrow.getTime()) dayLabel = 'Tomorrow';
  else                                                dayLabel = DAYS[d.getDay()].slice(0, 3);

  if (isAllDay) return `${dayLabel} · All day`;

  const h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${dayLabel} · ${hour}:${pad(d.getMinutes())} ${ampm}`;
}

// Which events each mode cares about:
//   morning — today's events (spec: weather + today's events prominent)
//   day     — the single next event
//   evening — tomorrow's first event (so I know when to set an alarm)
//   night   — none (section is hidden by CSS anyway)
function eventsForMode(events, mode) {
  const now = new Date();
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const endOfTomorrow = new Date(startOfTomorrow.getTime() + 86400000);

  switch (mode) {
    case 'morning':
      return events.filter(e => new Date(e.startISO) < startOfTomorrow).slice(0, 3);
    case 'day':
      return events.slice(0, 1);
    case 'evening':
      return events
        .filter(e => {
          const d = new Date(e.startISO);
          return d >= startOfTomorrow && d < endOfTomorrow;
        })
        .slice(0, 1);
    default:
      return [];
  }
}

function renderCalendar(events) {
  const section = document.getElementById('calendar-section');
  events = eventsForMode(events || [], currentMode);
  if (events.length === 0) { section.innerHTML = ''; return; }
  section.innerHTML = events.map(e => `
    <div class="cal-event">
      <div class="cal-event-title">${e.title}</div>
      <div class="cal-event-time">${formatEventTime(e.startISO, e.isAllDay)}</div>
    </div>
  `).join('');
}

async function fetchData() {
  try {
    const res = await fetch('/api/data');
    const data = await res.json();
    lastData = data;
    renderWeather(data.weather);
    renderCommute(data.commute);
    renderCalendar(data.calendar);
  } catch (err) {
    console.error('[mirror] fetchData failed:', err.message);
  }
}

// Dev mode: add ?dev to URL to scale down to laptop screen
if (new URLSearchParams(location.search).has('dev')) {
  document.body.classList.add('dev-mode');
}

updateClock();
setInterval(updateClock, 1000);

fetchData();
setInterval(fetchData, 60 * 1000);
