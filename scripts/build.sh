#!/usr/bin/env bash
# Build the SkyView 2 Pi binary: build the web bundle into the embed dir, then
# cross-compile a static linux/arm64 binary with the assets baked in.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> web build"
( cd web && npm install && npm run build )

echo "==> cross-compile linux/arm64"
mkdir -p bin
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="-s -w" \
  -o bin/skyview ./cmd/skyview

echo "==> done: bin/skyview ($(du -h bin/skyview | cut -f1))"
echo "Deploy: scp bin/skyview pi@skyview.local:~/ && ssh pi@skyview.local 'systemctl --user restart skyview'"
