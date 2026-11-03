# Linux Setup: Dell OptiPlex 3090 + Linux Mint

How the mirror's computer is set up, from a fresh Linux Mint install to the
display coming up on its own after a power cut. The machine is already set up
this way; this doc is for checking it, changing it, or rebuilding it.

| | |
|---|---|
| Computer | Dell OptiPlex 3090 Micro |
| OS | Linux Mint 22.3 Cinnamon, **X11 session** (the default) |
| User / hostname | `aadhav` on `Mirror1` |
| Login | Automatic, no password. Sleep and the screensaver are off |
| SSH | `ssh aadhav@10.133.84.60` from the Mac |
| Code | `/home/aadhav/MirrorOS` |
| Keys | `/home/aadhav/MirrorOS/.env`, readable only by `aadhav` |
| Panel | 15.6" 1920×1080, landscape, top-right corner of the mirror |

Two things run the mirror:

- **`mirroros`**, a systemd service: the Node server. Starts at boot, restarts if it
  crashes, and powers the panel on and off on the sleep schedule.
- **The kiosk**: Chromium fullscreen on `http://localhost:3000`, started by
  Cinnamon when `aadhav` logs in.

Everything below is done over SSH from the Mac unless it says otherwise.

---

## 1. Mint desktop settings

Done once, on the mirror itself with a keyboard and mouse plugged in.

| Where | Setting |
|---|---|
| System Settings → Login Window → Users | Automatic login: `aadhav` |
| System Settings → Power Management | Turn off the screen when inactive: **Never**. Suspend when inactive: **Never** |
| System Settings → Screensaver | Delay before starting the screensaver: **Never**. Lock the computer: off |
| System Settings → Notifications | Notifications: **off**. Otherwise Update Manager and others pop up over the mirror |
| System Settings → Display | 1920×1080, refresh rate as offered, rotation **Normal**, user interface scaling **Normal (100%)** |
| Welcome Screen | Untick "Show this dialog at startup" |
| Login screen, session menu | **Cinnamon**, not "Cinnamon on Wayland". Screen power-off (§7) only works on X11 |

MirrorOS turns the screen off itself, on the schedule set from the phone. Mint's
own screen blanking has to stay at Never so the two don't fight.

To check the session type over SSH:

```bash
loginctl show-session $(loginctl list-sessions --no-legend | awk '/seat0/ {print $1; exit}') -p Type
```

It should print `Type=x11`.

## 2. BIOS: turn back on after a power cut

Without this, a power blip leaves the mirror off until someone presses the button.

1. Reboot and tap **F2** at the Dell logo.
2. **Power Management → AC Behavior** → **Power On**.
3. Apply, exit.

## 3. SSH and a fixed address

SSH is already on. To set it up on a fresh install:

```bash
sudo apt install -y openssh-server
```

Then give the mirror a **DHCP reservation** for `10.133.84.60` in the router, so
the address in this doc and on the phone's home-screen icon never changes.

## 4. Node.js and git

```bash
node --version     # needs v20 or newer
which node         # should be /usr/bin/node, which the service file expects
```

