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

async function fetchData() {
  try {
    const res = await fetch('/api/data');
    const data = await res.json();
    console.log('[mirror] /api/data:', data);
    // Phase 2+: render weather, calendar here
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
