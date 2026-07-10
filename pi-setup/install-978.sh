#!/usr/bin/env bash
# Run ON the Pi. Sets up the SECOND SDR for 978 MHz UAT on the NATIVE librtlsdr path
# (rtl_sdr | dump978 | uat2json) — the SAME driver stack that already decodes 1090 — NOT SoapySDR.
#
# WHY NATIVE (decided 2026-07-09): FlightAware's dump978-fa talks to the radio ONLY through
# SoapySDR's rtlsdr module, and on this Pi that path never locks the tuner PLL — it opens the
# dongle, streams, but decodes ZERO UAT frames. Proven on BOTH dongles (including the known-good
# 1090 stick), so it's the SoapySDR layer, not the hardware. dump1090 works because it uses native
# librtlsdr. So we decode UAT with mutability/dump978 fed by native `rtl_sdr`, sidestepping SoapySDR
# entirely. Bonus: mutability/dump978 also builds `extract_nexrad` — the FIS-B NEXRAD decoder the
# off-air weather pipeline needs (see pi-setup/install-fisb.sh).
#
# SAFETY: ADDITIVE. Never edits the working dump1090-fa service. Binds THIS SDR by serial so it can
# never grab the 1090 dongle. The dump1090 serial rebind stays MANUAL (docs/DUAL-SDR-978.md) — that's
# the one step that can disturb the working 1090 feed.
set -euo pipefail

UAT_SERIAL="${UAT_SERIAL:-53037501}"   # 2nd Nooelec (rtl_test SN). rtl_sdr -d matches by serial
                                       # when the string isn't a valid device index (same as dump1090's --device).
UAT_GAIN="${UAT_GAIN:-48.0}"           # near-max fixed gain suits UAT; tune later if the front-end overloads.
UAT_PPM="${UAT_PPM:-0}"                # frequency correction (ppm) if you've measured it.
JSON_DIR="${JSON_DIR:-/run/dump978}"   # where uat2json writes aircraft.json (served on :8081).
SRC="${SRC:-/tmp/dump978-mut}"

echo "==> deps (NATIVE rtl-sdr + build tools — no Boost, no SoapySDR)"
sudo apt-get update -qq || true
sudo apt-get install -y build-essential librtlsdr-dev rtl-sdr

echo "==> build mutability/dump978  (dump978 + uat2json + uat2text + extract_nexrad)"
# Rebuild only if a binary is missing (fast re-runs). This is the ORIGINAL dump978 that reads 8-bit
# I/Q on stdin — the classic native chain, not the SoapySDR reimplementation.
if ! command -v dump978 >/dev/null 2>&1 || ! command -v uat2json >/dev/null 2>&1 \
   || ! command -v extract_nexrad >/dev/null 2>&1; then
  rm -rf "$SRC"
  git clone --depth 1 https://github.com/mutability/dump978 "$SRC"
  make -C "$SRC"
  sudo install -m755 "$SRC/dump978"        /usr/local/bin/dump978
  sudo install -m755 "$SRC/uat2json"       /usr/local/bin/uat2json
  sudo install -m755 "$SRC/uat2text"       /usr/local/bin/uat2text
  sudo install -m755 "$SRC/extract_nexrad" /usr/local/bin/extract_nexrad
fi
sudo mkdir -p "$JSON_DIR"

echo "==> retire the SoapySDR path if it's present (it never locked the PLL on this Pi)"
# Old dump978-fa/skyaware978 units, if a previous install created them, are disabled so they don't
# fight for the dongle. Harmless if they don't exist.
sudo systemctl disable --now dump978-fa.service skyaware978.service 2>/dev/null || true

