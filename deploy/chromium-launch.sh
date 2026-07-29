#!/bin/bash
# Launch the mirror display in kiosk mode.
# Debian names the binary `chromium`; Ubuntu/Raspbian use `chromium-browser`.

BROWSER=$(command -v chromium || command -v chromium-browser)
if [ -z "$BROWSER" ]; then
  echo "chromium not found — install it with: sudo apt install chromium" >&2
  exit 1
fi

# Wait for the Node server to answer before opening the window
for i in $(seq 1 30); do
  curl -sf http://localhost:3000/api/data >/dev/null && break
  sleep 1
done

"$BROWSER" \
  --kiosk \
  --no-first-run \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --hide-crash-restore-bubble \
  --disable-features=TranslateUI,InfiniteSessionRestore \
  --app=http://localhost:3000
