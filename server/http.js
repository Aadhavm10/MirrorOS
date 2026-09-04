// One place to make an outbound request, so every call has a deadline.
//
// Node's fetch has no overall request timeout — undici only gives up after
// ~5 minutes of a stalled response. The mirror polls some sources every 5
// minutes, so a flaky connection could leave one request still hanging when
// the next fires, and they pile up. Over the days this thing runs untouched
// between reboots, that's the difference between "the wifi blipped" and "the
// mirror stopped updating and nobody knows why".
//
// 15s is far longer than any of these APIs need and short enough that a
// stalled request is always resolved before the next poll.

const DEFAULT_TIMEOUT_MS = 15000;

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  try {
    return await globalThis.fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // A timeout surfaces as a bare "This operation was aborted", which says
    // nothing about which call gave up or for how long.
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`request timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
}

module.exports = { fetchWithTimeout, DEFAULT_TIMEOUT_MS };
