#!/usr/bin/env bash
# Cleanly remove EVERYTHING SkyView 2 installed, leaving the Pi as if it was never
# here. The shared ADS-B decoder on :8080 is KEPT by default (it's the radio, not the
# app, and is expensive to rebuild). Idempotent — safe to run repeatedly.
#   --purge   also delete saved config/scenes (~/.local/share/skyview)
#   --all     also remove the dump1090 decoder services (full wipe)
set -uo pipefail
PURGE=0; ALL=0
for a in "$@"; do case "$a" in --purge) PURGE=1 ;; --all) ALL=1 ;; esac; done

# A sealed (read-only overlay) root makes deletes evaporate on reboot — undo first.
if grep -q 'boot=overlay' /proc/cmdline 2>/dev/null; then
  echo "NOTE: OS is sealed read-only. Run 'skyview unseal' (or 'sudo skyview-harden --unseal')"
  echo "      then reboot, then re-run this — otherwise removals won't persist."
fi

echo "==> stop + disable services"
for u in skyview skyview-update.timer skyview-update.service \
         skyview-selfheal.timer skyview-selfheal.service \
         skyview-onboard.timer skyview-onboard.service; do
  sudo systemctl disable --now "$u" 2>/dev/null || true
done
nmcli con down "SkyView-setup" 2>/dev/null || true

echo "==> remove unit files + drop-ins"
sudo rm -f /etc/systemd/system/skyview.service \
  /etc/systemd/system/skyview-update.service /etc/systemd/system/skyview-update.timer \
  /etc/systemd/system/skyview-selfheal.service /etc/systemd/system/skyview-selfheal.timer \
  /etc/systemd/system/skyview-onboard.service /etc/systemd/system/skyview-onboard.timer \
  /etc/systemd/system.conf.d/10-skyview-watchdog.conf \
  /etc/systemd/journald.conf.d/10-skyview.conf
sudo systemctl daemon-reload
sudo systemctl restart systemd-journald 2>/dev/null || true

echo "==> remove binaries, config, state, mDNS"
sudo rm -f /usr/local/bin/skyview /usr/local/bin/skyview-server \
  /usr/local/bin/skyview-updater /usr/local/bin/skyview-selfheal /usr/local/bin/skyview-harden \
  /usr/local/bin/skyview-switch /usr/local/bin/skyview-display-power /usr/local/bin/skyview-onboard
sudo rm -rf /etc/skyview /var/lib/skyview /run/skyview /etc/default/skyview
sudo rm -f /boot/firmware/skyview-status.txt
sudo rm -f /etc/avahi/services/skyview.service
sudo systemctl restart avahi-daemon 2>/dev/null || true

echo "==> remove kiosk + cron"
pkill -f "/usr/lib/chrom[i]um" 2>/dev/null || true
rm -f "$HOME/.local/bin/skyview-kiosk.sh" "$HOME/kiosk.log"
rm -rf "$HOME/.kiosk-profile"
rm -f "$HOME/.config/autostart/skyview-kiosk.desktop"
sed -i '/skyview-kiosk/d' "$HOME/.config/labwc/autostart" 2>/dev/null || true
sed -i '/skyview/d' "$HOME/.config/wayfire.ini" 2>/dev/null || true
sed -i '\#skyview-kiosk#d' "$HOME/.config/lxsession/LXDE-pi/autostart" 2>/dev/null || true
crontab -l 2>/dev/null | grep -v skyview-nightly-kiosk | crontab - 2>/dev/null || true

if [ "$PURGE" = 1 ]; then
  echo "==> purge saved config/scenes"
  rm -rf "$HOME/.local/share/skyview"
fi
if [ "$ALL" = 1 ]; then
  echo "==> remove decoder (full wipe)"
  sudo systemctl disable --now dump1090-fa dump1090-json 2>/dev/null || true
  sudo rm -f /etc/systemd/system/dump1090-fa.service /etc/systemd/system/dump1090-json.service
  sudo systemctl daemon-reload
fi

echo "Done. SkyView removed${PURGE:+ (config/scenes purged)}${ALL:+ (+ decoder)}."
