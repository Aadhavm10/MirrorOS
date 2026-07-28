@echo off
timeout /t 8 /nobreak >nul
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --kiosk ^
  --no-first-run ^
  --noerrdialogs ^
  --disable-infobars ^
  --disable-session-crashed-bubble ^
  --hide-crash-restore-bubble ^
  --disable-features=TranslateUI ^
  http://localhost:3000
