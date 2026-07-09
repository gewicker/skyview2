#!/usr/bin/env bash
# Run ON the Pi, AFTER pi-setup/install-978.sh (native UAT chain) is up and RECEIVING.
# Turns on SkyView's off-air FIS-B NEXRAD weather: it upgrades the UAT pipeline to also feed
# mutability/dump978's `extract_nexrad` into a small raster decoder that writes SkyView's weather
# contract (nexrad.png + nexrad.json) — which the server already serves at /api/wxradar and the
# client already draws over the map (preferring it while fresh, else online RainViewer).
#
# SAFE + additive: shares the ONE rtl_sdr|dump978 stream via `tee`, so traffic keeps flowing; if the
# decoder writes nothing (no weather / not receiving), /api/wxradar returns {} and the map uses online
# radar. Never touches dump1090.
#
# WHY this is now buildable (2026-07-09): moving 978 to the native mutability/dump978 chain (see
# install-978.sh, because dump978-fa/SoapySDR wouldn't lock the tuner) gave us `extract_nexrad` for
# free — the FIS-B NEXRAD block decoder — so no third-party FIS-B project is needed.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WX_DIR="${WX_DIR:-/run/dump978/wx}"     # must match the server's WXRADAR_DIR (default /run/dump978/wx)
JSON_DIR="${JSON_DIR:-/run/dump978}"

echo "==> prereq: extract_nexrad (built by install-978.sh from mutability/dump978)"
if ! command -v extract_nexrad >/dev/null 2>&1; then
  echo "!! extract_nexrad not found. Run pi-setup/install-978.sh first (it builds it)." >&2
  exit 1
fi

echo "==> deps (Pillow for the raster) + output dir"
sudo apt-get update -qq || true
sudo apt-get install -y python3-pil
sudo mkdir -p "$WX_DIR"

echo "==> install the raster decoder /usr/local/bin/skyview-fisb-nexrad.py"
sudo install -m755 "$HERE/skyview-fisb-nexrad.py" /usr/local/bin/skyview-fisb-nexrad.py

echo "==> upgrade the UAT wrapper: tee dump978 frames to BOTH uat2json (traffic) and the NEXRAD decoder"
sudo tee /usr/local/bin/skyview-uat978.sh >/dev/null <<'WRAP'
#!/usr/bin/env bash
# Native UAT pipeline WITH off-air weather. One rtl_sdr owns the dongle; dump978 demods; `tee` fans the
# frames to uat2json (aircraft.json / traffic) AND onward to extract_nexrad -> the raster decoder
# (nexrad.png/json / weather). --output-error=warn so a hiccup in one branch never stalls the other.
set -euo pipefail
UAT_SERIAL="${UAT_SERIAL:-53037501}"
UAT_GAIN="${UAT_GAIN:-48.0}"
UAT_PPM="${UAT_PPM:-0}"
JSON_DIR="${JSON_DIR:-/run/dump978}"
WX_DIR="${WX_DIR:-/run/dump978/wx}"
mkdir -p "$JSON_DIR" "$WX_DIR"
rtl_sdr -d "$UAT_SERIAL" -f 978000000 -s 2083334 -g "$UAT_GAIN" -p "$UAT_PPM" - \
  | dump978 \
  | tee --output-error=warn >(uat2json "$JSON_DIR" >/dev/null 2>&1) \
  | extract_nexrad \
  | skyview-fisb-nexrad.py --out "$WX_DIR"
WRAP
sudo chmod +x /usr/local/bin/skyview-uat978.sh

echo "==> restart the pipeline"
sudo systemctl restart skyview-uat978.service

echo
echo "Off-air NEXRAD wired. It lights up when FIS-B uplink carries a radar product for the region."
echo "Verify:"
echo "  • decoder is getting blocks (bursty — a few per minute when weather is being broadcast):"
echo "      sudo systemctl stop skyview-uat978"
echo "      rtl_sdr -d \${UAT_SERIAL:-53037501} -f 978000000 -s 2083334 -g 48 - | dump978 | extract_nexrad | head"
echo "      sudo systemctl start skyview-uat978"
echo "  • product files:   ls -l $WX_DIR   (nexrad.png + nexrad.json appear once a product is decoded)"
echo "  • server sees it:  curl -s localhost:3000/api/wxradar   ({} until a product exists, then {url,bounds,time,age})"
echo "  • Tuning (optional, via the service Environment): WX_BOUNDS=\"N,S,E,W\", WX_KINDS=regional,conus,"
echo "    WX_MIN_INTENSITY (1 shows light rain), WX_PX_PER_DEG."
