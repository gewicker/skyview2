#!/usr/bin/env bash
# Run ON the Raspberry Pi (over SSH) to install the SkyView 2 appliance:
#   rtl-sdr-blog driver + DVB-T blacklist, dump1090-fa decoder serving
#   aircraft.json on :8080, then the SkyView server BINARY + systemd service +
#   self-updater. (v2 ships one static binary, so there's no Node/pnpm build.)
# Kiosk autostart is set up separately by setup-kiosk.sh (needs the desktop).
set -euo pipefail

SRC="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"   # repo's pi-setup dir
USER_NAME="$(id -un)"
BIN_DST=/usr/local/bin/skyview-server
DATA_DIR="${DATA_DIR:-$HOME/.local/share/skyview}"
# Receiver reference position for the decoder (your location). Defaults to Bellevue.
LAT="${LAT:-47.617}"
LON="${LON:--122.1936}"
# mDNS name: the appliance is reachable at http://$MDNS_HOST.local:3000 on the LAN.
# Override with MDNS_HOST=skydeck to keep the v1 name, etc. (Not named HOSTNAME — that
# is a bash built-in already set to the current machine name.)
MDNS_HOST="${MDNS_HOST:-skyview}"

echo "==> apt update + base packages"
sudo apt-get update
sudo apt-get install -y git build-essential cmake libusb-1.0-0-dev pkg-config \
  libncurses-dev unclutter python3 curl avahi-daemon

echo "==> RTL-SDR Blog V4 driver"
if ! command -v rtl_test >/dev/null 2>&1; then
  S=/tmp/rtl-sdr-blog; rm -rf "$S"
  git clone --depth 1 https://github.com/rtlsdrblog/rtl-sdr-blog "$S"
  cmake -S "$S" -B "$S/build" -DINSTALL_UDEV_RULES=ON -DDETACH_KERNEL_DRIVER=ON
  make -C "$S/build" -j"$(nproc)"
  sudo make -C "$S/build" install && sudo ldconfig
fi
echo "==> Blacklisting stock DVB-T modules"
sudo tee /etc/modprobe.d/blacklist-rtlsdr.conf >/dev/null <<'EOF'
blacklist dvb_usb_rtl28xxu
blacklist rtl2832
blacklist rtl2830
blacklist rtl2838
blacklist dvb_usb_v2
EOF
sudo udevadm control --reload-rules && sudo udevadm trigger || true
sudo modprobe -r dvb_usb_rtl28xxu 2>/dev/null || true

echo "==> dump1090-fa decoder + aircraft.json on :8080"
if ! command -v dump1090-fa >/dev/null 2>&1; then
  S=/tmp/dump1090-fa; rm -rf "$S"
  git clone --depth 1 https://github.com/flightaware/dump1090 "$S"
  make -C "$S" RTLSDR=yes
  sudo install -m755 "$S/dump1090" /usr/local/bin/dump1090-fa
  sudo mkdir -p /run/dump1090-fa
  sudo tee /etc/systemd/system/dump1090-fa.service >/dev/null <<EOF
[Unit]
Description=dump1090-fa ADS-B decoder
After=network.target
[Service]
ExecStartPre=/bin/mkdir -p /run/dump1090-fa
ExecStart=/usr/local/bin/dump1090-fa --device-type rtlsdr --lat $LAT --lon $LON --write-json /run/dump1090-fa --write-json-every 1 --quiet
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
  sudo tee /etc/systemd/system/dump1090-json.service >/dev/null <<EOF
