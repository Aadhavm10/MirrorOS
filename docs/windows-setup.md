# Windows Setup — Surface Pro 4 Smart Mirror (Fallback OS)

Use this if Linux hardware support fights you. Windows is already on the Surface,
so this path skips OS installation entirely.

---

## 1. Debloat and stabilize Windows

The mirror must survive unattended for months. Kill everything that can pop a dialog
over the kiosk:

1. **Windows Update active hours**: Settings → Windows Update → Advanced options →
   set active hours to cover the display's on-time. Better: pause updates or use
   Group Policy (`gpedit.msc`) → Computer Configuration → Administrative Templates →
   Windows Update → "Configure Automatic Updates" → **2 - Notify before download**
   so updates never auto-reboot.
2. **Disable notifications**: Settings → System → Notifications → off. Enable
   **Do Not Disturb** permanently.
3. **Disable OneDrive popups**: uninstall OneDrive if unused.
4. **Never sleep**: Settings → System → Power → Screen and sleep → Never (all).
   Since the battery is removed, also check "what happens when power is restored"
   in UEFI (see §6).
5. **Disable lock screen**: `netplwiz` → uncheck "Users must enter a user name and
   password" for auto-login (or use Group Policy on Pro).
6. **Disable Windows Hello / sign-in prompts** for the mirror user.

---

## 2. Display: portrait rotation

Settings → System → Display → Display orientation → **Portrait** (or Portrait
flipped, depending on your panel mount). Resolution: 1080×1920.

If the external display isn't primary: Settings → Display → select the TV panel →
"Make this my main display", and set the cracked internal screen to
"Show only on 2" (external) so nothing renders to the broken panel.

---

## 3. Install Node.js

Download the LTS `.msi` from https://nodejs.org and install with defaults.
Verify in PowerShell:

```powershell
node --version
```

---

## 4. Deploy MirrorOS

```powershell
cd C:\Users\<you>
git clone https://github.com/Aadhavm10/MirrorOS.git
cd MirrorOS
npm install
copy .env.example .env
notepad .env   # fill in CALDAV credentials when ready
```

> The deploy scripts assume `C:\Users\mirror\MirrorOS`. If your user or path
> differs, edit `deploy\start-mirror.bat` and `deploy\chromium-launch.bat`
> to match.

---

## 5. Task Scheduler autostart

Open **Task Scheduler** (`taskschd.msc`). Create two tasks:

### Task 1 — MirrorOS backend

- General: Name `MirrorOS Server`. Check **Run with highest privileges**.
  "Run only when user is logged on" (needed for console; the server is per-user).
- Triggers: **At log on** of the mirror user.
- Actions: Start a program → `C:\Users\mirror\MirrorOS\deploy\start-mirror.bat`
- Settings:
  - ✅ "If the task fails, restart every **1 minute**", attempts: **999**
  - ❌ Uncheck "Stop the task if it runs longer than"
  - ✅ "If the running task does not end when requested, force it to stop"

### Task 2 — Chromium kiosk

- General: Name `MirrorOS Kiosk`.
- Triggers: **At log on**, delay task for **15 seconds** (gives Node time to bind).
- Actions: Start a program → `C:\Users\mirror\MirrorOS\deploy\chromium-launch.bat`
  (the script itself also waits 8s and passes the crash-restore-suppression flags)
- Settings: same restart-on-failure settings as Task 1.

> `chromium-launch.bat` points at Chrome's default install path. If you use
> Chromium/Edge instead, edit the path in the script. Edge (preinstalled) also
> works with the same flags: `msedge.exe --kiosk http://localhost:3000 ...`

Combined with auto-login (§1.5), a power cycle now boots straight into the mirror.

---

## 6. Power loss recovery

1. Reboot into UEFI: hold **Volume Up + Power**.
2. Find **Power** settings → enable automatic power-on when AC is restored
   (on Surface firmware this may appear as "Enable Battery Limit"-adjacent
   options; if there is no AC-power-on option, the Surface usually boots when
   power is applied with no battery installed — test by pulling the plug).
3. Verify the full chain: pull power → restore → within ~2 minutes you should
   see the mirror UI with no dialogs, no cursor, no update prompts.

---

## 7. Audio

Right-click the speaker icon → Sound settings → Output → select the HDMI device
(the TV mainboard). Test with any audio. Set volume once; it persists.

---

## 8. Remote updates over SSH

Windows 10/11 ships an OpenSSH server:

```powershell
# Run as Administrator, once:
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic
```

Then from your laptop:

```bash
ssh mirror@<mirror-ip>
cd MirrorOS
git pull
npm install    # only if package.json changed
# Restart the server task:
schtasks /End /TN "MirrorOS Server" & schtasks /Run /TN "MirrorOS Server"
```

The browser refreshes its data on the next 60s poll; for frontend file changes,
restart the kiosk task the same way:

```powershell
schtasks /End /TN "MirrorOS Kiosk"
schtasks /Run /TN "MirrorOS Kiosk"
```
