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
- **Decoder — BUILT (`pi-setup/skyview-fisb-nexrad.py`).** Reads mutability/dump978's `extract_nexrad`
  block lines (`NEXRAD Regional hh:mm scale north west height width <128 intensity digits>`), paints each
  block's 32×4 bins onto one equirectangular RGBA raster over a fixed PNW box on a dBZ ramp (intensity 0–1
  transparent so empty-block synthesis doesn't wash the map; precip 2–7 colored), expires stale blocks,
  and writes `nexrad.png`/`nexrad.json` atomically — exactly the contract. Geometry + output verified
  against synthetic blocks (arcmin→deg, west 0–360 fold, bin→pixel all correct). Lights up on *live* 978
  reception; can't be exercised without FIS-B in the air, but it's no longer a blind scaffold.

## 978 UAT — NATIVE librtlsdr chain (not SoapySDR)

The RF front end is the **native** `rtl_sdr | dump978 | uat2json` (mutability/dump978), the same driver
stack that decodes 1090 — **not** `dump978-fa`, which only speaks SoapySDR and (proven 2026-07-09) will
not lock the tuner PLL on this Pi, decoding zero frames on *both* dongles including the known-good 1090
stick. The server merges the second `aircraft.json` (`:8081`, env `UAT_JSON_URL`) into the 1090 feed by
hex/freshness — UAT and TIS-B/ADS-R contacts appear automatically. `uat2json` emits the older dump1090
field names, so the server parser now also reads `altitude`/`speed`/`vert_rate` as fallbacks (additive;
1090 unaffected). Safe no-op when the 978 pipeline is down.

## Dual-SDR foundation

`pi-setup/install-978.sh` builds mutability/dump978 (`dump978` + `uat2json` + `extract_nexrad`) from
source over native `librtlsdr`/`rtl-sdr` (no Boost, no SoapySDR) and stands up the pipeline (serial-bound
to `53037501`, `Nice=10` so it yields to the display + 1090). Serial binding keeps the two identical
dongles from fighting; the hardware watchdog + Wi-Fi self-heal from v6 keep the appliance durable.
`pi-setup/install-fisb.sh` then upgrades the wrapper to `tee` the demod frames into `extract_nexrad` →
the raster decoder, turning on off-air weather. Bring it up with `sudo bash pi-setup/install-978.sh`
(traffic first), confirm reception, then `sudo bash pi-setup/install-fisb.sh` (weather).

---

## Also in this line (carried from v6, all live)
Airport View phase 1 (`/airport` top-down KSEA + the map doorway) and the modularity fork-isolation;
AeroDataBox quota fix (rolling budget) + circuit breaker + `/api/enrich` health/probe; the design-review
+ bug-scrub pass (featured-plane strobe, coreDim floor, mid-tunnel train dir, NaN guards); the Vitest
regression net; bus route-reveal redesign; ferry velocity-glide; Harborview helipad; and the bedside
usability P0s (persistent mute/settings, night-themed chrome/cards, reachable dismiss, first-run hint).

## To finish v7
1. `sudo bash pi-setup/install-978.sh` → confirm **native** reception (no more "PLL not locked";
   `rtl_sdr … | dump978 | uat2text` scrolls decoded messages; `:8081/aircraft.json` populates).
2. `sudo bash pi-setup/install-fisb.sh` → when FIS-B carries a regional radar product, `nexrad.png`/
   `nexrad.json` appear in `/run/dump978/wx` and `/api/wxradar` returns a product — off-air radar goes
   live on the map. (Both scripts are additive; if 978 hears nothing, the map just uses online radar.)
3. Bind dump1090 to serial `95371368` (manual, `docs/DUAL-SDR-978.md`) so the two SDRs never fight.
4. Optional: a `radarSource` toggle (auto/off-air/online) + status line; faint styling for TIS-B
   "shadow" targets. Then tag `v7`.
