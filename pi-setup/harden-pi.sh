#!/usr/bin/env bash
# Run ON the Pi. Turns a working install into a durable, self-healing appliance:
#   - hardware watchdog: a wedged Pi reboots itself
#   - logs to RAM, size-capped: protects the SD card from write wear
#   - self-heal timer (every 2 min): restarts a dead service, re-ups WiFi after
#     an AP blip, and reboots only as a last resort if it stays offline
# Idempotent. Optional power-cut armor:
#   sudo harden-pi.sh --seal     read-only overlay root (power loss can't corrupt
#                                the OS). Run --unseal (then reboot) before updating.
#   sudo harden-pi.sh --unseal   writable root again.
set -euo pipefail

seal() {
  command -v raspi-config >/dev/null || { echo "raspi-config missing"; exit 1; }
  sudo raspi-config nonint enable_overlayfs
  echo "Overlay root enabled. Reboot to apply. Run 'skyview unseal' (then reboot) before updating."
}
unseal() {
  sudo raspi-config nonint disable_overlayfs
  echo "Overlay disabled. Reboot, then 'skyview update now'."
}
case "${1:-}" in
  --seal) seal; exit 0 ;;
  --unseal) unseal; exit 0 ;;
  "" ) : ;;
  * ) echo "usage: harden-pi.sh [--seal|--unseal]"; exit 1 ;;
esac

echo "==> Hardware watchdog (auto-reboot a hung Pi — so a hard lockup never needs a power cycle)"
# Enable the BCM watchdog in firmware so /dev/watchdog EXISTS after boot. Without it a truly wedged Pi
# can't self-reboot and needs a manual power cycle (exactly the symptom we're killing). Persist it.
BOOTCFG=/boot/firmware/config.txt; [ -f "$BOOTCFG" ] || BOOTCFG=/boot/config.txt
if [ -f "$BOOTCFG" ] && ! grep -q '^dtparam=watchdog=on' "$BOOTCFG"; then
  echo 'dtparam=watchdog=on' | sudo tee -a "$BOOTCFG" >/dev/null
  echo "    added dtparam=watchdog=on to $BOOTCFG (arms /dev/watchdog after the next reboot)."
fi
# Tell systemd to pet the watchdog. Harmless if /dev/watchdog isn't present yet — it activates once the
# dtparam above takes effect on the next reboot.
sudo mkdir -p /etc/systemd/system.conf.d
sudo tee /etc/systemd/system.conf.d/10-skyview-watchdog.conf >/dev/null <<'EOF'
[Manager]
RuntimeWatchdogSec=15
RebootWatchdogSec=2min
EOF
if [ -e /dev/watchdog ]; then
  echo "    /dev/watchdog present; systemd pets it every 15s — a lockup reboots in ~2min."
else
  echo "    /dev/watchdog not present yet; REBOOT once to arm it (dtparam was just enabled)."
fi

echo "==> Logs to RAM, size-capped (spare the SD card)"
sudo mkdir -p /etc/systemd/journald.conf.d
sudo tee /etc/systemd/journald.conf.d/10-skyview.conf >/dev/null <<'EOF'
[Journal]
Storage=volatile
RuntimeMaxUse=64M
EOF
sudo systemctl restart systemd-journald || true

echo "==> Wi-Fi power-save OFF (a napping radio silently drops the kiosk off the network)"
# The kiosk renders off localhost, so a dropped Wi-Fi link looks "working" but is unreachable
# (skyview.local stops resolving). NetworkManager defaults Wi-Fi power-save ON; force it off for
# all connections (survives reboots + re-connects), and apply to the live radio now.
sudo mkdir -p /etc/NetworkManager/conf.d
sudo tee /etc/NetworkManager/conf.d/10-skyview-wifi-powersave.conf >/dev/null <<'EOF'
[connection]
wifi.powersave = 2
EOF
for w in $(nmcli -t -f DEVICE,TYPE device 2>/dev/null | awk -F: '$2=="wifi"{print $1}'); do
  sudo iw dev "$w" set power_save off 2>/dev/null || true
done
sudo nmcli general reload 2>/dev/null || true   # re-read conf.d WITHOUT dropping our SSH link (no restart)

echo "==> mDNS publisher (avahi) enabled so skyview.local is advertised"
# Make sure the Pi keeps advertising skyview.local. (Windows-side resolution is still flaky — for a
# rock-solid name, add a DHCP reservation on the router + a hosts entry on the PC; see the runbook.)
sudo systemctl enable --now avahi-daemon 2>/dev/null || true

echo "==> Self-heal script + 2-minute timer"
sudo tee /usr/local/bin/skyview-selfheal >/dev/null <<'EOF'
#!/usr/bin/env bash
# Restart a dead service; re-up WiFi after a blip; reboot only as a last resort.
set -uo pipefail
STATE=/run/skyview; mkdir -p "$STATE"; now=$(date +%s)

curl -fsS http://localhost:3000/api/health >/dev/null 2>&1 \
  || systemctl restart skyview 2>/dev/null || true
curl -fsS http://localhost:8080/aircraft.json >/dev/null 2>&1 \
  || curl -fsS http://localhost:8080/data/aircraft.json >/dev/null 2>&1 \
  || systemctl restart dump1090-fa dump1090-json 2>/dev/null || true

GW=$(ip route 2>/dev/null | awk '/default/{print $3; exit}')
if [ -n "$GW" ] && ping -c1 -W2 "$GW" >/dev/null 2>&1; then
  rm -f "$STATE/offline_since"
else
  nmcli radio wifi on 2>/dev/null || true
  # Reconnect whatever profile is bound to the Wi-Fi device (name-agnostic — the stock profile is
  # "preconfigured", not "SkyView", so the old hard-coded name never reconnected).
  for w in $(nmcli -t -f DEVICE,TYPE device 2>/dev/null | awk -F: '$2=="wifi"{print $1}'); do
    nmcli device reconnect "$w" 2>/dev/null || true
  done
  [ -f "$STATE/offline_since" ] || echo "$now" > "$STATE/offline_since"
  since=$(cat "$STATE/offline_since" 2>/dev/null || echo "$now")
  if [ $(( now - since )) -ge 1200 ]; then            # offline for 20 minutes
    last=$(cat /var/lib/skyview/last_reboot 2>/dev/null || echo 0)
    if [ $(( now - last )) -ge 3600 ]; then           # at most one reboot per hour
      mkdir -p /var/lib/skyview; echo "$now" > /var/lib/skyview/last_reboot
      logger -t skyview "offline 20min, rebooting"; systemctl reboot
    fi
  fi
fi
EOF
sudo chmod +x /usr/local/bin/skyview-selfheal
sudo tee /etc/systemd/system/skyview-selfheal.service >/dev/null <<'EOF'
[Unit]
Description=SkyView self-heal
[Service]
Type=oneshot
ExecStart=/usr/local/bin/skyview-selfheal
EOF
sudo tee /etc/systemd/system/skyview-selfheal.timer >/dev/null <<'EOF'
[Unit]
Description=Run SkyView self-heal every 2 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
[Install]
WantedBy=timers.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now skyview-selfheal.timer

echo
echo "Hardened. A crash self-restarts, an AP blip re-ups WiFi, a hang reboots."
echo "Once stable, lock the OS read-only:  sudo skyview seal"
