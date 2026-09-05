# MirrorOS

Custom smart mirror software for a Surface Pro 4 mounted behind two-way mirror glass.
Display is a **15.6" 1920×1080 panel, landscape**, mounted **flush into the top-right corner**
of a mirror the size of a 43" TV.

### Mounting geometry (don't hand-wave this)
| | |
|---|---|
| Mirror, 43" 16:9 portrait | 21.081 in wide (43 × 16 ÷ √(16²+9²)) |
| Monitor, 15.6" 16:9 | 13.597 in wide → **141.21 px/in** at 1920px |
| Monitor's left edge, from mirror's left | 21.081 − 13.597 = 7.485 in |
| Mirror's centre line | 21.081 ÷ 2 = 10.541 in, i.e. 3.056 in right of the monitor's left edge |
| **→ `--mirror-center-x`** | 3.056 × 141.21 = **432px** |

The clock is centred on the **mirror's** axis, not the panel's — that's why it sits at x=432
rather than 960. `#clock-section` is a box from x=0, `calc(var(--mirror-center-x) * 2)` wide,
with centred text, so clock/day/date all land on that axis. **Recompute `--mirror-center-x`
in `public/style.css` if the mirror size or mounting position changes.**

The clock's ink cannot exceed 2 × 432 = 864px or it runs off the left edge; 300px font is
near that ceiling (≈726px wide, spanning x=69..795).

`#info-column` (x = 980..1880, 900px) holds weather (with pollen as a one-line footnote), the
week row, `#people-row`, now playing and the health line. It was widened from 600px for the
two-person layout: the clock's box ends at x=864 (`2 * --mirror-center-x`), so x=980 keeps a
116px gutter and reclaims space that was previously dead.

**Two people share the mirror.** `#people-row` is a two-column grid, one `.person-column` per
person, each holding that person's name, calendar and commute. Everything else (weather, week,
now playing, health) is shared and full-width. Both are keyed by slot — `'a'` and `'b'` — end
to end: `config.people.{a,b}`, `/api/data`'s `calendar.{a,b}` and `commute.{a,b}`, and
`.person-column[data-slot]` on the glass. A column with neither calendar nor commute gets
`.empty` from `renderPeople()` and collapses, leaving the other at full width.
Slot `a` uses the unsuffixed `CALDAV_*` credentials, slot `b` the `_B` pair — those two pairs
are the *only* per-person thing in `.env`. Names, addresses and departure times are set on the
/settings page. Don't add env seeds for them: `.env` is keys and machine-level settings only,
and a second source of truth for a preference is how they drift apart. Icons are inline SVG in the `ICONS` map in `public/app.js` — no icon files, no
build step. `server/sources/weather.js` maps WMO codes to icon names and returns `icon` on the
current conditions and each week day.

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

**Long-run rules — this thing runs for months untouched, so failures have to be loud
and bounded, never silent and accumulating:**
- Every outbound request goes through `fetchWithTimeout()` in `server/http.js`. Node's fetch
  will sit on a stalled response for ~5 minutes, which is longer than some poll intervals.
  Never call `globalThis.fetch` directly from a source.
- The poller skips a tick if that source's previous fetch hasn't settled, so a slow source
  can't stack runs on a bad network.
- A source that partially fails returns what it got; a source where *everything* failed must
  throw. Returning an empty result caches it as fresh and marks the source healthy — that's
  how the calendar silently showed nothing for days after a CalDAV session expired.
- `index.js` installs `unhandledRejection`/`uncaughtException` handlers that log and keep
  running. A degraded mirror beats a dead one when the supervisor's restart budget is finite.
- The kiosk reloads itself at 04:00 (skipped under `?dev`) to reset a renderer that's been up
  for weeks.

### API
`GET /api/data` → all cached data as
`{ weather: {...}, calendar: { a: [...], b: [...] }, commute: { a, b }, settings, health }`.
`settings.people` carries only the two names — commute addresses stay out of the display
payload and are read from `/api/config` by the settings page.
API keys live in `.env`, never reach the browser.

`GET /api/rev` → `{ rev, boot }`. `boot` is a random id minted at process start; when the
mirror sees it change it does a full `location.reload()` rather than just re-fetching, because
a restart usually means new `app.js`/`style.css` on disk and bumping `rev` alone would keep the
old frontend running against new data. That's also what makes a git pull land on the glass
without anyone restarting the kiosk by hand.

`POST /api/update` → runs `git pull --ff-only` and restarts (see `server/update.js`). Refuses
on a dirty working tree, takes no branch/remote from the request, and runs `npm install` only
when `package.json`/`package-lock.json` moved. It exits **non-zero** on purpose: systemd's
`Restart=always` doesn't care, but Windows Task Scheduler only restarts a task it considers
failed, so a clean `exit(0)` there would leave the mirror dark. Triggered by the "Update
mirror" card on /settings.

`rev` is a counter bumped on every config change. The mirror polls it
every 2s and only fetches `/api/data` when the number moves, so a save on the phone lands on
the glass in ~1–2s instead of waiting out the 60s data poll — without paying for a full
payload and re-render every 2s. `POST /api/config` bumps it **twice**: once synchronously
(layout mode and sleep need no network fetch, so they shouldn't queue behind a slow commute
call) and again when `refreshAll()` resolves (city/commute only look different once
their source data has actually been replaced). The counter is in memory, so a server restart
resets it to 0 — which reads as a change and makes the mirror recover on its own. All three
config/data endpoints send `Cache-Control: no-store`; a cached `/api/rev` would defeat the
whole mechanism.

