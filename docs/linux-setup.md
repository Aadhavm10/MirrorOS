# Linux Setup — Surface Pro 4 Smart Mirror

Complete walkthrough for turning a factory-reset Surface Pro 4 into the mirror:
Debian + the linux-surface kernel, portrait display, Chromium kiosk, the Node
backend, and the voice assistant — all starting automatically on boot.

**Written for someone who has never installed Linux.** Every command is meant to
be copied exactly. Where something is likely to differ on your machine, it says so.

**Time:** about 2–3 hours, most of it waiting on downloads and one long compile.
You can stop after any numbered section and pick up later.

---

## 0. What you need before starting

| Item | Why |
|---|---|
| USB drive, 4 GB+ | The Debian installer. **It gets erased.** |
| USB-A hub | The Surface has exactly one USB port and you need keyboard + drive at once |
| USB keyboard | The installer can't use the touchscreen |
| USB microphone | For the voice assistant. The Surface's built-in mics work at arm's length but not across a room |
| Mini DisplayPort → HDMI adapter | Already connected to the TV mainboard |
| USB WiFi dongle (~$12) | **Insurance.** The Surface's built-in WiFi is the one flaky part on Linux — see §1 |

**A few terms**, since this is your first Linux install:

- **Terminal** — the text window where you type commands. Everything below happens here.
- **`sudo`** — "do this as administrator." It asks for your password the first time. The password does **not** appear as you type it, not even dots. That's normal — just type and press Enter.
- **`nano`** — a simple text editor that runs in the terminal. Save with `Ctrl+O` then `Enter`; exit with `Ctrl+X`.
- **`systemd` / service** — Linux's way of running a program in the background forever, restarting it if it crashes and starting it at boot. The mirror uses two: one for the web server, one for the voice assistant.

---

## 1. Test the hardware BEFORE installing (don't skip this)

The Surface Pro 4's WiFi chip (Marvell 88W8897) is the known weak point on Linux —
it sometimes isn't detected, or connects unreliably. Every single thing on the
mirror needs the internet, so find out now, while backing out is free.

You'll do this with a **live USB** — Debian running from the USB stick without
touching the internal drive. Make the USB first (§2), then come back here.

1. Boot from the USB (§3) and choose **"Live system"** at the boot menu if offered.
   (If you downloaded the netinst image, it has no live mode — see the note in §2.)
2. Once a desktop appears, click the network icon and try connecting to your WiFi.
3. Leave it connected for 5 minutes while you browse a website.

**If WiFi works and stays connected:** great, continue to §2/§3 and install.

**If WiFi isn't detected or keeps dropping:** you have two easy fixes —
- Install the firmware package after installing Debian: `sudo apt install firmware-marvell` (older Debian: `firmware-libertas`), then reboot.
- Or just use the USB WiFi dongle. Plug it in and it will almost certainly work
  with no configuration. This is the reliable path; the dongle costs less than an
  hour of frustration.

Also worth checking now: plug in the USB mic and confirm the live system sees it
(open a terminal, run `arecord -l`, and look for your mic in the list).

---

## 2. Make the installer USB (on your Mac)

Download the **Debian stable "netinst" image** (amd64) from
https://www.debian.org/CD/netinst/ — it's about 750 MB.

> **Tip:** if you want the live-system hardware test in §1, download the
> **live image with GNOME** from https://www.debian.org/CD/live/ instead (~3 GB).
> It can both test *and* install. Either works; the live image is friendlier.

Then, in your Mac's Terminal:

```bash
# 1. Find the USB drive — look for the one matching your USB's size
diskutil list

# 2. Unmount it (replace disk4 with YOUR disk number from the list above)
diskutil unmountDisk /dev/disk4

# 3. Write the image (this erases the USB — double-check the disk number!)
sudo dd if=~/Downloads/debian-*-amd64-netinst.iso of=/dev/rdisk4 bs=1m status=progress
```

> ⚠️ **Get the disk number right.** `dd` will happily erase your Mac's drive if
> you point it at the wrong disk. The USB is usually the last one listed and its
> size will match your USB stick. If unsure, unplug the USB, run `diskutil list`,
> plug it back in, run it again, and see which one appeared.

