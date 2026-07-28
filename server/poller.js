const cache = require('./cache');

async function runSource(source) {
  try {
    const data = await source.fetch();
    cache.set(source.key, data);
  } catch (err) {
    console.error(`[poller] ${source.key} failed:`, err.message);
  }
}

function startPolling(sources) {
  for (const source of sources) {
    runSource(source);
    setInterval(() => runSource(source), source.intervalMs);
  }
}

module.exports = { startPolling };
