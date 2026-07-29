// MirrorOS voice assistant brain: Claude Haiku 4.5 + tools.
// Text in → spoken-style text out. The voice pipeline (wake word / STT / TTS)
// lives outside this file and just calls ask(); POST /api/assistant for tests.
// Provider/model is a constant so swapping to claude-sonnet-5 later is one line.

const Anthropic = require('@anthropic-ai/sdk');
const { betaTool } = require('@anthropic-ai/sdk/helpers/beta/json-schema');
const cache = require('./cache');
const config = require('./config');
const calendar = require('./sources/calendar');
const spotify = require('./spotify');

const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 1000;
const HISTORY_TTL_MS = 5 * 60 * 1000; // follow-ups within 5 min share context
const MAX_HISTORY_MESSAGES = 12;

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const SYSTEM_PROMPT = `You are the voice assistant for MirrorOS, a smart mirror in the user's home.
Your replies are spoken aloud by a text-to-speech engine, so:
- Answer in 1-3 short sentences of plain prose. No markdown, no lists, no emoji, no headings.
- Say numbers and times the way a person would say them out loud.
- Get to the point immediately; skip preamble like "Sure!" or "Great question".

Tools:
- get_mirror_data: current weather, week forecast, pollen, commute times, and upcoming calendar events already on the mirror. Prefer this over web search for anything it covers.
- create_event: add an event to the user's iCloud calendar (it syncs to their iPhone). After creating, confirm briefly what was added and when. The user's timezone is ${process.env.TZ || 'America/Chicago'} — pass startISO with the correct UTC offset for that timezone.
- web_search: for current facts, news, or anything beyond the mirror's data.
- spotify_control / spotify_now_playing: music playback. "Play X" means search Spotify and play it. If Spotify reports no device is available, tell the user to open Spotify somewhere first.

If a request is ambiguous about date or time, make the natural assumption (e.g. "Thursday" means the upcoming Thursday) rather than asking, and state the assumption in your confirmation.`;

const getMirrorData = betaTool({
  name: 'get_mirror_data',
  description:
    "Read the mirror's current data: weather (today + 7-day forecast + city), pollen levels, commute times, and the next calendar events. Also returns the user's configured commute settings.",
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  run: async () => JSON.stringify({ ...cache.getAll(), config: config.get() }),
});

const createEvent = betaTool({
  name: 'create_event',
  description:
    "Create an event on the user's iCloud calendar. Use an ISO 8601 startISO with an explicit UTC offset matching the user's timezone (e.g. 2026-07-30T15:00:00-05:00).",
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Event title' },
      startISO: { type: 'string', description: 'Start date-time, ISO 8601 with UTC offset' },
      durationMinutes: { type: 'integer', description: 'Duration in minutes (default 60)' },
      isAllDay: { type: 'boolean', description: 'True for all-day events' },
    },
    required: ['title', 'startISO'],
    additionalProperties: false,
  },
  run: async ({ title, startISO, durationMinutes = 60, isAllDay = false }) => {
    const result = await calendar.createEvent({ title, startISO, durationMinutes, isAllDay });
    return `Created "${title}" (uid ${result.uid}) on calendar ${result.calendar}.`;
  },
});

const NOT_CONNECTED =
  "Spotify isn't connected yet — open http://127.0.0.1:3000/spotify/login in a browser to link the account.";

const spotifyControl = betaTool({
  name: 'spotify_control',
  description:
    'Control Spotify playback on the user\'s active device. Use action "play" with a query to search and play a track, album, playlist, or artist; "play" without a query resumes; "pause", "next", "previous", or "volume" (with volume 0-100) do what they say.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['play', 'pause', 'next', 'previous', 'volume'] },
      query: { type: 'string', description: 'What to search for (play only)' },
      itemType: { type: 'string', enum: ['track', 'album', 'playlist', 'artist'] },
      volume: { type: 'integer', description: '0-100 (volume action only)' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  run: async (input) => {
    if (!spotify.isConnected()) return NOT_CONNECTED;
    return spotify.control(input);
  },
});

const spotifyNowPlaying = betaTool({
  name: 'spotify_now_playing',
  description: 'What is currently playing on Spotify, if anything.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  run: async () => {
    if (!spotify.isConnected()) return NOT_CONNECTED;
    return spotify.nowPlaying();
  },
});

const WEB_SEARCH = { type: 'web_search_20250305', name: 'web_search', max_uses: 3 };

let history = [];
let lastAskAt = 0;

async function ask(text) {
  if (Date.now() - lastAskAt > HISTORY_TTL_MS) history = [];
  lastAskAt = Date.now();

  // Timestamp rides in the user turn (after the cached prefix), never in system
  history.push({
    role: 'user',
    content: `[Current date and time: ${new Date().toString()}]\n${text}`,
  });
  if (history.length > MAX_HISTORY_MESSAGES) history = history.slice(-MAX_HISTORY_MESSAGES);

  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: [getMirrorData, createEvent, spotifyControl, spotifyNowPlaying, WEB_SEARCH],
    messages: history,
    max_iterations: 8,
  });

  let final = null;
  for await (const message of runner) {
    // Server-side web search can pause mid-turn; push the partial turn back to resume
    if (message.stop_reason === 'pause_turn') {
      runner.pushMessages({ role: 'assistant', content: message.content });
    }
    final = message;
  }

  const reply = (final?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join(' ')
    .trim();

  // Keep only plain text in history so no dangling tool_use blocks remain
  history.push({ role: 'assistant', content: reply || '(no reply)' });
  return reply || "Sorry, I didn't get an answer for that.";
}

module.exports = { ask };
