# SkyView 2

An always-on ADS-B aircraft display for the ceiling/wall — a clean-slate rewrite of
SkyView (v1 lived in the `skylight` repo). Tuned for a 10th-floor east-facing window
over I-405 in Bellevue, WA.

## Architecture

- **Backend — Go.** A single static binary with the web assets embedded
  (`go:embed`). Polls an ADS-B feed (radio + API supplement), enriches via adsbdb,
  serves a WebSocket hub + REST, and persists config/scenes/notable as atomic JSON.
  Cross-compiles to `linux/arm64` for the Pi; deploys as one file.
- **Frontend — TypeScript, React 18 + Vite.** The kiosk display (Canvas2D-first on a
  GL-ready renderer architecture) and the phone control panel, built from one
  iOS-grade design system.
- **Projection — canonical Web Mercator** for every layer (tiles, traffic, runways,
  approaches), so the basemap and aircraft register by construction.
- **Schema — one source of truth.** `internal/config` and `internal/msg` Go structs
  generate the TypeScript types (`tools/tygo.yaml`).

See `../skylight/V2-SPEC.md` for the full spec and the locked feature scope.

## Layout

```
cmd/skyview/        main — wires feed, enrich, stores, hub, http
internal/
  config/           Config struct (source of truth) + defaults + merge
  msg/              client/server WebSocket message types
  aircraft/         Aircraft snapshot type
  geo/              canonical Web Mercator projection
  feed/             ADS-B ingest (radio JSON + API supplement)   [stub]
  enrich/           adsbdb route/airline/type + bounded cache     [stub]
  notable/          emergency/military/rare detection
  store/            atomic JSON stores (config/scene/notable)
  hub/              WebSocket hub (broadcast + ping/pong)
  httpd/            REST routes + embedded web assets
web/                Vite + React + TS app (display + control)
tools/tygo.yaml     Go -> TS type generation
scripts/build.sh    build web, generate types, cross-compile arm64
```

## Build

```
make types     # generate web/src/shared/types.ts from Go structs
make web        # vite build -> web/dist
make pi         # cross-compile linux/arm64 with embedded assets -> bin/skyview
```

## Status

Phase 0 scaffold. Packages marked `[stub]` have interfaces + types but no
implementation yet. See the spec's phased plan.
