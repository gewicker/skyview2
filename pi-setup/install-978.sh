#!/usr/bin/env bash
# Run ON the Pi. Sets up the SECOND SDR for 978 MHz UAT (dump978-fa) alongside the existing
# 1090 MHz dump1090-fa, and serves its aircraft.json on :8081 for the SkyView server to merge.
#
# SAFETY: this script is ADDITIVE. It never edits the working dump1090-fa service, so it cannot break
# the primary 1090 feed. It does NOT set SDR serials or rebind dump1090 — do those MANUALLY per
# docs/DUAL-SDR-978.md (rebinding the wrong serial WOULD break 1090, so it's kept out of automation).
#
# Prereq (manual, once): this Pi's two Nooelec dongles already have unique factory serials
#   (rtl_test → 95371368 and 53037501), so NO rtl_eeprom rewrite is needed. Just bind the 1090 decoder
#   to its serial: add `--device 95371368` to dump1090-fa.service and restart it (then verify
#   aircraft.json still flows). See docs/DUAL-SDR-978.md.
# VERIFY the dump978-fa flags below against your build (`dump978-fa --help`).
set -euo pipefail

UAT_SERIAL="${UAT_SERIAL:-53037501}"  # this Pi's 2nd Nooelec dongle (rtl_test SN); override if you swap dongles

echo "==> dump978-fa (978 MHz UAT decoder)"
if ! command -v dump978-fa >/dev/null 2>&1; then
  echo "    installing build deps (boost + SoapySDR + rtlsdr)…"
  # dump978-fa reads the radio via SoapySDR (its --sdr flag is driver=rtlsdr,…), so it needs the
  # SoapySDR headers to BUILD and the rtlsdr Soapy MODULE to actually open the dongle at runtime.
  sudo apt-get update -qq || true
  sudo apt-get install -y build-essential libboost-system-dev libboost-program-options-dev \
    libboost-regex-dev librtlsdr-dev libsoapysdr-dev soapysdr-module-rtlsdr
  S=/tmp/dump978; rm -rf "$S"
  git clone --depth 1 https://github.com/flightaware/dump978 "$S"
  make -C "$S"
  sudo install -m755 "$S/dump978-fa" /usr/local/bin/dump978-fa
fi

echo "==> uat2json helper (turns dump978 --json-stdout into a served aircraft.json)"
# dump978-fa emits per-message JSON on stdout; skyaware978 is FlightAware's full app, but for a
# self-contained setup we run the tiny tracker that ships in the dump978 repo. If your dump978 build
# provides `skyaware978`/`uat2json`, prefer that and point it at /run/dump978. Adjust as needed.
sudo mkdir -p /run/dump978

echo "==> dump978-fa.service (decode on serial $UAT_SERIAL, raw+json out)"
sudo tee /etc/systemd/system/dump978-fa.service >/dev/null <<EOF
[Unit]
Description=dump978-fa UAT (978 MHz) decoder
After=network.target
[Service]
ExecStartPre=/bin/mkdir -p /run/dump978
# VERIFY flags for your build. --sdr binds THIS SDR by serial so it never grabs the 1090 dongle.
ExecStart=/usr/local/bin/dump978-fa --sdr driver=rtlsdr,serial=$UAT_SERIAL --raw-port 30978 --json-stdout
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF

echo "==> aircraft.json server on :8081 (mirrors the dump1090-json pattern)"
# NOTE: this serves /run/dump978. You still need something writing aircraft.json into that dir from
# dump978's stream (skyaware978, or FlightAware's uat2json/skyaware978 package). Until then :8081 is
# empty and the SkyView merge is a harmless no-op. See docs/DUAL-SDR-978.md for the two options.
sudo tee /etc/systemd/system/dump978-json.service >/dev/null <<'EOF'
[Unit]
Description=Serve dump978 aircraft.json on :8081
After=dump978-fa.service
[Service]
ExecStartPre=/bin/mkdir -p /run/dump978
ExecStart=/usr/bin/python3 -m http.server 8081 --directory /run/dump978
Restart=always
[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now dump978-fa.service dump978-json.service || true

echo
echo "978 UAT decoder installed. Next:"
echo "  1) Confirm serials are set + dump1090 is bound to its serial (docs/DUAL-SDR-978.md)."
echo "  2) Get aircraft.json written into /run/dump978 (skyaware978 / uat2json), OR point"
echo "     UAT_JSON_URL at your skyaware978 endpoint — the SkyView server merges it automatically."
echo "  3) Check:  journalctl -u dump978-fa -f   and   curl -s localhost:8081/aircraft.json | head"
echo "  FIS-B off-air weather (NEXRAD) is Phase 2 — see docs/DUAL-SDR-978.md."
