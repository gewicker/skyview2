#!/usr/bin/env bash
# Build the arm64 binary and push it STRAIGHT to the Pi over SSH (no GitHub, no
# polling) — the fast path for active iteration. v2 ships one static binary, so this
# is just: cross-compile -> scp -> install -> restart -> health-check. (v1 had to
# rsync the whole tree and rebuild on the Pi; this removes that.)
#
# For hands-off background updates instead, cut a GitHub release (scripts/release.sh)
# and let the Pi's self-updater pull it — see pi-setup/skyview-updater.
#
# Configure via env:
#   PI_HOST   (default skyview.local)
#   PI_USER   (default skyview)
#   SSH_KEY   (default ~/.ssh/skyview_ed25519)
set -euo pipefail

PI_HOST="${PI_HOST:-skyview.local}"
PI_USER="${PI_USER:-skyview}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/skyview_ed25519}"
SSH="ssh -i $SSH_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
REPO="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> build web + cross-compile linux/arm64"
( cd "$REPO" && make release )

echo "==> scp binary -> $PI_USER@$PI_HOST"
scp -i "$SSH_KEY" "$REPO/dist/skyview-linux-arm64" "$PI_USER@$PI_HOST:/tmp/skyview.new"

echo "==> install + restart on the Pi"
# shellcheck disable=SC2087
$SSH "$PI_USER@$PI_HOST" '
  set -e
  sudo install -m755 /tmp/skyview.new /usr/local/bin/skyview-server
  rm -f /tmp/skyview.new
  sudo systemctl restart skyview
  for _ in $(seq 1 15); do
    curl -fsS http://localhost:3000/api/health >/dev/null 2>&1 && { echo "  healthy"; break; }
    sleep 1
  done
'
echo "Done -> http://$PI_HOST:3000/  (control: http://$PI_HOST:3000/control.html)"
