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

echo "==> apt update + base packages"
sudo apt-get update
sudo apt-get install -y git build-essential cmake libusb-1.0-0-dev pkg-config \
  libncurses-dev unclutter python3 curl

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
bash "$SRC/enable-auto-update.sh"
bash "$SRC/harden-pi.sh"          # watchdog + RAM logs + 2-min self-heal
# If we had no local binary, pull one now.
[ -x "$BIN_DST" ] || sudo /usr/local/bin/skyview-updater || true

echo "==> Advertise over mDNS (_skyview._tcp on :3000, path=/control.html)"
if [ -d /etc/avahi ]; then
  sudo tee /etc/avahi/services/skyview.service >/dev/null <<'EOF'
<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">SkyView on %h</name>
  <service>
    <type>_skyview._tcp</type>
    <port>3000</port>
    <txt-record>path=/control.html</txt-record>
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
sudo systemctl enable --now skyview.service

IP="$(hostname -I | awk '{print $1}')"
echo
echo "Done."
echo "  Display : http://localhost:3000/        (point the Chromium kiosk here — setup-kiosk.sh)"
echo "  Control : http://$IP:3000/control.html  (open on your phone)"
echo "  Decoder : http://$IP:8080/data/aircraft.json"
echo
echo "Verify decode:  rtl_test -t   then   curl -s localhost:8080/data/aircraft.json | head"
echo "Operator:       skyview status | logs | restart | update now | health"
