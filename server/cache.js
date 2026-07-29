// In-memory store for source data, plus enough bookkeeping to tell the
// frontend when a value is stale. A headless mirror has nobody watching the
// console, so "last good value forever" must be visible on the glass.

const store = new Map();   // key -> value (last good)
const meta = new Map();    // key -> { at, intervalMs, failures, lastError }

function metaFor(key) {
  if (!meta.has(key)) {
    meta.set(key, { at: 0, intervalMs: 0, failures: 0, lastError: null });
  }
  return meta.get(key);
}

module.exports = {
  set(key, value) {
    store.set(key, value);
    const m = metaFor(key);
    m.at = Date.now();
    m.failures = 0;
    m.lastError = null;
  },

  get(key) {
    return store.get(key);
  },

  getAll() {
    return Object.fromEntries(store);
  },

  // Poller tells us how often each source is supposed to refresh, so
  // staleness can be judged relative to that source's own cadence.
  register(key, intervalMs) {
    metaFor(key).intervalMs = intervalMs;
  },

  fail(key, message) {
    const m = metaFor(key);
    m.failures += 1;
    m.lastError = message;
  },

  // A source counts as stale once it has missed a few polls in a row.
  // A source that has NEVER succeeded is treated as unconfigured, not broken —
  // otherwise an install without a Google key nags about commute forever.
  health() {
    const now = Date.now();
    const out = {};
    for (const [key, m] of meta) {
      const configured = m.at > 0;
      const maxAge = (m.intervalMs || 5 * 60 * 1000) * 3;
      out[key] = {
        configured,
        ageMs: configured ? now - m.at : null,
        stale: configured && now - m.at > maxAge,
        failures: m.failures,
      };
    }
    return out;
  },
};
