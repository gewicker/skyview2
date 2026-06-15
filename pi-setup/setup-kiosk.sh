#!/usr/bin/env bash
# Run ON the Pi (desktop image) to launch Chromium full-screen at boot, hide the
# cursor, and keep it alive. Detects the Wayland compositor (labwc / wayfire) used
# by Raspberry Pi OS Bookworm, with an X11/LXDE fallback. v2 is monitor-only (no
# projector), so this is a single supervised kiosk — no output mirroring.
set -euo pipefail

BASE_URL="${URL:-http://localhost:3000}"
CHROMIUM="$(command -v chromium-browser || command -v chromium || echo chromium-browser)"

LAUNCH="$HOME/.local/bin/skyview-kiosk.sh"
mkdir -p "$HOME/.local/bin"
cat > "$LAUNCH" <<EOF
#!/usr/bin/env bash
# Kiosk launcher. Chromium's native-Wayland GPU path crashes on the Pi 5 (V3D
# MakeCurrent failures), so we run it through Xwayland (--ozone-platform=x11).
export DISPLAY=:0
export XDG_RUNTIME_DIR=/run/user/\$(id -u)
LOG="\$HOME/kiosk.log"
log() { echo "[\$(date '+%F %T')] \$*" >> "\$LOG"; }
[ -f "\$LOG" ] && { tail -n 200 "\$LOG" > "\$LOG.tmp" 2>/dev/null && mv "\$LOG.tmp" "\$LOG" 2>/dev/null; }
log "launcher starting (pid \$\$)"
CHROMIUM="$CHROMIUM"
BASE_URL="$BASE_URL"

# Wait for the server to be up.
until curl -fsS "\$BASE_URL/api/health" >/dev/null 2>&1; do sleep 1; done
# Hide the cursor on the touch panel (page CSS can't suppress the Xwayland cursor).
pkill -x unclutter 2>/dev/null || true
if command -v unclutter >/dev/null 2>&1; then
  unclutter --timeout 1 --jitter 8 --ignore-scrolling --hide-on-touch --start-hidden >/dev/null 2>&1 &
  log "cursor hider (unclutter) started"
else
  log "unclutter not installed; run: sudo apt install unclutter-xfixes"
fi
# The kiosk covers the screen, so the desktop file manager just spins a CPU core
# drawing a wallpaper nobody sees. Stop it.
pkill -x pcmanfm 2>/dev/null || true

while true; do
  pkill -f "/usr/lib/chrom[i]um" 2>/dev/null || true
  pkill -x pcmanfm 2>/dev/null || true
  sleep 1
  log "launching kiosk -> \$BASE_URL/"
  "\$CHROMIUM" --kiosk --ozone-platform=x11 --app="\$BASE_URL/" \\
    --user-data-dir="\$HOME/.kiosk-profile" --no-first-run --password-store=basic \\
    --noerrdialogs --disable-infobars --disable-session-crashed-bubble \\
    --autoplay-policy=no-user-gesture-required \\
    --check-for-update-interval=31536000 --start-fullscreen >/dev/null 2>&1 || true
  log "kiosk window exited; relaunching"
  sleep 3
done
EOF
chmod +x "$LAUNCH"

command -v unclutter >/dev/null 2>&1 || { echo "==> installing unclutter-xfixes…"; sudo apt-get install -y unclutter-xfixes || echo "    run: sudo apt install unclutter-xfixes"; }

# Nightly fresh kiosk restart at 04:30 so browser memory can't pile up over a long
# run; the supervise loop relaunches the window.
{ crontab -l 2>/dev/null | grep -v 'skyview-nightly-kiosk'; echo '30 4 * * * pkill -f "/usr/lib/chrom[i]um" # skyview-nightly-kiosk'; } | crontab - 2>/dev/null \
  && echo "==> nightly kiosk refresh scheduled (04:30)" \
  || echo "    (couldn't set crontab; add a nightly 'pkill chromium' yourself)"

if command -v labwc >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/labwc"; A="$HOME/.config/labwc/autostart"
  grep -q skyview-kiosk "$A" 2>/dev/null || echo "$LAUNCH &" >> "$A"
  echo "==> labwc detected; kiosk added to $A"
elif command -v wayfire >/dev/null 2>&1; then
  INI="$HOME/.config/wayfire.ini"; touch "$INI"
  grep -q "\[autostart\]" "$INI" || printf "\n[autostart]\n" >> "$INI"
  grep -q skyview-kiosk "$INI" || sed -i "/\[autostart\]/a skyview = $LAUNCH" "$INI"
  grep -q "screensaver" "$INI" || sed -i "/\[autostart\]/a screensaver = false\ndpms = false" "$INI"
  echo "==> wayfire detected; kiosk added to $INI"
else
  A="$HOME/.config/lxsession/LXDE-pi/autostart"; mkdir -p "$(dirname "$A")"
  { echo "@xset s off"; echo "@xset -dpms"; echo "@xset s noblank"; echo "@$LAUNCH"; } >> "$A"
  echo "==> X11/LXDE fallback; kiosk added to $A"
fi

echo
echo "Kiosk installed (single output)  ->  $BASE_URL/"
echo "Reboot to start it, or launch now in the desktop session:  $LAUNCH"
