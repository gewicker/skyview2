# Dual-Radio Build Plan — maximize both SDRs (1090 ES + 978 UAT)

> **UPDATE (2026-07-09): the 978 RF front end went NATIVE; Phase 0–1 mechanics below are superseded.**
> `dump978-fa`/SoapySDR would not lock the tuner PLL on this Pi, so 978 now runs the native
> `rtl_sdr | dump978 | uat2json` chain (which also builds `extract_nexrad`, the FIS-B NEXRAD decoder).
> The **sequencing and design intent here still hold**; for the actual commands see
> `pi-setup/install-978.sh` + `install-fisb.sh`, `RELEASE-NOTES-v7.md`, and the six-lens
> `docs/RADIO-INTEGRATION-EXPERT-REVIEW.md`.

Goal: make **both** RTL-SDRs earn their keep. SDR1 (1090 ES, `dump1090-fa`) already carries the
airliner traffic. SDR2 (978 UAT, `dump978-fa` + `skyaware978`, built + parked) should add (a) **UAT
air traffic** — already merged server-side — and (b) the flagship: **FIS-B off-air NEXRAD weather** on
the map, no internet required. Both dongles have their own antenna; serials: **1090 = `95371368`,
978 = `53037501`**.

Design-first per owner request. Sequenced so nothing heavy gets built on an unverified receiver.

---

## Phase 0 — Foundation: two radios that don't fight, and DO receive

Prereqs before any feature work (mostly config, on-device):
- **Serial binding (deterministic):** `dump1090-fa --device 95371368`; `dump978-fa
  --sdr driver=rtlsdr,serial=53037501`. The earlier `usb_claim_interface error -6` was dump978
  probing the busy 1090 dongle before finding its own — confirm it actually opens `53037501`
  (`journalctl -u dump978-fa` should NOT show `-6` once both are serial-bound). `PLL not locked!` is a
  benign RTL-SDR startup line.
- **Reception proof:** FIS-B is a *continuous* ground-station broadcast, so it's the reliable receive
  test (UAT *aircraft* are sparse). Once dump978 is on its antenna, its raw stream (:30978) should
  carry **uplink** frames within seconds even with zero aircraft. That's the green light for Phase 2.
