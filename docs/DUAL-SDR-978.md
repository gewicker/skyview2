# Second SDR — 978 MHz UAT + FIS-B off-air weather

A second (identical) RTL-SDR was added. The first decodes **1090 MHz ES ADS-B** (`dump1090-fa` →
`aircraft.json` on :8080). The second is for **978 MHz UAT**, which carries two things:

1. **UAT traffic** — GA aircraft in the US that broadcast on 978 instead of 1090, plus **TIS-B/ADS-R**
   rebroadcast targets. → merged into the existing aircraft view.
2. **FIS-B** — Flight Information Services-Broadcast: **NEXRAD weather radar**, METARs, TAFs, NOTAMs,
   winds aloft — the "off-air weather" that was hardware-blocked in v5 (backlog #128). → a new phase.

---

## The one hard requirement: pin each SDR by SERIAL

Two identical RTL-SDRs get non-deterministic device indices across reboots, so `dump1090-fa` and
`dump978-fa` will fight over which radio they grab. Give each a unique serial ONCE, then bind by serial.

```bash
# With BOTH dongles plugged in, list them:
rtl_test            # note the two device indices (0 and 1)
# Set serials (do one dongle at a time to be sure which is which, or use -d <index>):
rtl_eeprom -d 0 -s 00001090
rtl_eeprom -d 1 -s 00000978
# Replug both after writing.
```

Then bind each decoder to its serial (idempotent edits to the two services):
- `dump1090-fa`: add `--device 00001090` (FlightAware dump1090 accepts a serial for `--device`).
- `dump978-fa`: `--sdr driver=rtlsdr,serial=00000978`.

---

## UAT traffic → merged (server change, already shipped)

The server now polls a **second `aircraft.json`** and merges it into the 1090 feed (dedupe by hex,
freshest position wins — same path as the API supplement). It's env-gated and fails safe:

- `UAT_JSON_URL` (default `http://localhost:8081/aircraft.json`). Empty string disables it. When the
  978 decoder isn't running the fetch just fails and the merge is a no-op — safe to leave on.
- `dump978-fa`/skyaware978 serve the standard FlightAware `aircraft.json` schema, which the existing
  parser already reads, so UAT aircraft need no new code — they just appear.

**Getting a 978 `aircraft.json` on :8081** — two ways (George's call; he owns the Pi image):
- **Simplest — FlightAware skyaware978 packages:** install `dump978-fa` + `skyaware978`; they run the
  decoder + serve `.../data/aircraft.json`. Point `UAT_JSON_URL` at that path (adjust host/port).
- **From source (mirrors the dump1090 setup in `install-on-pi.sh`):** build `flightaware/dump978`,
  run `dump978-fa --sdr driver=rtlsdr,serial=00000978 --json-stdout` into a small writer that maintains
  `aircraft.json`, and serve that dir with `python3 -m http.server 8081` (like `dump1090-json.service`).
  `pi-setup/install-978.sh` scaffolds this — **verify the `dump978-fa` flags against your build**.

### Optional polish (small, later)
- Tag UAT-sourced contacts (source `"uat"`) so the client could render 978/TIS-B traffic distinctly
  (e.g. a subtle glyph tweak). Not required — they render as normal aircraft today.
- TIS-B/ADS-R targets use non-ICAO addresses; they merge fine but are "shadow" traffic — consider a
  faint style so they read as advisory, not primary.

---

## FIS-B off-air weather → PHASE 2 (design)

This is the big new capability and needs on-device verification, so it's its own phase.

**Pipeline:**
1. `dump978-fa` emits **UAT uplink (FIS-B) frames** (`--json-stdout` includes uplink message payloads,
   or use `--raw-port` + a decoder). The rich product is **NEXRAD** (regional, ~higher res near you +
   CONUS): a grid of reflectivity bins.
2. **Decode + assemble** the FIS-B APDU → product blocks → a georeferenced reflectivity raster. This
   is the substantive work (FIS-B frame parsing, block assembly across the ~broadcast cycle). Consider
   an existing decoder (e.g. `fisb-978` / dump978's product tooling) rather than writing from scratch.
3. **Serve** it: a Go feed (mirroring `traffic.go`/`fire.go`) that consumes dump978's uplink output,
   keeps the latest NEXRAD raster, and exposes it at `/api/wxradar` (PNG tiles or a compact grid).
4. **Render** it: SkyView already has `RadarLayer` (currently keyless precip radar, off by default) —
   point it at `/api/wxradar` so the map shows **real off-air NEXRAD** with the same translucent
   ground-tier treatment. Reuse the existing radar toggle + opacity config.

**Why phased:** steps 1–2 can only be validated against live 978 uplink frames (you must be receiving
FIS-B), and the raster georeferencing needs eyeballing on the map. Ship the UAT-traffic merge first
(above), confirm the 978 SDR is decoding, then build the weather raster.

**Open items:** which FIS-B decoder to adopt; NEXRAD product resolution/coverage at our location;
raster→tile vs raster→grid transport; refresh cadence (FIS-B NEXRAD updates every few minutes).

---

## Runbook
1. Pin serials (above); bind dump1090 to `00001090`.
2. Stand up the 978 decoder serving `aircraft.json` on :8081 (skyaware978, or `install-978.sh`).
3. Deploy the server (UAT merge is already in `main.go`); confirm UAT traffic appears and
   `journalctl -u skyview` shows the "978 UAT source at …" line.
4. Later: build the FIS-B → `/api/wxradar` → `RadarLayer` weather pipeline (Phase 2).