[Unit]
Description=Serve dump1090 aircraft.json on :8080
After=dump1090-fa.service
[Service]
ExecStartPre=/bin/mkdir -p /run/dump1090-fa
ExecStart=/usr/bin/python3 -m http.server 8080 --directory /run/dump1090-fa
Restart=always
RestartSec=2
[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable --now dump1090-fa.service dump1090-json.service
fi

echo "==> Install the SkyView server binary"
mkdir -p "$DATA_DIR"
if [ -f "$HOME/skyview-server" ]; then
  sudo install -m755 "$HOME/skyview-server" "$BIN_DST"          # scp'd from your PC
elif [ -f "$SRC/../bin/skyview" ]; then
  sudo install -m755 "$SRC/../bin/skyview" "$BIN_DST"           # built in the repo
else
  echo "  no local binary found — will fetch the latest release via the updater"
fi

echo "==> Operator CLI + self-updater + hardening"
sudo install -m755 "$SRC/skyview.sh" /usr/local/bin/skyview
sudo install -m755 "$SRC/harden-pi.sh" /usr/local/bin/skyview-harden
sudo install -m755 "$SRC/skyview-display-power" /usr/local/bin/skyview-display-power  # lights-out blanking (projector)
sudo install -m755 "$SRC/skyview-switch" /usr/local/bin/skyview-switch                # v2 ⇄ v1 baseline (no reflash)
bash "$SRC/enable-auto-update.sh"
bash "$SRC/harden-pi.sh"          # watchdog + RAM logs + 2-min self-heal
# If we had no local binary, pull one now.
[ -x "$BIN_DST" ] || sudo /usr/local/bin/skyview-updater || true

# Onboarding fallback: status file on the boot partition + a setup hotspot if WiFi
# never associates, so a headless Pi is always reachable. Needs NetworkManager.
if command -v nmcli >/dev/null 2>&1; then
  echo "==> Onboarding net (status file + WiFi-fail hotspot)"
  sudo install -m755 "$SRC/skyview-onboard" /usr/local/bin/skyview-onboard
  # Carry over the existing WiFi (the connection v1 was already using on this Pi, since
  # we upgrade in place) so onboarding can re-join it on its own. SSID from the active
  # AP; PSK read from the active NM wireless profile (root). Stored 0600 (has the key).
  CUR_SSID="$(nmcli -t -f active,ssid dev wifi 2>/dev/null | awk -F: '$1=="yes"{print $2; exit}')"
  WCONN="$(nmcli -t -f NAME,TYPE con show --active 2>/dev/null | awk -F: '$2 ~ /wireless/{print $1; exit}')"
  CUR_PSK=""
  [ -n "$WCONN" ] && CUR_PSK="$(sudo nmcli -s -g 802-11-wireless-security.psk con show "$WCONN" 2>/dev/null)"
  { echo "# SkyView onboarding — WiFi carried over from the existing/v1 connection."
    echo "TARGET_SSID=$CUR_SSID"
    echo "TARGET_PSK=$CUR_PSK"; } | sudo tee /etc/default/skyview >/dev/null
  sudo chmod 600 /etc/default/skyview
  sudo tee /etc/systemd/system/skyview-onboard.service >/dev/null <<EOF
[Unit]
Description=SkyView onboarding net (status file + setup hotspot)
After=NetworkManager.service network-online.target
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/bin/skyview-onboard
[Install]
WantedBy=multi-user.target
EOF
  sudo tee /etc/systemd/system/skyview-onboard.timer >/dev/null <<'EOF'
[Unit]
Description=Re-check SkyView onboarding net
[Timer]
OnBootSec=30sec
OnUnitActiveSec=10min
Persistent=true
[Install]
WantedBy=timers.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable --now skyview-onboard.service skyview-onboard.timer 2>/dev/null || true
fi

echo "==> Hostname for mDNS ($MDNS_HOST.local)"
# Set the system hostname so avahi publishes $MDNS_HOST.local — that's the friendly
# DNS-addressable URL (http://$MDNS_HOST.local:3000). Skipped if already correct.
if [ "$(hostname)" != "$MDNS_HOST" ]; then
  sudo hostnamectl set-hostname "$MDNS_HOST" 2>/dev/null \
    || (echo "$MDNS_HOST" | sudo tee /etc/hostname >/dev/null)
  # Keep /etc/hosts' 127.0.1.1 line in sync so sudo/hostname resolve cleanly.
  if grep -q '^127\.0\.1\.1' /etc/hosts; then
    sudo sed -i "s/^127\.0\.1\.1.*/127.0.1.1\t$MDNS_HOST/" /etc/hosts
  else
    echo -e "127.0.1.1\t$MDNS_HOST" | sudo tee -a /etc/hosts >/dev/null
  fi
  sudo hostname "$MDNS_HOST" 2>/dev/null || true
fi

echo "==> Advertise over mDNS (_skyview._tcp on :3000, path=/)"
if [ -d /etc/avahi ]; then
  sudo tee /etc/avahi/services/skyview.service >/dev/null <<'EOF'
<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">SkyView on %h</name>
  <service>
    <type>_skyview._tcp</type>
    <port>3000</port>
    <txt-record>path=/</txt-record>
  </service>
</service-group>
EOF
  sudo systemctl restart avahi-daemon 2>/dev/null || true
fi

echo "==> skyview systemd service"
sudo sed \
  -e "s#__USER__#$USER_NAME#g" \
  -e "s#__BIN__#$BIN_DST#g" \
  -e "s#__DATA__#$DATA_DIR#g" \
  "$SRC/skyview-server.service" | sudo tee /etc/systemd/system/skyview.service >/dev/null
sudo systemctl daemon-reload
# Coexist with a v1 baseline if present: free :3000 by stopping v1 (left INSTALLED as
# the rollback — `skyview-switch v1` brings it back without a reflash).
sudo systemctl disable --now skylight-server 2>/dev/null || true
sudo systemctl enable --now skyview.service
echo v2 | sudo tee /var/lib/skyview/active >/dev/null 2>&1 || true

IP="$(hostname -I | awk '{print $1}')"
echo
echo "Done."
echo "  Display : http://$MDNS_HOST.local:3000/   (or http://$IP:3000/ — settings are the ⚙ on-screen)"
echo "  Kiosk   : http://localhost:3000/?kiosk=1  (point Chromium here — setup-kiosk.sh)"
echo "  Decoder : http://$IP:8080/data/aircraft.json"
echo
echo "  Note: $MDNS_HOST.local needs mDNS/Bonjour on your client (built into macOS/iOS,"
echo "        Linux avahi, and Windows 10+); otherwise use the IP above."
echo
echo "Verify decode:  rtl_test -t   then   curl -s localhost:8080/data/aircraft.json | head"
echo "Operator:       skyview status | logs | restart | update now | health"
