#!/usr/bin/env bash
# Run ON the Pi. Scaffolds the FIS-B → NEXRAD decoder that feeds SkyView's off-air weather radar.
# The SkyView server + client are ALREADY wired for this (see docs/DUAL-RADIO-BUILD-PLAN.md): they read
# a georeferenced raster the decoder writes to $WX_DIR, and serve/render it at /api/wxradar. Until the
# decoder produces output, /api/wxradar returns {} and the map uses the online (RainViewer) radar — so
# this is safe and non-breaking.
#
# ADDITIVE + safe: never touches dump1090/dump978. Prereq: the 978 pipeline is up and RECEIVING
# (dump978-fa raw stream on :30978 carrying UAT UPLINK/FIS-B frames — the continuous ground broadcast).
set -euo pipefail

WX_DIR="${WX_DIR:-/run/dump978/wx}"   # must match the server's WXRADAR_DIR (default /run/dump978/wx)
RAW="${RAW:-localhost:30978}"          # dump978-fa raw UAT port

echo "==> deps (python + raster libs)"
sudo apt-get update -qq || true
sudo apt-get install -y python3 python3-pip python3-numpy python3-pil || true

echo "==> output dir $WX_DIR"
sudo mkdir -p "$WX_DIR"

# ------------------------------------------------------------------------------------------------
# THE DECODER (the one piece to finish against LIVE reception — it can't be verified without FIS-B).
#
# Its ONLY contract with SkyView (v1) — write two files into $WX_DIR, refreshed every ~1-2 min:
#   nexrad.png   — reflectivity, transparent where no data, colored on the standard dBZ ramp.
#   nexrad.json  — {"bounds":[north,south,east,west], "time":<epoch ms>, "kind":"regional|conus"}
# `bounds` are the lat/lon corners the PNG spans; SkyView draws the image over that box. That's it —
# get those two files right and off-air radar lights up on the map automatically.
#
# Recommended decoder: an existing FIS-B product decoder rather than hand-rolling APDU/block assembly.
# Feed it dump978-fa's raw uplink ($RAW). Candidates to evaluate on-device:
#   • FlightAware dump978's own uplink tooling, or a community FIS-B decoder (e.g. a "fisb"/"fisb-978"
#     project) that emits NEXRAD as an image + geographic extent.
#   • Then a tiny adapter re-projects/re-colors to the contract above and writes $WX_DIR atomically
#     (write to nexrad.png.tmp / nexrad.json.tmp then rename, so the server never reads a half-file).
#
# Wire it as a service once you have a decoder command:
#   sudo tee /etc/systemd/system/skyview-fisb.service >/dev/null <<EOF
#   [Unit]
#   Description=SkyView FIS-B NEXRAD decoder
#   After=dump978-fa.service
#   Requires=dump978-fa.service
#   [Service]
#   ExecStartPre=/bin/mkdir -p $WX_DIR
#   ExecStart=/usr/local/bin/skyview-fisb --connect $RAW --out $WX_DIR   # <-- your decoder command
#   Nice=15
#   Restart=always
#   RestartSec=10
#   [Install]
#   WantedBy=multi-user.target
#   EOF
#   sudo systemctl daemon-reload && sudo systemctl enable --now skyview-fisb
# ------------------------------------------------------------------------------------------------

echo
echo "Scaffold ready. $WX_DIR is set and the server serves /api/wxradar from it."
echo "Finish the decoder (contract above) → nexrad.png + nexrad.json → off-air radar goes live."
echo "Verify:  curl -s localhost:3000/api/wxradar   (returns {} until the decoder writes a product)"
