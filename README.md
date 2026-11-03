# MirrorOS

Smart mirror software for a two-way mirror. A Node/Express backend and a vanilla
HTML/CSS/JS frontend, with no build step and no database.

## The mirror

| | |
|---|---|
| **Computer** | Dell OptiPlex 3090 Micro |
| **OS** | Linux Mint 22.3 Cinnamon (X11 session). Logs in automatically with no password; sleep and the screensaver are off |
| **User / hostname** | `aadhav` on `Mirror1` |
| **Remote access** | SSH from the Mac: `ssh aadhav@10.133.84.60` |
| **Code** | `/home/aadhav/MirrorOS`, run by Node.js as the `mirroros` systemd service |
| **Keys** | `/home/aadhav/MirrorOS/.env`, readable only by `aadhav` |
| **Display** | 15.6" 1920×1080 panel, landscape, flush in the top-right corner of a 43" mirror |
| **Kiosk** | Chromium fullscreen, started at login by Cinnamon's autostart |

The clock is centred on the **mirror's** centre line, not the panel's, which is
why it sits at x=432 instead of x=960. If the panel or its mounting position ever
changes, recompute `--mirror-center-x` in `public/style.css` (the maths is in
`CLAUDE.md`).

## What's on the glass

- **Sleek**: the clock, with today's weather and the week forecast beside it on
  the same line.
- **Full**: weather and the week row at the top, then one column per person (name,
  commute, calendar), with now playing and a status line along the bottom. Both
  people's commutes always sit on the same line, however many events each has.
- **Sleep schedule**: either dims to a faint clock, or turns the panel fully off
  through X11 DPMS (`deploy/display-power.sh`). Talking to the mirror wakes it
  for two minutes.

Everything a person would change (names, weather city, commutes, layout, sleep)
is set from a phone at **http://10.133.84.60:3000/settings**.

## Quick start (development)

```bash
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:3000?dev` for a scaled-down view on a laptop. Set
`MOCK_CALENDAR=1` and `MOCK_COMMUTE=1` in `.env` to see the full layout without
credentials. Add `&layout=full`, `&spotify`, or `&stale=weather,calendar` to preview
those states (the full list is in `CLAUDE.md`).

## Setting up the mirror

The full walkthrough, written for this machine, is
**[docs/linux-setup.md](docs/linux-setup.md)**. In short:

```bash
# Backend, as a service that starts at boot and restarts if it crashes
sudo cp ~/MirrorOS/deploy/mirroros.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mirroros
```

```bash
# Chromium kiosk, opened by Cinnamon at login
mkdir -p ~/.config/autostart
cp ~/MirrorOS/deploy/chromium-autostart.desktop ~/.config/autostart/mirroros-kiosk.desktop
```

```bash
# Check that the screen can actually power off (it comes back with "on")
bash ~/MirrorOS/deploy/display-power.sh off
```

## Updating the mirror

From the phone, use **Settings → Update mirror**. It pulls the latest code,
restarts the server, and the kiosk reloads itself. Or over SSH:

```bash
cd ~/MirrorOS && git pull && sudo systemctl restart mirroros
```

## Environment variables

`.env` holds **keys and machine-level settings only**. Names, weather city, commute
addresses, departure times, layout and the sleep schedule are all edited on the
phone at `/settings` and stored in `server/config.json`. Don't add env vars for them.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `TZ` | `America/Chicago` | Timezone (set in OS env, not just .env). Node needs it at process start |
| `CALDAV_USERNAME` | (none) | Person 1's Apple ID |
| `CALDAV_PASSWORD` | (none) | Person 1's app-specific password |
| `CALDAV_USERNAME_B` | (none) | Person 2's Apple ID (blank = one-person mirror) |
| `CALDAV_PASSWORD_B` | (none) | Person 2's app-specific password |
| `GOOGLE_MAPS_API_KEY` | (none) | Commute + pollen (see docs/google-maps-setup.md) |
| `ANTHROPIC_API_KEY` | (none) | Voice assistant brain |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | (none) | Playback control (see docs/spotify-setup.md) |
| `MOCK_CALENDAR` / `MOCK_COMMUTE` | `0` | Serve fake data to preview the layout without credentials |
| `MIRROR_DISPLAY_DRYRUN` | `0` | Log screen on/off instead of doing it (for testing the sleep schedule) |

## Adding a data source

1. Create `server/sources/mySource.js` exporting `{ key, intervalMs, fetch }`
2. Add it to the `sources` array in `server/index.js`
3. Render it in `public/app.js` inside `fetchData()`

## Docs

| | |
|---|---|
| [docs/linux-setup.md](docs/linux-setup.md) | Setting up the OptiPlex from a fresh Mint install |
| [docs/voice-setup.md](docs/voice-setup.md) | Wake word, speech-to-text and text-to-speech |
| [docs/google-maps-setup.md](docs/google-maps-setup.md) | Commute and pollen API key, capped at $0 |
| [docs/spotify-setup.md](docs/spotify-setup.md) | Linking Spotify for now playing and voice control |
