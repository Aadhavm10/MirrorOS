# Linux Setup — Surface Pro 4 Smart Mirror

This guide covers installing Debian with the linux-surface kernel on a Surface Pro 4,
configuring a portrait 1080p display, and wiring up MirrorOS to start on boot.

---

## 1. Prerequisites

- USB drive (4GB+) for the installer
- USB-A hub or adapter (Surface Pro 4 has one USB-A port)
- USB keyboard for initial setup
- The Mini DisplayPort → HDMI adapter already connected to the TV mainboard

---

## 2. Install Debian

### 2a. Download Debian
Get the latest Debian stable netinstall ISO from https://www.debian.org/CD/netinst/
Use the amd64 image.

### 2b. Flash to USB
On macOS (your laptop):
```bash
diskutil list                          # find your USB disk, e.g. /dev/disk4
diskutil unmountDisk /dev/disk4
sudo dd if=debian-*-amd64-netinst.iso of=/dev/rdisk4 bs=1m status=progress
```

### 2c. Boot the Surface
1. Hold **Volume Down + Power** to enter UEFI firmware
2. Go to **Security → Secure Boot** → Disable it
3. Go to **Boot** → set USB as first boot device
4. Save and reboot with USB inserted

### 2d. Debian installer
- Choose **Graphical Install** (easier for initial setup)
- Partitioning: guided, use entire disk, single partition is fine
- Software selection: uncheck everything except **SSH server** and **standard system utilities**
  - Do NOT install a desktop environment — we'll use a minimal X session only
- Create user: `mirror` (or whatever you prefer — update `deploy/mirroros.service` to match)

---

## 3. Install linux-surface kernel

The linux-surface kernel adds proper support for Surface hardware (Wi-Fi, touch, battery, etc.).
Follow the official guide at https://github.com/linux-surface/linux-surface/wiki/Installation-and-Setup

Quick path for Debian:
```bash
# Add the linux-surface repo key
wget -qO - https://raw.githubusercontent.com/linux-surface/linux-surface/master/pkg/keys/surface.asc \
  | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/surface.gpg

# Add the repo
echo "deb [arch=amd64] https://pkg.surfacelinux.com/debian release main" \
  | sudo tee /etc/apt/sources.list.d/surface.list

sudo apt update
sudo apt install linux-image-surface linux-headers-surface libwacom-surface iptsd

# Install firmware (Wi-Fi, camera, etc.)
sudo apt install linux-firmware

sudo reboot
```

After reboot, verify you're on the surface kernel:
```bash
uname -r   # should contain "surface"
```

---

## 4. Minimal X + Openbox setup

We only need enough of a graphical environment to run Chromium fullscreen.
No desktop environment needed.

```bash
sudo apt install --no-install-recommends \
  xorg \
  openbox \
  chromium \
  unclutter   # hides the mouse cursor
```

### Autologin on tty1

Edit `/etc/systemd/system/getty@tty1.service.d/override.conf` (create if missing):
```ini
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin mirror --noclear %I $TERM
```

### Start X on login

Append to `/home/mirror/.bash_profile`:
```bash
if [ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
  exec startx
fi
```

### Openbox session

Create `/home/mirror/.xinitrc`:
```bash
#!/bin/bash
# Hide cursor after 1s of inactivity
unclutter -idle 1 &

# Start MirrorOS backend (if not running via systemd)
# node /home/mirror/MirrorOS/server/index.js &

# Launch Chromium in kiosk mode
/home/mirror/MirrorOS/deploy/chromium-launch.sh
```

Make it executable:
```bash
chmod +x /home/mirror/.xinitrc
```

---

## 5. Portrait display configuration

The panel is 1080×1920 (portrait). The GPU outputs landscape by default; we rotate it in X.

Create `/etc/X11/xorg.conf.d/90-monitor.conf`:
```
Section "Monitor"
    Identifier "HDMI-1"
    Option "Rotate" "right"
EndSection

Section "Screen"
    Identifier "Screen0"
    Monitor "HDMI-1"
    DefaultDepth 24
    SubSection "Display"
        Depth 24
        Modes "1080x1920"
    EndSubSection
EndSection
```

> **Note:** The exact connector name (`HDMI-1`, `HDMI-A-1`, etc.) may differ.
> After first boot into X, run `xrandr` to see the actual connector name and adjust above.

To rotate without a config file (test first):
```bash
xrandr --output HDMI-1 --rotate right
```

---

## 6. Install Node.js

```bash
# Use NodeSource for a current LTS release
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install nodejs
node --version  # verify
```

---

## 7. Deploy MirrorOS

```bash
# Clone the repo
cd /home/mirror
git clone https://github.com/Aadhavm10/MirrorOS.git
cd MirrorOS

# Install dependencies
npm install

# Create .env
cp .env.example .env
# Edit .env and fill in CALDAV_USERNAME and CALDAV_PASSWORD when ready
nano .env
```

---

## 8. Systemd service (Node backend)

```bash
sudo cp /home/mirror/MirrorOS/deploy/mirroros.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable mirroros
sudo systemctl start mirroros

# Verify
sudo systemctl status mirroros
curl http://localhost:3000/api/data
```

To update after a `git pull`:
```bash
cd /home/mirror/MirrorOS && git pull && npm install
sudo systemctl restart mirroros
```

---

## 9. Chromium kiosk autostart

The `.xinitrc` above already calls `chromium-launch.sh`. Make sure it's executable:
```bash
chmod +x /home/mirror/MirrorOS/deploy/chromium-launch.sh
```

The script waits 5 seconds for the Node server to be ready, then opens Chromium in kiosk mode
with the flags that suppress the "didn't shut down properly" dialog:
```
--disable-session-crashed-bubble
--hide-crash-restore-bubble
--no-first-run
--noerrdialogs
```

---

## 10. Audio

The TV mainboard speakers are connected via HDMI audio. Verify output device:
```bash
sudo apt install alsa-utils
aplay -l   # list playback devices
# Look for the HDMI output device
```

Set HDMI as default in `/etc/asound.conf`:
```
defaults.pcm.card 1
defaults.ctl.card 1
```
(Replace `1` with the actual card number from `aplay -l`.)

Test:
```bash
speaker-test -c 2 -t wav
```

---

## 11. Power loss recovery checklist

After a power cut the system should come back fully automatically:
- [x] UEFI: set "Power on after AC back" to **On** (check Surface UEFI firmware settings)
- [x] Autologin on tty1 (Step 4)
- [x] X starts on login (Step 4)
- [x] `mirroros` systemd service enabled (Step 8)
- [x] Chromium launched via `.xinitrc` with crash-restore suppression flags (Step 9)

---

## 12. Updating the mirror

```bash
ssh mirror@<mirror-ip>
cd MirrorOS
git pull
npm install          # only needed if package.json changed
sudo systemctl restart mirroros
# Chromium will reload on its own 60s poll cycle, or:
# pkill chromium && /home/mirror/MirrorOS/deploy/chromium-launch.sh &
```
