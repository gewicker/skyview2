#!/usr/bin/env bash
# Quick reception check for both radios.  Run:  bash pi-setup/radio-check.sh
# Shows the live message RATE (the real health signal) for 1090 ES (dump1090 -> :8080) and, if the
# 978 UAT pipeline is running, for 978 (dump978 -> :8081). Rate, not the cumulative total, is what
# tells you if an antenna is actually receiving right now.
set -uo pipefail

num() { sed -n 's/.*"messages"[^0-9]*\([0-9][0-9]*\).*/\1/p' | head -1; }

rate() {  # $1 = aircraft.json URL ; prints "N msg/s (total M)" over a 10s window
  local url="$1" a b
  a=$(curl -s "$url" | num); sleep 10; b=$(curl -s "$url" | num)
  if [ -z "${a:-}" ] || [ -z "${b:-}" ]; then echo "no data (decoder/server down)"; return; fi
  echo "$(( (b - a) / 10 )) msg/s   (total $b)"
}

echo "== 1090 ES  (dump1090 :8080) =="
if curl -sf localhost:8080/aircraft.json >/dev/null 2>&1; then
  printf "  rate: %s\n" "$(rate http://localhost:8080/aircraft.json)"
  echo "  aircraft now: $(curl -s localhost:8080/aircraft.json | grep -c '\"hex\"')"
else
  echo "  :8080 not responding (dump1090-json down)"
fi

echo "== 978 UAT  (dump978 :8081) =="
if systemctl is-active --quiet skyview-uat978 && curl -sf localhost:8081/aircraft.json >/dev/null 2>&1; then
  printf "  rate: %s\n" "$(rate http://localhost:8081/aircraft.json)"
  echo "  aircraft now: $(curl -s localhost:8081/aircraft.json | grep -c '\"hex\"')"
else
  echo "  978 pipeline not running (skyview-uat978 is parked). To listen directly for ~20s:"
  echo "    sudo systemctl stop skyview-uat978 2>/dev/null; timeout 20 rtl_sdr -d 53037501 -f 978000000 -s 2083334 -g 48 - | dump978 | uat2text"
fi

echo
echo "Reading it: near a metro a healthy 1090 antenna = HUNDREDS+ msg/s and dozens of aircraft."
echo "0 msg/s with the dongle enumerating fine (journalctl -u dump1090-fa) = antenna/coax, not software."