- **Performance (Pi 5):** two full demods + Chromium. `Nice=10` is already on both 978 services so they
  yield to the display + 1090. Watch `uptime` load; if tight, cap `dump978-fa` with `CPUQuota=60%`
  (it real-time-demods, so don't starve it) and keep the FIS-B decoder on a slow cadence (below).

**Exit criteria:** `journalctl -u dump978-fa` shows uplink/message activity; `curl :8081/aircraft.json`
valid; kiosk stays smooth; `systemctl is-active dump1090-fa dump978-fa skyaware978` all `active`.

---

## Phase 1 — UAT air traffic (mostly done; small polish)

Already shipped: the server merges `UAT_JSON_URL` (:8081) into the 1090 feed (`MergeSources`, dedupe by
hex). Re-enable the services (`sudo systemctl enable --now dump978-fa skyaware978 dump978-json`) and UAT
traffic appears automatically.

Optional polish (small, `internal/feed` + client):
- **Tag source** `"uat"` on 978-origin contacts (a field on `Aircraft`), so the client can render
  978/TIS-B traffic with a faint distinguishing cue. TIS-B/ADS-R are *rebroadcast* (advisory) targets —
  a subtler glyph so they read as secondary, not primary.

---

## Phase 2 — FIS-B off-air NEXRAD weather (the flagship)

The 978 uplink carries FIS-B products; the big one is **NEXRAD reflectivity** (regional ~1.5 NM bins
near us + CONUS ~7.5 NM), refreshed every few minutes. Pipeline, mirroring the existing feed pattern:

### 2a. Decode (Pi, Python) — DON'T hand-roll FIS-B in Go
FIS-B APDU + product-block assembly is a lot; use an existing decoder. Feed `dump978-fa`'s output into
a FIS-B decoder (e.g. **fisb-978** / a `dump978` uplink consumer) that emits **NEXRAD as a
georeferenced raster**: a color-mapped PNG + its lat/lon bounds. Write to `/run/dump978/wx/`:
- `nexrad.png` — reflectivity, transparent where no data, colored on the standard dBZ ramp.
- `nexrad.json` — `{ "bounds": [north, south, east, west], "time": <epoch ms>, "kind": "regional|conus" }`.
Provision via a `pi-setup/install-fisb.sh` (additive; own systemd service, `Nice=15`, decode cadence
~60–120 s — NEXRAD only updates every few min, so this is cheap).

### 2b. Serve (Go) — a new feed, ~like `fire.go`/`traffic.go`
`internal/feed/wxradar.go`: `NewWxRadar(dir)` watches `/run/dump978/wx/`, holds the latest raster +
bounds + time, disk/last-good on stall. Wire into `httpd.Deps`:
- `GET /api/wxradar` → `{ "url": "/api/wxradar/nexrad.png", "bounds": [...], "time": ..., "age": ... }`
  (nil/empty when no FIS-B yet → client falls back to online).
- `GET /api/wxradar/nexrad.png` → the current image (served from the file; short cache).

### 2c. Render (client) — reuse `RadarLayer`, add an OFF-AIR source
`RadarLayer` already affine-maps imagery through the mercator camera (it does exactly this per RainViewer
tile). Add a source abstraction to `radar.ts`:
- Poll `/api/wxradar`; if a fresh raster exists, provide `{ imgUrl, bounds, time }`.
- `RadarLayer` draws that **single** image via one `ctx.transform` over its bounds (project the NW/NE/SW
  corners → the same affine it uses for a tile). No tiling needed — FIS-B NEXRAD is coarse.
- **Source policy:** prefer **off-air** when the FIS-B raster is fresh (< ~10 min), else fall back to
  the existing RainViewer online tiles. Reuse the existing `showRadar` toggle + `radarOpacity`; add a
  small `radarSource` config (`auto | offair | online`, default `auto`) + a status line ("off-air /
  online / stale") so it's clear which is showing.
- Keep the calm rules: translucent `source-over` ground tint, under all traffic, night-dimmed.

### 2d. Contract (v1, explicit — lets the pieces evolve independently)
```
GET /api/wxradar → { url:string, bounds:[n,s,e,w], time:number(ms), age:number(s) } | {}   // {} = none
GET /api/wxradar/nexrad.png → image/png (transparent-where-no-data, dBZ-ramp colored)
```
The decoder owns PNG+bounds; the server owns transport; the client owns rendering. Change one without
touching the others.

---

## Sequencing & verification (each step gated on-device)
1. **Phase 0** — re-enable 978, confirm serial binding + reception (uplink frames) + smooth kiosk.
2. **Phase 1** — confirm UAT traffic merges (may be sparse; TIS-B tagging optional).
3. **Phase 2a** — stand up the FIS-B decoder; confirm `nexrad.png`/`nexrad.json` appear + look sane
   (open the PNG; sanity-check bounds cover our area).
4. **Phase 2b** — `wxradar.go` + endpoints; `curl /api/wxradar` returns the contract.
5. **Phase 2c** — `RadarLayer` off-air source; verify NEXRAD registers with the map (a cell sits over
   the right geography) and aircraft still paint on top.
6. Polish: source toggle + status, off-air/online fallback, night dimming.

## What I can build blind vs. needs your hardware
- **Buildable now against the contract (no hardware):** `wxradar.go` + the two endpoints, the
  `RadarLayer` off-air source + single-image affine render, the `radarSource` config + status. These
  compile + type-check and no-op cleanly until `/api/wxradar` returns data.
- **Needs the receiving 978 + your eyes:** the FIS-B decoder choice/provisioning (2a) and the
  registration/coloring verification (2c). We build 2b/2c to the contract, then point the decoder at it.

Recommended start once you re-enable 978 and confirm uplink frames: I build **2b + 2c to the contract**
(safe, deployable, dormant), and we provision the decoder (2a) together against live reception.
