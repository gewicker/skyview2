# SkyView 2 — Initial build scope (full feature parity)

Target: every feature in the locked 58-feature scope, running on a clean Pi, before
the first production deploy. v1 settings migrate over. Built in dependency order so
each workstream is independently verifiable, even though the first deploy lands at
the end.

Definition of done: parity with v1 across the 58 in-scope features (see
`../skylight/V2-SPEC.md` scope list); deployable + cleanly swappable (done); v1
`config.json` migrates; characterization tests green; verified live on the Pi.

## Workstreams (dependency order)

### 0. Hardware spike (gates the renderer) — see `HW-TARGET.md`
Before committing renderer architecture, measure on the actual Pi 5:
- `chrome://gpu` under the kiosk's Xwayland launch; does GPU rasterization/WebGL run
  hardware-accelerated, or fall back to SwiftShader? Try `--use-gl=angle
  --use-angle=vulkan` / `--enable-features=Vulkan`.
- Frame times for a Canvas2D draw of ~40 aircraft + trails + a blitted basemap, at the
  target resolution, with the FPS cap.
- Outcome: decide **Canvas2D-only** vs **Canvas2D + selective WebGL**. Lock the Go
  build flags (done: `GOARM64=v8.2`, static) and the Chromium kiosk flags.

### A. Foundations & datasets
Port v1's bundled static data and lock the schema.
- `internal/enrich/tables` — `airlines.json` (ICAO prefix → name) + `types.json`
  (ICAO type → name), embedded.
- `web/src/data/` — aircraft silhouette geometry (from v1 `aircraftGlyph.ts`),
  `places.ts` (curated labels), `airports.ts` (KSEA/KBFI/KRNT — already have),
  basemap coastline vector + map span, star catalog (`stars.ts`), celestial constants.
- Config migrator: `skyview migrate <v1-config.json>` (or auto on first load) — strip
  `projectorEnabled`/`recording`/`nightDim`/`nightRed`/`theme`, map any renamed
  fields, `mergeConfig` onto v2 defaults. (Mostly free: unknown keys already ignored.)

### B. Server parity
Fill the stubbed backend to match v1's pipeline.
- `internal/enrich` — adsbdb `/callsign` + `/aircraft`, 12 h TTL, negative caching,
  disk persistence, one-in-flight-per-key, background fetch; applied with the
  two-scope stickiness (type/reg by hex, airline/route by callsign).
- `internal/feed` — the airplanes.live supplement poller + `mergeSources` (radio −2 s
  bias, API `seen ?? 6` handoff).
- `internal/store` — scene store + notable store (+ webhook), atomic writes.
- `internal/httpd` — `/api/photo/:hex` (planespotters proxy, 6 h cache),
  `/api/tle` (Celestrak, 24 h cache), `/api/diag`, `/api/kiosk/restart`,
  `/api/scenes` CRUD, `/api/notable`; WS `saveScene/applyScene/deleteScene` +
  scenes/notable broadcasts and on-connect prime.

### C. Render core
- `TrackStore` — ingest + per-track history + `sampleAt` with the **1.15 s render
  delay + interpolation** between real fixes (dead-reckon past newest, capped). The
  smoothing that makes it feel alive.
- `MapLayer` — slippy tiles through the Mercator camera (pixel-exact), offscreen
  static cache keyed on view, the satellite/wire/dark **grade**, curated place labels,
  grid overlays. Tile sources: CARTO dark/nolabels, Esri imagery/labels.
- **Pi-5 paint budget (binding, per `HW-TARGET.md`):** offscreen static-map cache
  (blit/frame), nearest-N cap on gradient trails/arcs, zero per-frame allocations
  (cache gradients/paths/metrics), FPS + dpr caps, no `shadowBlur` (pre-baked glow
  sprite), `{alpha:false}`. These are acceptance criteria, not nice-to-haves —
  Canvas2D paint is single-thread CPU-bound on this box.

### D. Aircraft & signature features
- `AircraftLayer` — type-accurate silhouettes, altitude-colour ramp, comet trails
  (flat/altitude/climb), climb-descent cue, labels with density modes + collision
  avoidance + field selection, relative bearing/distance/elevation + leader,
  destination arcs.
- `SpotlightController` — auto-feature nearest + CPA anticipation/ETA, configurable
  target + radius, the placard.
- `NotableAlerts` — emergency/military/rare designators, edge-flash + test, alert card.
- `InfoCard` — tap-to-select card + photo. `Overlays` — home beacon, range rings,
  compass.

### E. Environment & sky
- `WindsPanel` — EHS winds binning + panel.
- `SkyLayer` — stars/asterisms, sun, phased moon, satellites + ISS, ISS pass finder,
  sky-time scrubber. (Ambient skin.)
- Airports — runway overlay, approach corridors, final-approach lock cue.

### F. iOS control + touch drawer
- Design system depth: NavStack/NavBar, Sheet, grouped inset lists, the full control
  primitives; optimistic local config reconciled on echo.
- Every settings section (display, map, calibration, framing, filters, motion, labels,
  overlays, sky, palette, scenes, system/diagnostics).
- Day/night/lights-out modes + schedule, brightness, burn-in orbit, cursor.
- On-screen touch drawer + map pan/zoom/recenter + tap-select.

### G. Provisioning parity (fresh-Pi)
- `flash_skyview.py` — port the Windows flasher (image, firstrun, secrets, SSH key,
  discovery cascade) for a single-binary appliance.
- firstrun onboarding net — status file + `SkyView-setup` recovery hotspot.
- (Clean swap + uninstallers + binary OTA: already done.)

### H. Verification
- Characterization tests: Mercator project/unproject round-trip; readsb normalizer +
  `mergeSources` numbers; enrichment stickiness scopes; config migrate.
- `tsc -b` + `go vet`/`go test` in CI; on-Pi smoke (decode → server → kiosk).

## Build order

A → B (backend parity, testable headless via REST/WS) → C → D (the screen comes
alive) → E → F (control reaches parity) → G (fresh-Pi provisioning) → H gates
throughout. First Pi deploy after D is internally usable; **production deploy after
F+H** per the full-parity target. Each workstream ends green on its tests before the
next starts.
