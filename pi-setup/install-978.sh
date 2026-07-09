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

echo "==> dump978-fa + skyaware978 (978 UAT decoder + aircraft.json writer)"
# The flightaware/dump978 repo builds BOTH: dump978-fa (decoder) and skyaware978 (reads the raw
# stream, tracks aircraft, writes aircraft.json) — so the full pipeline is self-contained, no
# separate package. Rebuild if either binary is missing (deps are cached, so re-runs are quick).
if ! command -v dump978-fa >/dev/null 2>&1 || ! command -v skyaware978 >/dev/null 2>&1; then
  echo "    installing build deps (boost + SoapySDR + rtlsdr)…"
  # dump978-fa reads the radio via SoapySDR (its --sdr flag is driver=rtlsdr,…), so it needs the
  # SoapySDR headers to BUILD and the rtlsdr Soapy MODULE to actually open the dongle at runtime.
  sudo apt-get update -qq || true
  sudo apt-get install -y build-essential libboost-system-dev libboost-program-options-dev \
    libboost-regex-dev libboost-filesystem-dev librtlsdr-dev libsoapysdr-dev soapysdr-module-rtlsdr
  S=/tmp/dump978; rm -rf "$S"
  git clone --depth 1 https://github.com/flightaware/dump978 "$S"
  make -C "$S"
  sudo install -m755 "$S/dump978-fa" /usr/local/bin/dump978-fa
  sudo install -m755 "$S/skyaware978" /usr/local/bin/skyaware978
fi
sudo mkdir -p /run/dump978

echo "==> dump978-fa.service (decode on serial $UAT_SERIAL → raw stream on :30978)"
sudo tee /etc/systemd/system/dump978-fa.service >/dev/null <<EOF
[Unit]
Description=dump978-fa UAT (978 MHz) decoder
After=network.target
[Service]
# --sdr binds THIS SDR by serial so it never grabs the 1090 dongle. Raw UAT frames go to :30978,
# which skyaware978 consumes. (Verify flags with 'dump978-fa --help' if your build differs.)
ExecStart=/usr/local/bin/dump978-fa --sdr driver=rtlsdr,serial=$UAT_SERIAL --raw-port 30978
# Low priority: the 978 SDR must yield to the bedside display + the primary 1090 decode.
Nice=10
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF

echo "==> skyaware978.service (raw :30978 → /run/dump978/aircraft.json)"
sudo tee /etc/systemd/system/skyaware978.service >/dev/null <<'EOF'
[Unit]
Description=skyaware978 UAT tracker (writes aircraft.json)
After=dump978-fa.service
Requires=dump978-fa.service
[Service]
ExecStartPre=/bin/mkdir -p /run/dump978
# --json-dir (NOT --output) is the correct flag for skyaware978.
ExecStart=/usr/local/bin/skyaware978 --connect localhost:30978 --reconnect-interval 30 --json-dir /run/dump978
Nice=10
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF

echo "==> aircraft.json server on :8081 (mirrors the dump1090-json pattern)"
sudo tee /etc/systemd/system/dump978-json.service >/dev/null <<'EOF'
[Unit]
Description=Serve dump978 aircraft.json on :8081
After=skyaware978.service
[Service]
ExecStartPre=/bin/mkdir -p /run/dump978
ExecStart=/usr/bin/python3 -m http.server 8081 --directory /run/dump978
Restart=always
[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now dump978-fa.service skyaware978.service dump978-json.service || true

echo
echo "978 UAT pipeline installed (dump978-fa → skyaware978 → :8081). Next:"
echo "  1) Bind dump1090 to serial 95371368 (docs/DUAL-SDR-978.md) so the two SDRs don't fight."
echo "  2) Check:  systemctl status dump978-fa skyaware978 --no-pager"
echo "            curl -s localhost:8081/aircraft.json | head -c 300"
echo "     The SkyView server merges :8081 automatically — UAT traffic will just appear."
echo "  3) FIS-B off-air weather (NEXRAD) is Phase 2 — see docs/DUAL-SDR-978.md."
