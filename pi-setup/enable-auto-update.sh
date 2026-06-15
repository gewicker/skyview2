#!/usr/bin/env bash
# Install SkyView's hands-off updater: the self-update script, a 10-minute timer,
# and a default config on the GitHub-release channel. Run from the repo root on
# the Pi (install-on-pi.sh calls this for you).
set -euo pipefail
SRC="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
U="$(id -un)"

echo "==> Installing the self-updater"
sudo install -m755 "$SRC/skyview-updater" /usr/local/bin/skyview-updater

if [ ! -f /etc/skyview/update.conf ]; then
  sudo mkdir -p /etc/skyview
  sudo tee /etc/skyview/update.conf >/dev/null <<EOF
# SkyView update channel.
#   CHANNEL=github   poll the latest GitHub release (no setup; needs internet)
#   CHANNEL=http     poll a manifest URL you publish: {"version","url","sha256"}
CHANNEL=github
REPO=gewicker/skyview2
ASSET=skyview-linux-arm64
BIN=/usr/local/bin/skyview-server
SERVICE=skyview
# UPDATE_URL=http://mypc.local:8099/skyview-manifest.json
EOF
fi

echo "==> Installing the update timer (every 10 min, runs as $U)"
sudo tee /etc/systemd/system/skyview-update.service >/dev/null <<EOF
[Unit]
Description=SkyView self-update
After=network-online.target skyview.service
Wants=network-online.target
[Service]
Type=oneshot
User=$U
ExecStart=/usr/local/bin/skyview-updater
EOF
sudo tee /etc/systemd/system/skyview-update.timer >/dev/null <<'EOF'
[Unit]
Description=Check for SkyView updates
[Timer]
OnBootSec=3min
OnUnitActiveSec=10min
Persistent=true
[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now skyview-update.timer
echo "Auto-update on. Channel: $(grep -E '^CHANNEL=' /etc/skyview/update.conf | cut -d= -f2)."
