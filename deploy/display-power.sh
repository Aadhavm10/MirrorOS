#!/bin/bash
# Turns the mirror's panel on or off. Called by server/display.js on the sleep
# schedule; also safe to run by hand over SSH while testing:
#
#     bash ~/MirrorOS/deploy/display-power.sh off
#     bash ~/MirrorOS/deploy/display-power.sh on
#
# Uses X11 DPMS, which is what Linux Mint Cinnamon runs by default. Edit this
# file if your panel needs different handling. Nothing else depends on how it
# does the job, only on the on/off argument and a non-zero exit on failure.

set -eu

state="${1:-}"
if [ "$state" != on ] && [ "$state" != off ]; then
  echo "usage: $0 on|off" >&2
  exit 2
fi

# The server runs as a systemd service, outside the desktop session, so it
# doesn't inherit a DISPLAY. Point it at the auto-logged-in session's screen.
# LightDM (Mint's login manager) keeps that session's X cookie in
# ~/.Xauthority. (A bare ~ rather than $HOME: bash falls back to the account's
# home directory when HOME isn't set, where $HOME would trip `set -u`.)
home=~
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$home/.Xauthority}"

if ! command -v xset >/dev/null 2>&1; then
  echo "xset not found. Install it with: sudo apt install x11-xserver-utils" >&2
  exit 1
fi

case "$state" in
  off)
    # Cuts the video signal; the panel drops into standby within a few seconds.
    xset dpms force off
    ;;
  on)
    xset dpms force on
    # `xset dpms force` also switches X's own DPMS idle timer on. Left on, it
    # would blank the panel ~10 minutes after every wake, since nobody ever
    # touches a mirror's keyboard. Switch it back off so the sleep schedule
    # stays the only thing that ever blanks the screen.
    xset -dpms
    xset s off
    xset s reset
    ;;
esac

echo "display $state"
