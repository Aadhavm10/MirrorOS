const searchInput = document.getElementById('city-search');
const resultsEl = document.getElementById('city-results');
const toastEl = document.getElementById('toast');

async function loadConfig() {
  const res = await fetch('/api/config');
  const cfg = await res.json();
  document.getElementById('current-city').textContent = cfg.weather.city;
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

loadConfig().catch(() => showToast('Could not reach the mirror.', true));