### Config (phone-editable settings)
`server/config.js` persists preferences to `server/config.json` (gitignored).
Secrets stay in `.env`; config.json is only for harmless preferences (weather city, each
person's name and commute, layout, sleep schedule). The split is strict in both directions —
`.env` holds keys plus `PORT`/`TZ` and nothing else, so there is exactly one place to change
any given setting.
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
`GET /api/spotify/now-playing` → `{connected, playing}` — structured track for the mirror's
NOW PLAYING section, polled by the frontend every 10s (not a cached source: a track that
changed two minutes ago is worse than showing nothing). Returns `connected: false` without
calling Spotify until the account is linked at `/spotify/login`. `spotify.nowPlayingData()` is
the structured form; `spotify.nowPlaying()` wraps it as a sentence for the assistant.
Voice indicator: daemon POSTs `/api/voice/state {state, text}` (idle|listening|thinking|speaking);
frontend polls it every 1s and renders `#voice-section`. State older than 20s is treated as idle,
so a crashed daemon can't leave text stuck on the glass.
Short in-memory conversation history (5-min TTL). The voice pipeline (wake word/STT/TTS in `voice/`)
is a separate client of this endpoint — keep the brain and the audio layer decoupled.

### Display power (`server/display.js`)
`display.sleep.mode` is `'dim'` (default, CSS only — current behaviour byte-for-byte) or
`'off'` (panel genuinely powers down). A 30s tick compares the desired state to the last one
it set and only shells out on a change. **One of only two places the server shells out**
(`server/update.js` is the other) — every
command is `execFile` with a timeout and swallowed errors, matching the never-crash contract
in `poller.js`. Windows goes through `deploy/display-power.ps1`; macOS uses `pmset`/`caffeinate`
so the schedule is testable on the dev machine; other platforms warn once and no-op.
`MIRROR_DISPLAY_DRYRUN=1` logs instead of acting.
Voice activity (any `/api/voice/state` POST, including `idle`) wakes the panel and holds it
awake 2 min from the end of the exchange.
`inSleepWindow()` is deliberately duplicated here and in `public/app.js` — sharing needs a
module loadable by both the browser (no build step) and `require()`, and making the server
authoritative would delay the visual dim from 1s to the 60s poll. Change one, change the other.

### Frontend
- Clock ticks every 1s via `setInterval` + `new Date()` (no server needed)
- **All times on the glass are 12-hour.** `zonedNow()` keeps its `hour` field 0–23 because
  `inSleepWindow()` and the time-of-day modes do arithmetic on it — only the display string is
  converted. `fmtHHMM12()` does the same for the `"HH:MM"` strings config stores.
- `/api/data` polled every 60s, results rendered by widget-specific functions in `public/app.js`
- Time-of-day mode set as a class on `<body>`: `mode-morning`, `mode-day`, `mode-evening`, `mode-night`

## Display rules (non-negotiable)
- Background: `#000000` — never dark gray
- Text: `#ffffff` or `#d0d0d0` only — no color
- Font weight: 500 minimum — thin weights vanish through mirror glass
- NO animations, transitions, or scrolling anywhere (the voice orb's breathing pulse is the one
  deliberate exception, and it only runs while the orb is on screen)
- `cursor: none` on everything
- **No divider rules** — section labels and spacing carry the structure, nothing else
- Empty sections collapse via `#info-column > section:empty` and `.person-column > section:empty`.
  Keep those selectors to direct
  `section` children: a descendant `:empty` also matches `<path>`/`<circle>` inside the icons
  and hides every icon, and `#health-line` must keep its slot so a stale warning can never be
  pushed off the bottom edge
- The info column fills the panel height almost exactly. Adding a section means taking space
  from another one — check the worst case with `?layout=full&stale=weather,calendar,commute,pollen`

## Time-of-day modes
| Mode | Hours | Show |
|------|-------|------|
| morning | 5–10 | weather + pollen + commute + today's calendar events |
| day | 10–18 | weather + pollen + commute + next calendar event |
| evening | 18–23 | weather + pollen + commute + tomorrow's first event |
| night | 23–5 | dim clock only |

Commute data freshness: 10 min during morning (5–10), 20 min rest of day, cache-only overnight.
Two people × two lookups = 4 requests per refresh, so ~276/day — narrowing either window puts
it back over the Routes API's 300/day cap.

## Build phases
- [x] Phase 1: Server + clock
- [x] Phase 2: Weather (Open-Meteo, no API key, Richardson TX)
- [x] Phase 3: Calendar (iCloud CalDAV via `tsdav`, two accounts, read + write)
- [x] Phase 4: Time-of-day mode switching (CSS visibility)

## Dev mode
```bash
cp .env.example .env
npm install
npm run dev
# open http://localhost:3000?dev  (scales 1920x1080 to fit laptop)
```

Preview params (all require a query string, so none can reach the kiosk):
`?dev` scaled panel · `?layout=full|sleek` · `?sleep` · `?voice=listening|thinking|speaking` ·
`?stale=weather,calendar,…` · `?no-motion` · `?spotify` sample now-playing track (the account is
only linked at handoff, so this is the only way to check that section) ·
`?center` hairline on the mirror's centre line ·
**`?mirror`** draws the whole mirror around the panel with its true centre line — this is how
you verify the clock is centred on the *mirror* rather than the screen.

## Future additions (keep source layer modular for these)
- Voice assistant: openWakeWord + whisper.cpp + Piper (x86 native)
- Home Assistant integration
- Calendar event creation (CalDAV write support)