If Node is missing or too old:

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs git
```

If `which node` prints something under `~/.nvm`, edit `ExecStart=` in
`deploy/mirroros.service` to that path before §6.

## 5. The code and the keys

```bash
cd ~
git clone https://github.com/Aadhavm10/MirrorOS.git
cd MirrorOS
npm install
cp .env.example .env
nano .env
chmod 600 .env     # keys readable by aadhav only
```

`.env` holds only keys and `PORT`/`TZ`. Names, the weather city, commutes, the
layout and the sleep schedule are set from the phone (§10).

## 6. The backend service

```bash
sudo cp ~/MirrorOS/deploy/mirroros.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mirroros
systemctl status mirroros      # "active (running)". Press q to exit
curl -s localhost:3000/api/rev # prints {"rev":…,"boot":…}
```

The service runs as `aadhav` from `/home/aadhav/MirrorOS`, so the phone's
**Update mirror** button can `git pull` the checkout and restart it.

**Only one copy should run.** If the server was ever started some other way
(Startup Applications, a terminal left open), that copy holds port 3000 and the
service will crash-loop. Check with:

```bash
ss -ltnp | grep 3000     # exactly one node process
```

and remove any MirrorOS entry from **Menu → Startup Applications** other than the
kiosk below.

## 7. The kiosk

```bash
sudo apt install -y chromium unclutter
mkdir -p ~/.config/autostart
cp ~/MirrorOS/deploy/chromium-autostart.desktop ~/.config/autostart/mirroros-kiosk.desktop
chmod +x ~/MirrorOS/deploy/chromium-launch.sh
```

At the next login, `deploy/chromium-launch.sh` waits for the server, then opens
Chromium fullscreen with no first-run screens, crash bubbles or keyring prompt.
`unclutter` hides the mouse pointer.

To restart just the kiosk without rebooting:

```bash
pkill chromium
DISPLAY=:0 nohup ~/MirrorOS/deploy/chromium-launch.sh >/dev/null 2>&1 &
```

## 8. Screen power-off on the sleep schedule

The phone's **Sleep schedule** card has two modes:

- **Dim the clock**: the page dims itself and the panel stays on.
- **Turn the screen off**: the server runs `deploy/display-power.sh off` at the
  start of the window and `on` at the end. That uses `xset dpms`, which cuts the
  video signal so the panel drops into standby. It takes effect as soon as you
  press Save if you're already inside the window.

Test it by hand first:

```bash
bash ~/MirrorOS/deploy/display-power.sh off    # panel goes dark within a few seconds
bash ~/MirrorOS/deploy/display-power.sh on
```

Then watch it happen on the schedule:

```bash
journalctl -u mirroros -f | grep display
```

| You see | Meaning |
|---|---|
| `[display] display off` / `display on` | Working |
| `could not turn display …: … unable to open display ":0"` | No desktop session yet. Normal for the first tick or two after boot; otherwise check auto-login (§1) |
| `… Authorization required …` | The desktop's X cookie isn't at `~/.Xauthority`. Check `ls -la ~/.Xauthority` while logged in |
| `… does not have extension for dpms option` | The session is Wayland. Switch to Cinnamon on X11 (§1) |
| Nothing at all | Sleep mode is "Dim", the schedule isn't enabled, or you're outside the window |

If the commands succeed but the panel shows a "No signal" box and stays lit, its
controller board is ignoring standby. Look in the panel's own on-screen menu for an
auto power-off or "no signal → standby" option. If there isn't one, only **Dim**
will work on that panel.

Talking to the mirror wakes the panel and keeps it on for two minutes after the
conversation ends.

## 9. Voice and Spotify

- **Voice assistant**: follow `docs/voice-setup.md` → "Production setup (OptiPlex,
  Linux Mint)". Install it after §6, because the voice service starts after the
  backend.
- **Spotify**: the login has to happen in a browser that reaches `127.0.0.1:3000`
  on the mirror. Tunnel it from the Mac:

  ```bash
  ssh -L 3000:localhost:3000 aadhav@10.133.84.60
  ```

  Leave that running, open **http://127.0.0.1:3000/spotify/login** on the Mac and
  log in with the Spotify account that will use it. `docs/spotify-setup.md` covers
  creating the developer app first.

## 10. Settings from a phone

**http://10.133.84.60:3000/settings**: weather city, both people's names and
commutes, which calendars to show, Sleek/Full, whose column to show, the sleep
schedule and screen-off mode, and the Update button. In Safari, Share → **Add to
Home Screen** makes it an app icon.

## 11. Power-cut test

- [ ] BIOS AC Behavior = Power On (§2)
- [ ] Automatic login (§1)
- [ ] `systemctl is-enabled mirroros` says `enabled` (§6)
- [ ] `~/.config/autostart/mirroros-kiosk.desktop` exists (§7)
- [ ] `systemctl is-enabled mirrorvoice` says `enabled`, if voice is set up (§9)

Then pull the plug, plug it back in, and walk away. The mirror should come back
on its own, with no keyboard touched.

## 12. Updating

From the phone: **Settings → Update mirror**. It runs `git pull --ff-only`, runs
`npm install` only if dependencies changed, and restarts the server. The kiosk
notices the restart and reloads itself within a couple of seconds.

By hand:

```bash
cd ~/MirrorOS
git pull
npm install                          # only if package.json changed
sudo systemctl restart mirroros
sudo systemctl restart mirrorvoice   # only if voice/ changed
```

The update button refuses to run if files were edited on the mirror itself
(`git status` shows changes), so nothing local gets overwritten.

## 13. When something goes wrong

| Symptom | Try this |
|---|---|
| Black screen, no mirror | `systemctl status mirroros`. Is the server running? Then `pgrep -a chromium`. Is the kiosk? |
| Mirror shows but no data | `journalctl -u mirroros -n 50`. Look for `[poller]` errors, usually a bad key in `.env` |
| "… not updating" or "Offline" on the glass | The network or one API is down. The mirror keeps showing the last good data, dimmed |
| Screen dims at night instead of turning off | Sleep mode is "Dim", or see the table in §8 |
| Screen blanks during the day | Mint's power settings (§1) are back on. Also check `DISPLAY=:0 xset q`: the DPMS line should say `Disabled` |
| Keyring or "Restore pages" dialog over the mirror | The kiosk wasn't started by `chromium-launch.sh`. Check the autostart entry (§7) |
| Layout runs off the edge | Display isn't 1920×1080 or scaling isn't 100% (§1). `DISPLAY=:0 xrandr` shows the current mode |
| Voice doesn't respond | `journalctl -u mirrorvoice -f`, say the wake word, watch for `[voice] wake` |
| Can't SSH in | The IP changed. Check the router, and set the DHCP reservation (§3) |

```bash
systemctl status mirroros mirrorvoice   # are both alive?
journalctl -u mirroros -n 50            # last 50 server log lines
journalctl -u mirrorvoice -f            # follow the voice log live
sudo systemctl restart mirroros         # after changing .env
sudo reboot                             # when in doubt
```
