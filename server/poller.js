const cache = require('./cache');

// Sources whose fetch hasn't settled yet. Without this a slow source gets a
// second run started on top of the first every interval, and on a bad network
// they stack up for as long as the mirror is left alone — which is weeks.
const inFlight = new Set();

async function runSource(source) {
  if (inFlight.has(source.key)) {
    console.warn(`[poller] ${source.key} still running — skipping this tick`);
    return;
  }
  inFlight.add(source.key);
  try {
    const data = await source.fetch();
    cache.set(source.key, data);
  } catch (err) {
    cache.fail(source.key, err.message);
    console.error(`[poller] ${source.key} failed:`, err.message);
  } finally {
    inFlight.delete(source.key);
  }
}

let registered = [];

function startPolling(sources) {
  registered = sources;
  for (const source of sources) {
    cache.register(source.key, source.intervalMs);
    runSource(source);
    setInterval(() => runSource(source), source.intervalMs);
  }
}

// Re-fetch every source immediately (used after a settings change).
async function refreshAll() {
  await Promise.all(registered.map(runSource));
}

module.exports = { startPolling, refreshAll };
