#!/bin/bash
# Wait for the Node server to be ready
sleep 5

chromium-browser \
  --kiosk \
  --no-first-run \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --hide-crash-restore-bubble \
  --disable-features=TranslateUI,InfiniteSessionRestore \
  --app=http://localhost:3000
