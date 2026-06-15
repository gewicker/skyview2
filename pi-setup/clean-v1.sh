#!/usr/bin/env bash
# Cleanly remove EVERYTHING v1 (skydeck / skylight) installed, so the Pi is pristine
# before installing SkyView 2. The shared ADS-B decoder on :8080 is KEPT by default.
# Idempotent. Names are v1's, distinct from v2's, so this never touches a v2 install.
#   --purge   also delete the v1 app tree (~/skylight) + staged tarball
#   --all     also remove the dump1090 decoder services (full wipe)
set -uo pipefail
PURGE=0; ALL=0
for a in "$@"; do case "$a" in --purge) PURGE=1 ;; --all) ALL=1 ;; esac; done

if grep -q 'boot=overlay' /proc/cmdline 2>/dev/null; then
  echo "NOTE: v1 OS is sealed read-only. Run 'sudo raspi-config nonint disable_overlayfs',"
  echo "      reboot, then re-run this — otherwise removals won't persist."
fi

echo "==> stop + disable v1 services"
for u in skylight-server skydeck-update.timer skydeck-update.service \
         skydeck-selfheal.timer skydeck-selfheal.service skydeck-onboard.service; do
  sudo systemctl disable --now "$u" 2>/dev/null || true
done

echo "==> remove v1 units + drop-ins"
sudo rm -f /etc/systemd/system/skylight-server.service \
  /etc/systemd/system/skydeck-update.service /etc/systemd/system/skydeck-update.timer \
  /etc/systemd/system/skydeck-selfheal.service /etc/systemd/system/skydeck-selfheal.timer \
  /etc/systemd/system/skydeck-onboard.service \
  /etc/systemd/system.conf.d/10-skydeck-watchdog.conf \
  /etc/systemd/journald.conf.d/10-skydeck.conf
sudo systemctl daemon-reload
sudo systemctl restart systemd-journald 2>/dev/null || true

echo "==> remove v1 binaries, config, state, mDNS"
sudo rm -f /usr/local/bin/skydeck /usr/local/bin/skydeck-updater \
  /usr/local/bin/skydeck-selfheal /usr/local/bin/skydeck-onboard /usr/local/bin/harden-pi.sh
sudo rm -rf /etc/skydeck /var/lib/skydeck /run/skydeck
sudo rm -f /etc/avahi/services/skydeck.service
sudo systemctl restart avahi-daemon 2>/dev/null || true

echo "==> remove v1 kiosk + cron"
pkill -f "/usr/lib/chrom[i]um" 2>/dev/null || true
rm -f "$HOME/.local/bin/skylight-kiosk.sh" "$HOME/kiosk.log"
rm -rf "$HOME/.kiosk-monitor" "$HOME/.kiosk-projector" "$HOME/.kiosk-profile"
sed -i '/skylight-kiosk/d' "$HOME/.config/labwc/autostart" 2>/dev/null || true
sed -i '/skylight/d' "$HOME/.config/wayfire.ini" 2>/dev/null || true
sed -i '\#skylight-kiosk#d' "$HOME/.config/lxsession/LXDE-pi/autostart" 2>/dev/null || true
crontab -l 2>/dev/null | grep -v skydeck-nightly-kiosk | crontab - 2>/dev/null || true

if [ "$PURGE" = 1 ]; then
  echo "==> purge v1 app tree"
  rm -rf "$HOME/skylight" "$HOME/skylight-extended.tar.gz"
fi
if [ "$ALL" = 1 ]; then
  echo "==> remove decoder (full wipe)"
  sudo systemctl disable --now dump1090-fa dump1090-json 2>/dev/null || true
  sudo rm -f /etc/systemd/system/dump1090-fa.service /etc/systemd/system/dump1090-json.service
  sudo systemctl daemon-reload
fi

echo "v1 removed${PURGE:+ (app tree purged)}${ALL:+ (+ decoder)}. Pi is clean — run install-on-pi.sh for v2."