echo "==> wrapper /usr/local/bin/skyview-uat978.sh  (rtl_sdr -> dump978 -> uat2json)"
sudo tee /usr/local/bin/skyview-uat978.sh >/dev/null <<'WRAP'
#!/usr/bin/env bash
# Native UAT traffic pipeline. rtl_sdr streams 8-bit I/Q at the UAT sample rate into dump978 (demod),
# whose frames feed uat2json (writes aircraft.json). pipefail so a dead stage fails the unit -> restart.
# NOTE: install-fisb.sh REPLACES this wrapper with a tee'd version that also feeds extract_nexrad for
# off-air weather; this traffic-only form is the safe first stage (bring up + prove reception first).
set -euo pipefail
UAT_SERIAL="${UAT_SERIAL:-53037501}"
UAT_GAIN="${UAT_GAIN:-48.0}"
UAT_PPM="${UAT_PPM:-0}"
JSON_DIR="${JSON_DIR:-/run/dump978}"
mkdir -p "$JSON_DIR"
# rtl_sdr -d matches by serial; -f 978 MHz; -s 2083334 = UAT rate; '-' = raw I/Q to stdout.
rtl_sdr -d "$UAT_SERIAL" -f 978000000 -s 2083334 -g "$UAT_GAIN" -p "$UAT_PPM" - \
  | dump978 \
  | uat2json "$JSON_DIR"
WRAP
sudo chmod +x /usr/local/bin/skyview-uat978.sh

echo "==> skyview-uat978.service (the native UAT pipeline)"
sudo tee /etc/systemd/system/skyview-uat978.service >/dev/null <<EOF
[Unit]
Description=SkyView 978 UAT (native rtl_sdr | dump978 | uat2json)
After=network.target
# Stop thrashing on a hard fault (dongle unplugged, wrong serial): after 5 restarts in 60s the unit
# enters 'failed' and surfaces in status instead of restart-looping every 5s forever.
StartLimitIntervalSec=60
StartLimitBurst=5
[Service]
Environment=UAT_SERIAL=$UAT_SERIAL UAT_GAIN=$UAT_GAIN UAT_PPM=$UAT_PPM JSON_DIR=$JSON_DIR
# WX_DIR is used only after install-fisb.sh upgrades the wrapper to tee frames into the NEXRAD
# decoder; harmless (ignored) in this traffic-only stage. Must match the server's WXRADAR_DIR.
Environment=WX_DIR=/run/dump978/wx
ExecStart=/usr/local/bin/skyview-uat978.sh
# Low priority: the 978 SDR must yield to the bedside display + the primary 1090 decode.
Nice=10
# Confine the whole UAT DSP chain to cores 2-3 so it can never crowd the display/Go on 0-1 (Pi 5 = 4
# cores). Tunable/removable; the chain is ~1 core total so 2 cores is ample. NOT CPUQuota — throttling
# dump978 below real-time drops UAT samples rather than saving anything useful.
CPUAffinity=2 3
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF

echo "==> dump978-json.service (serve aircraft.json on :8081 for the SkyView server to merge)"
sudo tee /etc/systemd/system/dump978-json.service >/dev/null <<EOF
[Unit]
Description=Serve dump978 aircraft.json on :8081
After=skyview-uat978.service
[Service]
ExecStartPre=/bin/mkdir -p $JSON_DIR
# --bind 127.0.0.1: the SkyView server reads this over localhost, so there's no reason to expose
# aircraft.json LAN-wide (http.server otherwise binds 0.0.0.0).
ExecStart=/usr/bin/python3 -m http.server 8081 --bind 127.0.0.1 --directory $JSON_DIR
Restart=always
[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now skyview-uat978.service dump978-json.service || true

echo
echo "978 UAT (native) installed. Verify:"
echo "  1) Reception (decoded UAT — uplink FIS-B is continuous, downlink aircraft are sparse):"
echo "       sudo systemctl stop skyview-uat978"
echo "       rtl_sdr -d $UAT_SERIAL -f 978000000 -s 2083334 -g $UAT_GAIN - | dump978 | uat2text | head"
echo "       sudo systemctl start skyview-uat978"
echo "     Look for 'PLL not locked' to be GONE and decoded messages to scroll. (No SoapySDR now.)"
echo "  2) Traffic JSON:  curl -s localhost:8081/aircraft.json | head -c 300"
echo "     The SkyView server merges :8081 automatically — UAT/TIS-B contacts just appear."
echo "  3) Bind dump1090 to serial 95371368 (docs/DUAL-SDR-978.md) so the two SDRs never fight."
echo "  4) Off-air NEXRAD weather: run pi-setup/install-fisb.sh (adds extract_nexrad + the raster decoder)."
