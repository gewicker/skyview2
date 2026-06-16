#!/usr/bin/env bash
# Switch SkyView 2's self-updater to the GIT channel: every push to origin/main is
# fetched, built on the Pi (`make pi`), swapped in, health-checked, and auto-rolled
# back on failure — within the timer interval (~10 min), no kiosk interaction.
#
# Needs Go + Node/npm on the Pi (the binary embeds the freshly built web bundle).
# Run once on the Pi:  bash pi-setup/use-git-channel.sh
set -euo pipefail
SRC="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
APPDIR="${APPDIR:-$HOME/skyview2}"
BRANCH="${GIT_BRANCH:-main}"

command -v go  >/dev/null || { echo "Go is required on the Pi for the git channel."; exit 1; }
command -v npm >/dev/null || { echo "Node/npm is required on the Pi for the git channel."; exit 1; }
[ -d "$APPDIR/.git" ] || { echo "$APPDIR is not a git checkout. Clone the repo there first:"; echo "  git clone https://github.com/gewicker/skyview2 $APPDIR"; exit 1; }

echo "==> Point the updater at the git channel"
sudo mkdir -p /etc/skyview
sudo tee /etc/skyview/update.conf >/dev/null <<EOF
# SkyView update channel — build-on-device from the GitHub remote.
CHANNEL=git
APPDIR=$APPDIR
GIT_BRANCH=$BRANCH
BIN=/usr/local/bin/skyview-server
SERVICE=skyview
EOF

echo "==> Repo remote + branch"
git -C "$APPDIR" remote -v | sed -n '1p'
git -C "$APPDIR" rev-parse --abbrev-ref HEAD

echo "==> Ensure the update timer is installed + enabled"
[ -f /etc/systemd/system/skyview-update.timer ] || bash "$SRC/enable-auto-update.sh"
sudo systemctl daemon-reload
sudo systemctl enable --now skyview-update.timer

echo "==> Build + deploy the pending commit now"
/usr/local/bin/skyview-updater || true

echo "Done. Channel: git. Timer: $(systemctl is-active skyview-update.timer)."
echo "From now on, 'git push' auto-deploys to the Pi within ~10 minutes (auto-rollback on failure)."
