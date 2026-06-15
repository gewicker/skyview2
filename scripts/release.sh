#!/usr/bin/env bash
# Cut a versioned GitHub release that the Pi's self-updater auto-installs. This is
# the hands-off path: tag the commit, build the arm64 asset + checksum, and publish.
# Every Pi on the `github` channel pulls it within ~10 minutes (verify + swap +
# health-check + rollback). Requires the GitHub CLI (`gh auth login`) once.
#
# Usage:  scripts/release.sh v2.0.0
set -euo pipefail

TAG="${1:?usage: release.sh <tag, e.g. v2.0.0>}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

echo "==> tagging $TAG"
git tag -a "$TAG" -m "SkyView $TAG" 2>/dev/null || echo "  (tag exists, reusing)"
git push origin "$TAG"

echo "==> building release asset"
make release

echo "==> publishing GitHub release $TAG"
gh release create "$TAG" \
  dist/skyview-linux-arm64 dist/skyview-linux-arm64.sha256 \
  --title "$TAG" --generate-notes

echo "Released $TAG. Pis on the github channel auto-update within ~10 min,"
echo "or force it now on the Pi:  skyview update now"
