# Windows Setup — Surface Pro 4 Smart Mirror

Complete walkthrough for turning a Surface Pro 4 running factory Windows into
the mirror: the Node backend, Edge in kiosk mode, scheduled screen power, and
everything starting automatically on boot and after a power cut.

**Target hardware:** Surface Pro 4, external 15.6" 1920×1080 panel mounted
landscape in the mirror's top-right corner, connected over Mini DisplayPort → HDMI.

**Time:** about an hour. You can stop after any numbered section.

> Windows is the fastest path and the one this guide assumes. `docs/linux-setup.md`
> covers Debian instead — more reliable for a machine that sits untouched for
> months, but it's a 2–3 hour install including a kernel build.

**A few conventions:**

- **PowerShell (Admin)** means: right-click Start → *Terminal (Admin)* or
  *Windows PowerShell (Admin)*. Several steps fail silently without it.
- Commands are meant to be copied exactly. Where something differs per machine,
  it says so.

---

## 1. Windows first-run and debloat

Get through OOBE with a **local account** if you can — Microsoft accounts pull in
OneDrive prompts and sync dialogs that can surface over the kiosk. At the
"Sign in with Microsoft" screen, choose *Sign-in options* → *Offline account* →
*Limited experience*. Name the user `mirror`.

Then, PowerShell (Admin):

```powershell
# Stop Windows rebooting itself at random hours
Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings' `
  -Name 'ActiveHoursStart' -Value 0 -Type DWord -Force
Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings' `
  -Name 'ActiveHoursEnd' -Value 23 -Type DWord -Force
```

Then in Settings:

- **Personalization → Lock screen** → Screen saver → *(None)*
- **Personalization → Background** → Solid colour → black
- **System → Notifications** → Off (a toast over the kiosk ruins the illusion)
- **Privacy → General** → turn off suggested content
- **Accounts → Sign-in options** → *Never* require sign-in on wake

---

## 2. Power settings (do not skip)

This section is what makes the mirror survive being unplugged.

**Settings → System → Power & battery → Screen and sleep** — set **all four**
dropdowns to **Never**. MirrorOS drives screen blanking itself (§8); Windows'
idle timer must stay out of it.

Then, PowerShell (Admin):

```powershell
# Disable Fast Startup. Without this, "shutdown" is really a hibernate, which
# breaks both power-on-after-AC-restore and "At log on" task triggers.
powercfg /h off

# Never sleep the machine itself, on battery or plugged in
powercfg /change standby-timeout-ac 0
powercfg /change standby-timeout-dc 0
powercfg /change monitor-timeout-ac 0
powercfg /change monitor-timeout-dc 0

# Closing the lid must not suspend anything
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setdcvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0

# USB selective suspend off — it can drop the USB mic
powercfg /setacvalueindex SCHEME_CURRENT SUB_USB USBSELECTIVESUSPEND 0
powercfg /setactive SCHEME_CURRENT
```

The Surface's own battery acts as a UPS, so a brief outage won't even interrupt
it. For a longer one, see §9.

---

## 3. The display

The Surface's internal screen is usually cracked or unwanted on a mirror build,
and it must not be the primary display.

1. Plug in the external panel.
2. **Settings → System → Display** → select the **external** panel → check
   *Make this my main display*.
3. In the multi-display dropdown, choose **Show only on 2** (the external one).

This is also what makes §8 work: with the internal panel disabled, the
screen-power broadcast lands on the external panel, which is the one you care about.

4. With the external panel selected, confirm **Display resolution** is
   **1920 × 1080** and **Display orientation** is **Landscape**.

The CSS is sized to 1920×1080 exactly. Any other resolution and the layout will
look wrong — see `CLAUDE.md` for the mounting geometry.

---

## 4. Install Node.js and Git

Download the **Node.js LTS** Windows installer from https://nodejs.org and run it
with defaults. Then Git from https://git-scm.com/download/win.

Verify in a **new** terminal (PATH only updates for new windows):

```powershell
node -v
npm -v
git --version
```

---

## 5. Get MirrorOS onto the machine

```powershell
cd $HOME
git clone https://github.com/Aadhavm10/MirrorOS.git
cd MirrorOS
npm install
```

Now the secrets. **`.env` is deliberately not in the repo** — copy it from your
dev machine (USB stick, or paste the contents):

```powershell
notepad .env
```

It needs, at minimum:

```
TZ=America/Chicago
CALDAV_USERNAME=you@icloud.com
CALDAV_PASSWORD=app-specific-password
GOOGLE_MAPS_API_KEY=...
ANTHROPIC_API_KEY=...
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
```

`server/config.json` (city, commute addresses, sleep schedule) is also
gitignored, but you don't need to copy it — it regenerates from defaults, and
everything in it is editable from the phone settings page later.

Smoke test:

```powershell
npm start
```

Open http://localhost:3000 in a browser. You should see the clock. `Ctrl+C` to stop.

---

## 6. Firewall rule for the phone settings page

The server binds all interfaces, but Windows blocks inbound port 3000 by default,
so `http://<mirror-ip>:3000/settings` from your phone will silently fail without this.

