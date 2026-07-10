#!/usr/bin/env bash
# Run ON the Pi. Adds MLAT (multilateration) so NON-ADS-B aircraft — older jets, military, GA that only
# reply to secondary radar (Mode S/A/C) — appear on the SkyView map. This is the highest-value "busier
# map" upgrade for the second radio's role, and it works off the WORKING 1090 feed (independent of 978).
#
# HOW IT FITS SkyView (no server change needed): mlat-client forwards your 1090 Mode-S timing to an
# aggregator's MLAT server; the server multilaterates positions from many receivers and returns them; we
# inject those results back into dump1090-fa (Beast on :30104), which then includes them in its
# aircraft.json (tagged "mlat"). SkyView already reads that aircraft.json, so MLAT targets just appear.
#
# YOU MUST PROVIDE (MLAT needs them — DO NOT guess a location, timing math depends on it):
#   RECEIVER_LAT, RECEIVER_LON  — your antenna's exact latitude/longitude (decimal degrees)
#   RECEIVER_ALT                — antenna height above sea level, meters (e.g. 60) or feet ("197ft")
#   MLAT_USER                   — a handle the aggregator shows for your receiver
#   MLAT_SERVER                 — the aggregator's MLAT server host:port (see docs/MLAT-SETUP.md)
# PRIVACY: MLAT requires FEEDING your receiver location + heard aircraft to an aggregator (that's how
# multilateration works — many receivers cooperate). Only run this if you're OK sharing that. See the doc.
#
# SAFE + additive: never touches the 978 pipeline; only READS dump1090's Beast output and injects MLAT
# results back. If the server/feed is down, mlat-client just retries — no effect on the local 1090 map.
set -euo pipefail

: "${RECEIVER_LAT:?set RECEIVER_LAT (decimal deg) — see docs/MLAT-SETUP.md}"
: "${RECEIVER_LON:?set RECEIVER_LON (decimal deg)}"
: "${RECEIVER_ALT:?set RECEIVER_ALT (meters, or e.g. 197ft)}"
: "${MLAT_USER:?set MLAT_USER (a handle for your receiver)}"
: "${MLAT_SERVER:?set MLAT_SERVER (aggregator MLAT host:port — see docs/MLAT-SETUP.md)}"

BEAST_IN="${BEAST_IN:-127.0.0.1:30005}"    # dump1090-fa Beast OUTPUT (mlat-client reads timing here)
RESULTS="${RESULTS:-beast,connect,127.0.0.1:30104}"  # inject results into dump1090 Beast INPUT :30104
VENV="${VENV:-/usr/local/share/wiedehopf-mlat-client/venv}"
SRC="${SRC:-/tmp/mlat-client-src}"

echo "==> sanity: dump1090-fa must expose Beast output on ${BEAST_IN} and accept Beast input on :30104"
host="${BEAST_IN%:*}"; port="${BEAST_IN##*:}"
if timeout 2 bash -c "exec 3<>/dev/tcp/$host/$port" 2>/dev/null; then
  echo "    Beast output reachable at $BEAST_IN ✓"
else
  echo "    !! Can't reach $BEAST_IN. Ensure dump1090-fa runs with --net (FlightAware's service does;" >&2
  echo "       it exposes 30005 Beast-out + 30104 Beast-in). Fix that, then re-run." >&2
  exit 1
fi

echo "==> build mlat-client into a venv (wiedehopf fork; isolated to avoid package name clashes)"
if [ ! -x "$VENV/bin/mlat-client" ]; then
  sudo apt-get update -qq || true
  sudo apt-get install -y git python3-venv python3-dev build-essential
  rm -rf "$SRC"
  git clone --depth 1 https://github.com/wiedehopf/mlat-client "$SRC"
  sudo rm -rf "$VENV"; sudo mkdir -p "$(dirname "$VENV")"
  sudo python3 -m venv "$VENV"
  sudo "$VENV/bin/python3" -m pip install -q --upgrade pip setuptools pyasyncore
  sudo "$VENV/bin/pip" install -q "$SRC"
fi
echo "    mlat-client: $("$VENV/bin/mlat-client" --help >/dev/null 2>&1 && echo ok)"

echo "==> skyview-mlat.service (feed timing -> aggregator -> inject results into dump1090)"
sudo tee /etc/systemd/system/skyview-mlat.service >/dev/null <<EOF
[Unit]
Description=SkyView MLAT client (non-ADS-B aircraft via multilateration)
After=network-online.target dump1090-fa.service
Wants=network-online.target
# Don't thrash if the aggregator is unreachable or misconfigured.
StartLimitIntervalSec=120
StartLimitBurst=5
[Service]
ExecStart=$VENV/bin/mlat-client \\
  --input-type dump1090 --input-connect $BEAST_IN \\
  --lat $RECEIVER_LAT --lon $RECEIVER_LON --alt $RECEIVER_ALT \\
  --user $MLAT_USER --server $MLAT_SERVER \\
  --results $RESULTS --no-udp
# MLAT is secondary to the primary decode + display.
Nice=10
Restart=always
RestartSec=30
[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now skyview-mlat.service

echo
echo "MLAT installed. Verify:"
echo "  • client health:   journalctl -u skyview-mlat -f   (look for 'synchronized with N nearby receivers')"
echo "  • MLAT targets:    curl -s localhost:8080/aircraft.json | grep -c '\"mlat\"'   (once the server has"
echo "                     enough receivers hearing the same aircraft — can take minutes, needs neighbors)"
echo "  • On the map they appear as normal contacts. (Optional later: a faint 'mlat' style — see backlog.)"
echo "  NOTE: MLAT only resolves aircraft heard by >=3-4 receivers at once, so yield depends on how many"
echo "  neighbors your aggregator has near you. Expect a modest but real set of extra (non-ADS-B) targets."
