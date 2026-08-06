# MirrorOS

Custom smart mirror software for a Surface Pro 4 behind two-way mirror glass.
Node/Express backend + vanilla HTML/CSS/JS frontend. No build step.

## Quick start

```bash
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:3000` (size browser to 1920×1080), or `http://localhost:3000?dev` for a scaled-down view on a laptop screen.

## Deploy (Linux)

```bash
# 1. Copy project to the mirror machine
git pull

# 2. Install Node backend as a systemd service
sudo cp deploy/mirroros.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable mirroros
sudo systemctl start mirroros

# 3. Autostart Chromium on login
cp deploy/chromium-autostart.desktop ~/.config/autostart/
chmod +x deploy/chromium-launch.sh
```

## Deploy (Windows)

1. Create a Task Scheduler task: trigger = At log on, action = run `deploy\start-mirror.bat`
2. Create a second task: trigger = At log on (30s delay), action = run `deploy\chromium-launch.bat`

## Adding a new data source (Phase 2+)

1. Create `server/sources/mySource.js` exporting `{ key, intervalMs, fetch }`
2. Uncomment/add it to the `sources` array in `server/index.js`
3. Render it in `public/app.js` inside `fetchData()`

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `TZ` | `America/Chicago` | Timezone (set in OS env, not just .env) |
| `CALDAV_USERNAME` | — | Apple ID (Phase 3) |
| `CALDAV_PASSWORD` | — | App-specific password (Phase 3) |
