#!/bin/bash
# Launch the mirror display in kiosk mode. Started at login by
# ~/.config/autostart/mirroros-kiosk.desktop (a copy of
# deploy/chromium-autostart.desktop).
# Mint and Debian name the binary `chromium`; older Ubuntu uses `chromium-browser`.

BROWSER=$(command -v chromium || command -v chromium-browser)
if [ -z "$BROWSER" ]; then
  echo "chromium not found — install it with: sudo apt install chromium" >&2
  exit 1
fi

# Hide the pointer even before the page's cursor:none applies (and over the
# desktop, if Chromium is ever not covering it). Optional: sudo apt install unclutter
if command -v unclutter >/dev/null 2>&1 && ! pgrep -x unclutter >/dev/null; then
  unclutter -idle 1 -root &
fi

# Wait for the Node server to answer before opening the window
for i in $(seq 1 30); do
  curl -sf http://localhost:3000/api/rev >/dev/null && break
  sleep 1
done

# --password-store=basic: with auto-login the GNOME keyring is never unlocked,
# so without this Chromium pops an "Unlock login keyring" dialog over the
# mirror on every boot.
# --force-device-scale-factor=1: style.css is laid out in exact 1920x1080 CSS
# pixels. If Cinnamon's UI scaling is ever set above 100%, Chromium would
# otherwise follow it and the right column would run off the panel.
exec "$BROWSER" \
  --kiosk \
  --no-first-run \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --hide-crash-restore-bubble \
  --password-store=basic \
  --force-device-scale-factor=1 \
  --disable-features=TranslateUI,InfiniteSessionRestore \
  --app=http://localhost:3000