This takes a few minutes and prints nothing until it's done. macOS may pop up
"The disk you inserted was not readable" at the end — that's expected, click
**Ignore** (macOS just can't read Linux formatting).

---

## 3. Boot the Surface from USB

The Surface won't boot from USB until you turn off Secure Boot.

1. **Shut the Surface down completely** (not sleep).
2. Hold **Volume Up**, press and release **Power**, keep holding Volume Up until
   the UEFI (firmware settings) screen appears.
3. Go to **Security** → **Secure Boot** → change to **Disabled**.
4. Go to **Boot configuration** → drag **USB Storage** to the top of the list.
5. **Exit** → **Restart now**, with the USB drive plugged in.

If it boots back into a "no operating system" screen or the Surface logo loops,
the USB wasn't written correctly — redo §2.

---

## 4. Install Debian

Choose **Graphical Install** at the boot menu. Then, screen by screen:

| Screen | What to choose |
|---|---|
| Language / location / keyboard | Whatever matches you (English / United States) |
| Network | Pick your WiFi and enter the password. **If no WiFi appears here**, see §1 — plug in the USB dongle or use ethernet via the hub |
| Hostname | `mirror` |
| Domain name | Leave blank |
| Root password | **Leave both boxes empty** and continue. This makes your own account the admin via `sudo`, which is simpler |
| Full name / username | `mirror` — ⚠️ **use exactly this**, the service files expect `/home/mirror` |
| Password | Pick something you'll remember; you'll type it often. Write it down |
| Partitioning | **Guided – use entire disk** → **All files in one partition** → **Finish and write changes** → **Yes** |
| Software selection | ⚠️ **Uncheck everything**, then check **only** `SSH server` and `standard system utilities`. Use Space to toggle. **Do not install a desktop environment** — the mirror runs a minimal graphics stack instead |
| GRUB bootloader | **Yes**, install it, and choose the internal disk (usually `/dev/sda` or `/dev/nvme0n1`) |

Then it reboots. **Remove the USB drive** when it says to.

You'll land on a black screen with a text login prompt. That's correct — there's
no desktop by design. Log in with `mirror` and your password.

---

## 5. Get on the network and find your IP

If you set up WiFi during install, you're already online. Test it:

```bash
ping -c 3 debian.org
```

If that fails, connect manually:

```bash
sudo nmtui        # arrow keys → "Activate a connection" → pick your WiFi
```

Now find the Surface's IP address — **write this down**, you'll use it constantly:

```bash
hostname -I
```

You'll get something like `192.168.1.87`. From now on you can do everything from
your Mac instead of hunching over the Surface with a USB keyboard:

```bash
ssh mirror@192.168.1.87
```

That's much more comfortable — copy-paste works, and you can keep this guide open
in the same window. **Recommended: do the rest of this guide over SSH from your Mac.**

---

## 6. Install the linux-surface kernel

This adds proper Surface hardware support (WiFi firmware, touchscreen, battery,
sensors). Debian's stock kernel mostly works but this makes it solid.

```bash
sudo apt update
sudo apt install -y wget gpg

# Add the linux-surface signing key and repository
wget -qO - https://raw.githubusercontent.com/linux-surface/linux-surface/master/pkg/keys/surface.asc \
  | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/surface.gpg

echo "deb [arch=amd64] https://pkg.surfacelinux.com/debian release main" \
  | sudo tee /etc/apt/sources.list.d/surface.list

sudo apt update
sudo apt install -y linux-image-surface linux-headers-surface iptsd libwacom-surface
sudo apt install -y firmware-linux firmware-marvell   # WiFi + graphics firmware

sudo reboot
```

Wait a minute, SSH back in, and confirm you're on the new kernel:

```bash
uname -r        # should contain the word "surface"
```

> If `firmware-marvell` isn't found, try `firmware-libertas`, or skip it — it only
> matters if you're using the built-in WiFi rather than a dongle.

---

## 7. Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs git
node --version      # should print v20.x or newer
```

---

## 8. Deploy MirrorOS

```bash
cd /home/mirror
git clone https://github.com/Aadhavm10/MirrorOS.git
cd MirrorOS
npm install
cp .env.example .env
nano .env
```

Fill in the keys. Reminder of who owns what:

| Setting | Value |
|---|---|
| `TZ` | `America/Chicago` (or her timezone) |
| `CALDAV_USERNAME` / `CALDAV_PASSWORD` | **Her** Apple ID + an app-specific password from appleid.apple.com |
| `ANTHROPIC_API_KEY` | Yours — the voice assistant brain |
| `GOOGLE_MAPS_API_KEY` | Yours — commute + pollen |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | **Her** Spotify (Premium) — see §14 |

Save with `Ctrl+O`, `Enter`, then `Ctrl+X`.

> **Note:** `server/config.json` (weather city, commute addresses) is *not* in git,
> so a fresh install starts at the defaults in `.env`. You'll set the real values
> from the phone settings page in §15 — no need to hand-edit anything.

Test that it runs:

```bash
node server/index.js
```

You should see `MirrorOS running at http://localhost:3000`. Press `Ctrl+C` to stop it.

---

## 9. Run the backend as a service

This makes the server start at boot and restart itself if it ever crashes.

```bash
sudo cp /home/mirror/MirrorOS/deploy/mirroros.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mirroros

# Check it
systemctl status mirroros          # should say "active (running)" — press q to exit
curl http://localhost:3000/api/data
```

That `curl` should print a wall of JSON with weather and calendar data. If it does,
the backend is fully working.

**Useful later:**
```bash
journalctl -u mirroros -f          # watch the server log live (Ctrl+C to stop)
sudo systemctl restart mirroros    # restart after changing .env
```

---

## 10. Graphics: minimal X + Chromium kiosk

There's no desktop — just enough to put one fullscreen browser window on the panel.

```bash
sudo apt install --no-install-recommends -y \
  xorg openbox chromium unclutter x11-xserver-utils
```

**Log in automatically at boot**, so no keyboard is ever needed:

```bash
sudo mkdir -p /etc/systemd/system/getty@tty1.service.d
sudo nano /etc/systemd/system/getty@tty1.service.d/override.conf
```

Paste exactly:

```ini
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin mirror --noclear %I $TERM
```

**Start the graphics automatically after that login:**

```bash
nano /home/mirror/.bash_profile
```

Add at the end:

```bash
if [ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
  exec startx
fi
```

**Define what the graphical session runs:**

```bash
nano /home/mirror/.xinitrc
```

Paste:

```bash
#!/bin/bash
xset s off          # never blank the screen
xset -dpms          # never power down the display
xset s noblank
unclutter -idle 1 & # hide the mouse cursor
exec /home/mirror/MirrorOS/deploy/chromium-launch.sh
```

Make both executable:

```bash
chmod +x /home/mirror/.xinitrc /home/mirror/MirrorOS/deploy/chromium-launch.sh
```

Reboot and the mirror display should come up on its own:

```bash
sudo reboot
```

---

## 11. Rotate the display to portrait

The panel is mounted portrait (1080×1920) but the graphics card outputs landscape.

First find what your display is actually called — SSH in while the screen is on:

```bash
DISPLAY=:0 xrandr
```

Look for the line ending in `connected` — e.g. `HDMI-1`, `HDMI-A-1`, or `DP-1`.
Test the rotation live (swap in your name; try `left` if `right` is upside down):

```bash
DISPLAY=:0 xrandr --output HDMI-1 --rotate right
```

The screen should snap to portrait immediately. Once you've confirmed which
direction is correct, make it permanent:

```bash
sudo nano /etc/X11/xorg.conf.d/90-monitor.conf
```

```
Section "Monitor"
    Identifier "HDMI-1"
    Option "Rotate" "right"
EndSection
```

(Use your connector name and the direction that worked.) Reboot to verify it
survives a restart.

---

## 12. Audio — speakers and microphone

The voice assistant needs **both** output (to talk) and input (to listen).

```bash
sudo apt install -y alsa-utils
aplay -l      # playback devices — find the HDMI one going to the TV
arecord -l    # capture devices — find your USB microphone
```

Test the speakers:

```bash
speaker-test -c 2 -t wav -l 1
```

Test the mic (records 5 seconds, then plays it back):

```bash
arecord -d 5 -f cd /tmp/test.wav && aplay /tmp/test.wav
```

If you hear yourself, audio is done. If the wrong device is used, note the card
numbers from `aplay -l` / `arecord -l` — you'll set them explicitly in the voice
config in the next step.

---

## 13. Install the voice assistant

Follow **`docs/voice-setup.md` → "Production setup (Surface Pro 4, Debian x86)"**.
It covers the Python environment, building whisper.cpp, downloading the models,
picking audio devices, and the `mirrorvoice` systemd service.

Two heads-ups:

- **Building whisper.cpp takes 5–15 minutes** on this i5 and prints a lot of text.
  That's normal — let it finish.
- Install it **after** §9, because the voice service is configured to start after
  the backend.

When it's done, verify both services are running:

```bash
systemctl status mirroros mirrorvoice
journalctl -u mirrorvoice -f      # then say "Hey Jarvis" and watch the log
```

---

## 14. Connect Spotify (needs her account)

Spotify's login has to happen in a browser that can reach `127.0.0.1:3000` **on the
Surface itself**. The easy way is an SSH tunnel from your Mac — no keyboard needed
on the mirror:

```bash
# On your Mac:
ssh -L 3000:localhost:3000 mirror@192.168.1.87
```

Leave that running, then open **http://127.0.0.1:3000/spotify/login** in your Mac's
browser. It's your Mac's browser, but the connection is tunneled to the Surface, so
Spotify's redirect lands correctly. Log in as **her** Spotify account and approve.

See `docs/spotify-setup.md` for creating the developer app first — and note the
warning there: create the app while logged in as the account that will use it.

---

## 15. Set the location and commute from a phone

Everything user-facing is configured from the phone settings page — no terminal:

**http://192.168.1.87:3000/settings** (your Surface's IP)

Set the weather city and the commute addresses there. On her iPhone, Safari →
Share → **Add to Home Screen** turns it into an app icon.

---

## 16. Survive a power cut

The mirror should come back on its own after the power blips. You've already done
most of this; verify:

- [ ] UEFI (Volume Up + Power at boot) → **Boot configuration** → enable power-on
      after AC restore, if your firmware offers it
- [ ] Autologin configured (§10)
- [ ] X starts on login (§10)
- [ ] `mirroros` service enabled (§9)
- [ ] `mirrorvoice` service enabled (§13)
- [ ] Chromium launched with crash-restore suppression (§10 — it's in the script)

**Test it for real:** pull the power cord, plug it back in, walk away, and confirm
the mirror comes back with no keyboard touched. Better to find out now than at her house.

> **Battery note:** the Surface has an internal battery, so "power cut" means it
> keeps running until the battery dies, then boots when power returns. If you want
> it to shut down cleanly on a long outage, that's a future addition.

---

## 17. Updating the mirror later

```bash
ssh mirror@192.168.1.87
cd MirrorOS
git pull
npm install                        # only if package.json changed
sudo systemctl restart mirroros
sudo systemctl restart mirrorvoice # only if the voice code changed
```

The display picks up frontend changes on its own within 60 seconds. To force it:

```bash
pkill chromium      # .xinitrc relaunches it automatically
```

---

## 18. When something goes wrong

| Symptom | Try this |
|---|---|
| Black screen, no mirror UI | `systemctl status mirroros` — is the backend running? Then `DISPLAY=:0 xrandr` — is X up? |
| Mirror shows but no data | `journalctl -u mirroros -n 50` — look for `[poller]` errors; usually a bad key in `.env` |
| Voice doesn't respond | `journalctl -u mirrorvoice -f`, say the wake word, watch for `[voice] wake` |
| Voice hears but doesn't answer | Check `ANTHROPIC_API_KEY` in `.env`, then `sudo systemctl restart mirroros` |
| No sound | `aplay -l`, then set the right device in `voice/voice.env` |
| Screen goes blank after a while | The `xset` lines in `.xinitrc` (§10) are missing or misspelled |
| Can't SSH in | The IP changed — check your router, or set a DHCP reservation for the Surface |
| Display upside down | `--rotate left` instead of `right` in §11 |

**Commands worth remembering:**

```bash
systemctl status mirroros mirrorvoice   # are both alive?
journalctl -u mirroros -n 50            # last 50 log lines
journalctl -u mirrorvoice -f            # follow the voice log live
sudo systemctl restart mirroros         # restart after config changes
sudo reboot                             # when in doubt
```
