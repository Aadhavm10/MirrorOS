@echo off
REM Launches the mirror display in Edge kiosk mode.
REM Waits for the server to actually answer instead of guessing a timeout —
REM on a cold boot the Node service can take a while to come up.

set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" (
  echo Microsoft Edge not found. Install it, or edit EDGE in this script. 1>&2
  exit /b 1
)

REM Poll /api/data for up to 60s
for /l %%i in (1,1,30) do (
  curl -s -f -o nul http://localhost:3000/api/data && goto :launch
  timeout /t 2 /nobreak >nul
)
echo Server did not answer on http://localhost:3000 — starting Edge anyway. 1>&2

:launch
start "" "%EDGE%" ^
  --kiosk ^
  --edge-kiosk-type=fullscreen ^
  --no-first-run ^
  --noerrdialogs ^
  --disable-session-crashed-bubble ^
  --hide-crash-restore-bubble ^
  --disable-features=TranslateUI,msEdgeSplitScreen ^
  --disable-pinch ^
  --overscroll-history-navigation=0 ^
  http://localhost:3000
