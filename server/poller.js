const cache = require('./cache');

async function runSource(source) {
  try {
    const data = await source.fetch();
    cache.set(source.key, data);
  } catch (err) {
    console.error(`[poller] ${source.key} failed:`, err.message);
  }
}

let registered = [];

function startPolling(sources) {
  registered = sources;
  for (const source of sources) {
    runSource(source);
    setInterval(() => runSource(source), source.intervalMs);
  }
}

// Re-fetch every source immediately (used after a settings change).
async function refreshAll() {
  await Promise.all(registered.map(runSource));
}

module.exports = { startPolling, refreshAll };
