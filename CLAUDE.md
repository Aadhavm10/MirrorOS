# MirrorOS

Custom smart mirror software for a Surface Pro 4 mounted behind two-way mirror glass.
Display is a 43" 1080p panel in **portrait orientation: 1080×1920**.
Content renders in an **816px-wide centered column** (lululemon Mirror body
proportions, 22.4"×52.7"); the panel outside the column stays pure black.

## Stack
- **Backend**: Node.js + Express, `server/index.js` entry point
- **Frontend**: Vanilla HTML/CSS/JS in `public/`, no build step
- **Data**: In-memory cache only, no database

## Architecture

### Data source pattern
Every data source is a file in `server/sources/` that exports:
```js
{ key: string, intervalMs: number, fetch: async () => data }
```
Register it by adding it to the `sources` array in `server/index.js`.
`server/poller.js` calls `fetch()` on each timer and stores results in `server/cache.js`.
On error: logs to console, leaves last good value in cache. Never crashes the server.

### API
Single endpoint: `GET /api/data` → returns all cached data as `{ weather: {...}, calendar: [...], ... }`
API keys live in `.env`, never reach the browser.

### Config (phone-editable settings)
`server/config.js` persists preferences to `server/config.json` (gitignored).
Secrets stay in `.env`; config.json is only for harmless preferences (weather city, future commute origin, etc.).
- `GET /api/config` / `POST /api/config` — read/update; POST triggers an immediate re-fetch of all sources
- `GET /api/geocode?q=City` — Open-Meteo geocoding proxy for the settings page
- `/settings` — phone-friendly settings page (`public/settings.{html,css,js}`).
  Normal UI rules apply there, NOT the mirror display rules. iOS "Add to Home Screen" makes it app-like
  (`public/manifest.json` + `public/icons/`).
New phone-editable preferences should be added as fields in `server/config.js` defaults + validation, then a card on the settings page.

### Assistant (voice brain)
`server/assistant.js` — Claude Haiku 4.5 (`claude-haiku-4-5`) via `@anthropic-ai/sdk` tool runner.
Tools: `get_mirror_data` (cache + config), `create_event` (CalDAV write), `spotify_control` /
`spotify_now_playing` (`server/spotify.js`, OAuth via `/spotify/login`, Premium required,
see docs/spotify-setup.md), and server-side web search.
`POST /api/assistant {text}` → `{reply}` — spoken-style prose for TTS. Needs `ANTHROPIC_API_KEY` in `.env`.
Voice indicator: daemon POSTs `/api/voice/state {state, text}` (idle|listening|thinking|speaking);
frontend polls it every 1s and renders `#voice-section`. State older than 20s is treated as idle,
so a crashed daemon can't leave text stuck on the glass.
Short in-memory conversation history (5-min TTL). The voice pipeline (wake word/STT/TTS in `voice/`)
is a separate client of this endpoint — keep the brain and the audio layer decoupled.

### Frontend
- Clock ticks every 1s via `setInterval` + `new Date()` (no server needed)
- `/api/data` polled every 60s, results rendered by widget-specific functions in `public/app.js`
- Time-of-day mode set as a class on `<body>`: `mode-morning`, `mode-day`, `mode-evening`, `mode-night`

## Display rules (non-negotiable)
- Background: `#000000` — never dark gray
- Text: `#ffffff` or `#d0d0d0` only — no color
- Font weight: 500 minimum — thin weights vanish through mirror glass
- NO animations, transitions, or scrolling anywhere
- `cursor: none` on everything
- All content lives in `#top-third` (960px tall — the top half; name is historical) — bottom of screen stays pure black

## Time-of-day modes
| Mode | Hours | Show |
|------|-------|------|
| morning | 5–10 | weather + pollen + commute + today's calendar events |
| day | 10–18 | weather + pollen + commute + next calendar event |
| evening | 18–23 | weather + pollen + commute + tomorrow's first event |
| night | 23–5 | dim clock only |

Commute data freshness: 5 min during morning (5–10), 20 min rest of day, cache-only overnight — keeps Routes API under its 300/day cap.

## Build phases
- [x] Phase 1: Server + clock
- [x] Phase 2: Weather (Open-Meteo, no API key, Richardson TX)
- [ ] Phase 3: Calendar (iCloud CalDAV via `tsdav`)
- [x] Phase 4: Time-of-day mode switching (CSS visibility)

## Dev mode
```bash
cp .env.example .env
npm install
npm run dev
# open http://localhost:3000?dev  (scales 1080x1920 to fit laptop)
```

## Future additions (keep source layer modular for these)
- Voice assistant: openWakeWord + whisper.cpp + Piper (x86 native)
- Home Assistant integration
- Calendar event creation (CalDAV write support)