PowerShell (Admin):

```powershell
netsh advfirewall firewall add rule name="MirrorOS" dir=in action=allow protocol=TCP localport=3000
```

Find the mirror's IP:

```powershell
(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '169.*' -and $_.IPAddress -ne '127.0.0.1' }).IPAddress
```

Then open `http://<that-ip>:3000/settings` on your phone and add it to your home
screen. Set the weather city and commute addresses from there.

---

## 7. Edge kiosk and policy hardening

We use Edge rather than Chrome purely to avoid installing a second permanent
auto-updater service on a machine meant to sit untouched. Same engine, same flags.

The registry policies below are the part that actually keeps a kiosk alive across
Windows updates — without them, a post-update "what's new" tab will happily cover
your mirror. PowerShell (Admin):

```powershell
$p = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge'
New-Item -Path $p -Force | Out-Null
Set-ItemProperty $p HideFirstRunExperience      1 -Type DWord
Set-ItemProperty $p PromotionalTabsEnabled      0 -Type DWord
Set-ItemProperty $p BrowserSignin               0 -Type DWord
Set-ItemProperty $p SyncDisabled                1 -Type DWord
Set-ItemProperty $p ShowRecommendationsEnabled  0 -Type DWord
Set-ItemProperty $p HubsSidebarEnabled          0 -Type DWord
Set-ItemProperty $p PasswordManagerEnabled      0 -Type DWord
Set-ItemProperty $p DefaultBrowserSettingEnabled 0 -Type DWord
```

Test the launcher by hand:

```powershell
.\deploy\edge-kiosk.bat
```

It waits for the server to answer before opening the window, so start `npm start`
in another terminal first. Press `Alt+F4` to close.

---

## 8. Screen power on a schedule

By default, "sleep" only dims the clock with CSS. Behind two-way glass in a dark
room, a dimmed panel still reads as a glowing grey rectangle. Setting sleep mode
to **Off** makes the panel genuinely power down.

