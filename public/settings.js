const searchInput = document.getElementById('city-search');
const resultsEl = document.getElementById('city-results');
const toastEl = document.getElementById('toast');

async function loadConfig() {
  const res = await fetch('/api/config');
  const cfg = await res.json();
  document.getElementById('current-city').textContent = cfg.weather.city;
  // Label the "Show" options with the real names rather than "Person 1/2".
  const showSel = document.getElementById('show-people');
  showSel.options[1].textContent = `${cfg.people.a.name || 'Person 1'} only`;
  showSel.options[2].textContent = `${cfg.people.b.name || 'Person 2'} only`;
  showSel.value = cfg.display.showPeople || 'both';

  for (const slot of ['a', 'b']) {
    const p = cfg.people[slot];
    const field = (name) => document.getElementById(`person-${slot}-${name}`);
    renderCalendarList(slot, p.excludeCalendars || []);
    field('name').value = p.name;
    field('origin').value = p.commute.origin;
    field('destination').value = p.commute.destination;
    field('depart').value = p.commute.depart;
    field('label').value = p.commute.label;
  }

  // Display mode
  const isFull = cfg.display.mode === 'full';
  document.getElementById('display-mode').checked = isFull;
  document.getElementById('mode-label').textContent = isFull ? 'Full' : 'Sleek';

  // Sleep
  document.getElementById('sleep-enabled').checked = cfg.display.sleep.enabled;
  document.getElementById('sleep-mode').value = cfg.display.sleep.mode || 'dim';
  document.getElementById('sleep-start').value = cfg.display.sleep.start;
  document.getElementById('sleep-end').value = cfg.display.sleep.end;

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
        weather: {
          city: label,
          latitude: city.latitude,
          longitude: city.longitude,
          timezone: city.timezone || '',
        },
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

// Calendar names come from iCloud, so they're fetched once and cached here.
// The config stores what's EXCLUDED; the UI shows what's included, so the two
// are inverses of each other — tick means show.
let calendarNames = null;

async function loadCalendarNames() {
  if (calendarNames) return calendarNames;
  try {
    const res = await fetch('/api/calendars');
    calendarNames = res.ok ? await res.json() : { a: [], b: [] };
  } catch {
    calendarNames = { a: [], b: [] };
  }
  return calendarNames;
}

async function renderCalendarList(slot, excluded) {
  const box = document.getElementById(`person-${slot}-calendars`);
  const names = (await loadCalendarNames())[slot] || [];
  if (!names.length) {
    box.textContent = 'No calendars found — check this person’s credentials in .env.';
    return;
  }
  const hidden = new Set(excluded.map((n) => n.toLowerCase()));
  box.innerHTML = names.map((n) => {
    const checked = hidden.has(n.toLowerCase()) ? '' : ' checked';
    return `<label class="calendar-item"><input type="checkbox" value="${n.replace(/"/g, '&quot;')}"${checked}> ${n}</label>`;
  }).join('');
}

// Ticked means show, so the excluded list is everything left unticked.
function excludedFrom(slot) {
  const box = document.getElementById(`person-${slot}-calendars`);
  return [...box.querySelectorAll('input[type=checkbox]')]
    .filter((cb) => !cb.checked)
    .map((cb) => cb.value);
}

// One handler per person — same shape, different slot.
for (const slot of ['a', 'b']) {
  const field = (name) => document.getElementById(`person-${slot}-${name}`);
  field('save').addEventListener('click', () =>
    saveSection(`person-${slot}-save`, {
      people: {
        [slot]: {
          name: field('name').value,
          excludeCalendars: excludedFrom(slot),
          commute: {
            origin: field('origin').value,
            destination: field('destination').value,
            depart: field('depart').value,
            label: field('label').value,
          },
        },
      },
    }, `${field('name').value || 'Person'} saved ✓`)
  );
}

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

// --- Who to show (saves immediately, like the mode toggle above) ---
document.getElementById('show-people').addEventListener('change', async (e) => {
  const showPeople = e.target.value;
  const label = e.target.options[e.target.selectedIndex].textContent;
  try {
    const res = await postConfig({ display: { showPeople } });
    if (!res.ok) throw new Error();
    showToast(`Showing ${label.toLowerCase()} ✓`);
  } catch {
    showToast('Could not save — try again.', true);
  }
});

// --- Display mode toggle (saves immediately) ---
document.getElementById('display-mode').addEventListener('change', async (e) => {
  const mode = e.target.checked ? 'full' : 'sleek';
  document.getElementById('mode-label').textContent = e.target.checked ? 'Full' : 'Sleek';
  try {
    const res = await postConfig({ display: { mode } });
    if (!res.ok) throw new Error();
    showToast(`Mirror set to ${mode} mode ✓`);
  } catch {
    showToast('Could not save — try again.', true);
  }
});

// --- Sleep ---
document.getElementById('sleep-save').addEventListener('click', () =>
  saveSection('sleep-save', {
    display: {
      sleep: {
        enabled: document.getElementById('sleep-enabled').checked,
        mode: document.getElementById('sleep-mode').value,
        start: document.getElementById('sleep-start').value,
        end: document.getElementById('sleep-end').value,
      },
    },
  }, 'Sleep schedule saved ✓')
);

// --- Update ---
// The server restarts itself on a successful pull, so the response arrives and
// then the connection dies. That's success, not an error — don't report the
// dropped socket as a failure.
document.getElementById('update-run').addEventListener('click', async () => {
  const btn = document.getElementById('update-run');
  const status = document.getElementById('update-status');
  btn.disabled = true;
  status.textContent = 'Pulling…';
  try {
    const res = await fetch('/api/update', { method: 'POST' });
    const r = await res.json();
    status.textContent = r.message || (r.ok ? 'Done.' : 'Update failed.');
    if (r.npmError) status.textContent += ` (npm install reported: ${r.npmError})`;
    showToast(r.ok ? 'Mirror updated ✓' : 'Update failed', !r.ok);
    if (r.changed && r.restart) status.textContent += ' Restarting — give it about 10 seconds.';
  } catch {
    status.textContent = 'Could not reach the mirror. It may already be restarting.';
    showToast('No response — check the mirror', true);
  } finally {
    btn.disabled = false;
  }
});

// Shared helpers
function postConfig(body) {
  return fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function saveSection(btnId, body, successMsg) {
  const btn = document.getElementById(btnId);
  btn.disabled = true;
  try {
    const res = await postConfig(body);
    if (!res.ok) throw new Error();
    await loadConfig();
    showToast(successMsg);
  } catch {
    showToast('Could not save — try again.', true);
  } finally {
    btn.disabled = false;
  }
}

loadConfig().catch(() => showToast('Could not reach the mirror.', true));
