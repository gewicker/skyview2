# SkyView v7 — Dual-Radio & Off-Air Weather

The headline of v7 is the **second SDR** earning its keep: alongside 1090 MHz ES traffic, SkyView now
ingests **978 MHz UAT** and is built end-to-end for **FIS-B off-air NEXRAD weather** — a live radar
picture on the map with **no internet required**. Design + full runbook: `docs/DUAL-RADIO-BUILD-PLAN.md`.

---

## Off-air weather radar (FIS-B NEXRAD) — the flagship

The whole software pipeline is shipped and dormant-safe; it lights up the moment the on-device decoder
produces a product, and needs zero app changes to do so:

- **Server (`internal/feed/wxradar.go`, `/api/wxradar`).** Reads the decoder's georeferenced raster
  (`nexrad.png` + `nexrad.json{bounds,time}`) from `$WXRADAR_DIR` (default `/run/dump978/wx`) and serves
  it: `GET /api/wxradar` → `{url, bounds:[N,S,E,W], time, age}` (or `{}` when none), and
  `GET /api/wxradar/nexrad.png` → the raster. Graceful with no second radio — returns `{}`.
- **Client (`RadarLayer` + `radar.ts`).** Adds an **off-air source**: when a fresh FIS-B raster exists
  (< 10 min old) it's drawn — a single georeferenced image through the same Web-Mercator affine the map
  uses, so precip registers with the traffic and aircraft still paint on top. When it's absent or stale,
  the existing keyless **RainViewer online** radar carries on. Reuses the `showRadar` toggle + opacity;
  cache-busts on product time so new frames refresh.
- **Contract v1** (decoder ↔ server ↔ client decoupled): the decoder writes `nexrad.png` (dBZ-ramp,
  transparent where no data) + `nexrad.json` (`bounds`/`time`/`kind`) to `$WXRADAR_DIR`. That's the only
  seam — change the decoder without touching the app.
- **Finishing step:** the FIS-B → raster decoder is the one piece that must be built against *live* 978
  reception (it can't be verified blind). `pi-setup/install-fisb.sh` scaffolds the deps, output dir, and
  a service template around the contract.

## 978 UAT traffic

The server merges a second `aircraft.json` (`dump978-fa` → `skyaware978` → `:8081`, env `UAT_JSON_URL`)
into the 1090 feed by hex/freshness — so UAT and TIS-B/ADS-R contacts appear automatically. Safe no-op
when the 978 pipeline is down.

## Dual-SDR foundation

`pi-setup/install-978.sh` builds `dump978-fa` + `skyaware978` from source and stands up the 978 pipeline
(serial-bound to `53037501`, `Nice=10` so it yields to the display + 1090). Serial binding keeps the two
identical dongles from fighting; the hardware watchdog + Wi-Fi self-heal from the v6 hardening keep the
appliance durable. Currently **parked** (disabled) until the off-air weather is being used —
`sudo systemctl enable --now dump978-fa skyaware978 dump978-json` to bring it back.

---

## Also in this line (carried from v6, all live)
Airport View phase 1 (`/airport` top-down KSEA + the map doorway) and the modularity fork-isolation;
AeroDataBox quota fix (rolling budget) + circuit breaker + `/api/enrich` health/probe; the design-review
+ bug-scrub pass (featured-plane strobe, coreDim floor, mid-tunnel train dir, NaN guards); the Vitest
regression net; bus route-reveal redesign; ferry velocity-glide; Harborview helipad; and the bedside
usability P0s (persistent mute/settings, night-themed chrome/cards, reachable dismiss, first-run hint).

## To finish v7
1. Re-enable + confirm 978 **reception** (continuous FIS-B uplink frames on `:30978`).
2. Build the FIS-B decoder to the `/api/wxradar` contract (`install-fisb.sh` scaffold) — off-air radar
   goes live on the map.
3. Optional: a `radarSource` toggle (auto/off-air/online) + status line; faint styling for TIS-B
   "shadow" targets. Then tag `v7`.
