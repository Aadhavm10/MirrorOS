const searchInput = document.getElementById('city-search');
const resultsEl = document.getElementById('city-results');
const toastEl = document.getElementById('toast');

async function loadConfig() {
  const res = await fetch('/api/config');
  const cfg = await res.json();
  document.getElementById('current-city').textContent = cfg.weather.city;
  document.getElementById('commute-origin').value = cfg.commute.origin;
  document.getElementById('commute-destination').value = cfg.commute.destination;
  document.getElementById('commute-depart').value = cfg.commute.depart;
  document.getElementById('commute-label').value = cfg.commute.label;
}

function showToast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.classList.toggle('error', isError);
  toastEl.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toastEl.hidden = true; }, 4000);
}

let debounceTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  const q = searchInput.value.trim();
  if (q.length < 2) {
    resultsEl.innerHTML = '';
    return;
  }
  debounceTimer = setTimeout(() => searchCities(q), 350);
});

async function searchCities(q) {
  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error('search failed');
    const cities = await res.json();
    renderResults(cities);
  } catch {
    resultsEl.innerHTML = '<p class="no-results">Search failed — is the mirror online?</p>';
  }
}

function renderResults(cities) {
  if (cities.length === 0) {
    resultsEl.innerHTML = '<p class="no-results">No matches found.</p>';
    return;
  }
  resultsEl.innerHTML = '';
  for (const city of cities) {
    const label = city.region ? `${city.name}, ${city.region}` : city.name;
    const btn = document.createElement('button');
    btn.className = 'city-option';
    btn.textContent = label;
    const detail = document.createElement('small');
    detail.textContent =
      `${city.country}  ·  ${city.latitude.toFixed(2)}, ${city.longitude.toFixed(2)}`;
    btn.appendChild(detail);
    btn.addEventListener('click', () => saveCity(label, city));
    resultsEl.appendChild(btn);
  }
}

async function saveCity(label, city) {
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        weather: { city: label, latitude: city.latitude, longitude: city.longitude },
      }),
    });
    if (!res.ok) throw new Error('save failed');
    searchInput.value = '';
    resultsEl.innerHTML = '';
    await loadConfig();
    showToast(`Weather set to ${label} ✓`);
  } catch {
    showToast('Could not save — try again.', true);
  }
}

document.getElementById('commute-save').addEventListener('click', async () => {
  const btn = document.getElementById('commute-save');
  btn.disabled = true;
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commute: {
          origin: document.getElementById('commute-origin').value,
          destination: document.getElementById('commute-destination').value,
          depart: document.getElementById('commute-depart').value,
          label: document.getElementById('commute-label').value,
        },
      }),
    });
    if (!res.ok) throw new Error('save failed');
    await loadConfig();
    showToast('Commute saved ✓');
  } catch {
    showToast('Could not save — try again.', true);
  } finally {
    btn.disabled = false;
  }
});

// --- Add calendar event ---

const alldayToggle = document.getElementById('event-allday');

alldayToggle.addEventListener('change', () => {
  const hidden = alldayToggle.checked;
  document.getElementById('event-time-field').style.visibility = hidden ? 'hidden' : 'visible';
  document.getElementById('event-duration-field').style.visibility = hidden ? 'hidden' : 'visible';
});

document.getElementById('event-save').addEventListener('click', async () => {
  const btn = document.getElementById('event-save');
  const title = document.getElementById('event-title').value.trim();
  const date = document.getElementById('event-date').value;
  const time = document.getElementById('event-time').value;
  const isAllDay = alldayToggle.checked;

  if (!title) return showToast('Give the event a title.', true);
  if (!date) return showToast('Pick a date.', true);
  if (!isAllDay && !time) return showToast('Pick a time (or mark it all-day).', true);

  // Build a local Date; toISOString converts to UTC for the server
  const startISO = new Date(`${date}T${isAllDay ? '00:00' : time}`).toISOString();

  btn.disabled = true;
  try {
    const res = await fetch('/api/calendar/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        startISO,
        durationMinutes: Number(document.getElementById('event-duration').value) || 60,
        isAllDay,
      }),
    });
    if (!res.ok) throw new Error('create failed');
    document.getElementById('event-title').value = '';
    showToast(`"${title}" added to your calendar ✓`);
  } catch {
    showToast('Could not create the event — try again.', true);
  } finally {
    btn.disabled = false;
  }
});

loadConfig().catch(() => showToast('Could not reach the mirror.', true));
