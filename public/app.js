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

function updateMode(hour) {
  let mode;
  if (hour >= 5 && hour < 10)       mode = 'morning';
  else if (hour >= 10 && hour < 18) mode = 'day';
  else if (hour >= 18 && hour < 23) mode = 'evening';
  else                               mode = 'night';

  const body = document.body;
  body.classList.remove('mode-morning', 'mode-day', 'mode-evening', 'mode-night');
  body.classList.add(`mode-${mode}`);
}

function renderWeather(w) {
  if (!w) return;
  document.getElementById('weather-temp').textContent = `${w.temp}°`;
  document.getElementById('weather-condition').textContent = w.condition;
  document.getElementById('weather-high-low').textContent = `H: ${w.high}°  L: ${w.low}°`;
  document.getElementById('weather-rain').textContent = `Rain: ${w.rainChance}%`;
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

function renderCalendar(events) {
  const section = document.getElementById('calendar-section');
  if (!events || events.length === 0) { section.innerHTML = ''; return; }
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
    renderWeather(data.weather);
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