Test the script directly first — this is the one piece that varies by hardware:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\display-power.ps1 -State off
# ...wait a few seconds, screen should be dark...
powershell -ExecutionPolicy Bypass -File .\deploy\display-power.ps1 -State on
```

If **off** works but **on** doesn't, the wake path needs adjusting for your panel
— see the troubleshooting table. Do not enable the schedule until both work.

Once both work, turn it on from the phone settings page: **Sleep schedule** →
Enabled, set the times, and set **During sleep** to *Turn the screen off*.

To watch the schedule without blanking the screen you're working on:

```powershell
$env:MIRROR_DISPLAY_DRYRUN=1; npm start
```

It logs `[display] (dry run) would turn display off` instead of doing it.

Notes:

- Talking to the mirror wakes the screen and holds it awake for ~2 minutes after
  the conversation ends.
- The schedule is checked every 30 seconds, so a boundary can land up to half a
  minute late.
- With sleep mode set to *Dim* (the default), no power commands are issued at all.

---

## 9. Start everything on boot

Two scheduled tasks. **Task Scheduler** → *Create Task* (not *Basic Task*).

### Task 1 — MirrorOS backend

- **General:** name `MirrorOS Server`. Run only when user is logged on.
  Check *Run with highest privileges*.
- **Triggers:** *At log on*, specific user `mirror`. Delay 10 seconds.
- **Actions:** Start a program → `C:\Users\mirror\MirrorOS\deploy\start-mirror.bat`
- **Conditions:** **uncheck** *Start the task only if the computer is on AC power*.
- **Settings:** check *If the task fails, restart every* 1 minute, up to 3 times.
  Uncheck *Stop the task if it runs longer than*.

### Task 2 — Edge kiosk

Same as above, but:

- Name `MirrorOS Kiosk`, trigger delay **30 seconds**
- Action → `C:\Users\mirror\MirrorOS\deploy\edge-kiosk.bat`

Both `.bat` files resolve the repo location from their own path, so the checkout
can live anywhere — the paths above just need to match where you cloned it.

### Auto-login

The tasks trigger *at log on*, so the machine has to log in by itself:

```powershell
# Prompts for the password, stores it the same way Windows' own dialog does
Set-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' AutoAdminLogon '1'
Set-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' DefaultUserName 'mirror'
Set-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' DefaultPassword '<your-password>'
```

> This stores the password in the registry in clear text. That's the standard
> trade-off for an unattended kiosk. Use a password you don't use anywhere else,
> and don't do this on a machine holding anything sensitive.

### Power-on after AC restore

So the mirror comes back by itself after an outage: reboot into UEFI (hold
**Volume Up**, press and release **Power**, keep holding Volume Up) and look for
a power-on-AC / "restore on power loss" setting. Surface firmware doesn't always
expose one — if it doesn't, the internal battery covers short outages, and a
longer one needs the power button pressed.

**Now do the real test:** pull the plug, wait 30 seconds, plug it back in. The
mirror should come back to the clock with no dialogs and no login prompt.

---

## 10. Audio

Only needed if you're adding the voice assistant later.

**Settings → System → Sound** → set the output to whichever device your speakers
are on, and the input to the USB microphone. Test the mic under *Input* → speak
and watch the level meter.

> The voice assistant itself (wake word, speech-to-text, text-to-speech) is not
> covered here yet — it needs a whisper.cpp build on Windows. `docs/linux-setup.md` §13
> covers the Linux equivalent.

---

## 11. Updating later

From your dev machine, push changes, then on the mirror:

```powershell
cd $HOME\MirrorOS
git pull
npm install
```

Then restart the backend task:

```powershell
Stop-ScheduledTask  -TaskName 'MirrorOS Server'
Start-ScheduledTask -TaskName 'MirrorOS Server'
```

To do this without walking to the mirror, enable OpenSSH Server:

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType 'Automatic'
netsh advfirewall firewall add rule name="OpenSSH" dir=in action=allow protocol=TCP localport=22
```

Then `ssh mirror@<mirror-ip>` from your Mac.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Mirror is blank, no clock | Server isn't running. `Get-ScheduledTask 'MirrorOS Server'`, or run `npm start` by hand and read the error. |
| Clock shows but no weather/calendar | `.env` missing or wrong. Run `npm start` in a terminal — failing sources log there and the mirror shows "not updating". |
| Phone can't reach `:3000/settings` | Firewall rule missing (§6), or phone is on a different network / guest VLAN. |
| Layout looks wrong, things cut off | Resolution isn't 1920×1080, or Windows display scaling isn't 100%. Settings → Display → Scale = 100%. |
| Edge shows a "what's new" or restore tab | Policy registry keys from §7 didn't apply. Check `edge://policy` and re-run as Admin. |
| Screen won't stay off | Something is waking it. Usual culprit is a jittery wireless mouse or USB HID device — unplug it. **The USB microphone is safe:** audio input doesn't wake a display. Check recent wake sources with `powercfg /lastwake` and list offenders with `powercfg /devicequery wake_armed`. |
| Screen won't come back on | The F15 wake path in `deploy/display-power.ps1` isn't working on your panel. Test it by hand (§8). Some panels need a longer delay — try raising the `Start-Sleep` values. Until it's fixed, set sleep mode back to *Dim* from the settings page. |
| Screen sleeps when it shouldn't | Windows' own idle timer. Re-check §2 — all four *Screen and sleep* dropdowns must be Never. |
| Mirror doesn't come back after a power cut | Fast Startup still on (`powercfg /h off`), or auto-login not configured, or the firmware has no power-on-AC setting. |
| Cursor visible over the page | Should be covered by `cursor: none`, but a wake that used a mouse event can surface it. The script uses a keyboard key specifically to avoid this — if you edited it to use `mouse_event`, that's why. |
| Time is wrong / events off by hours | `TZ` in `.env` doesn't match Windows' timezone. Both must agree. |
