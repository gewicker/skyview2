# SkyView 2 — major revision (render fixes + server/web scrub)

This revision fixes the "aircraft render as a tiny orange star with no lights" problem,
folds in three independent code audits (aircraft render, Go server, web pipeline), and
applies the high-confidence fixes. Everything below is verified to the extent possible in
the build sandbox; `make pi` on the device is the compile gate (a bad build aborts the
deploy before installing).

## ROOT CAUSE of "nothing I change shows up in prod"

None of the recent work was ever committed. `HEAD`/`origin/main` sat at `6351d1c`, and all
of the colors / airframe-mounted lights / glow / landing beam / taxi-prediction work was
uncommitted in the working tree. Every Pi `git pull` rebuilt `6351d1c` — the old
bright-orange-star build. **The fix is simply to commit + push these working-tree changes,
then pull on the Pi.** (See deploy block at the bottom.)

## Rendering (the visible complaint)

- **Zoom-coupled glyph size.** Glyphs were a fixed ~13 px regardless of map zoom, so a
  zoomed-in single aircraft stayed a featureless dot. Airborne glyphs now grow with map
  zoom (bounded ≤2.6×, quantised so the sprite cache doesn't churn) and the base size was
  raised (0.75→0.85× of `glyphSizePx`). A zoomed-in plane is now a legible silhouette.
  `AircraftLayer.draw()`.
- **Nav-light dots scale with the glyph.** Were a constant 1.3 px (invisible, and never
  grew when zoomed in); now `lr ≈ glyphS·0.12`, strobes/beacon proportional. So the
  red/green wingtip lights actually read. `drawNavLights()`.
- **Softer glow.** The additive "jewel" core no longer whitens/washes the (earthy) fill or
  drowns the lights (inner disc +15/0.15, was +45/0.30).
- **Landing-beam gate loosened + null-tolerant.** `arrivingLocal` no longer suppresses the
  approach tag/landing light when `baroRate` is null (common on the feed); alt ceiling 5000→5500,
  field radius 7→8 mi. So the forward beam actually shows on real finals.
- (Already in this batch) airframe-mounted lights via per-kind anchor table, rotating-beacon
  sweep, xenon strobe overshoot, warm/cool color pairing; earth→sky altitude ramp with
  gamma-correct interpolation; two-regime ground prediction (rollout vs slow taxi).

## Go server

- **WebSocket write deadline + close-on-error** (`hub.go`). A stalled/half-open client can no
  longer block the whole ~1 Hz broadcast — each write gets a 5 s deadline and the conn is
  closed on failure, which unblocks the broadcast loop. (audit C1)
- **Broadcast marshals the frame ONCE**, not per client (`hub.go`). Removes the dominant
  per-tick CPU cost (re-encoding the full 100+ aircraft list for every connected client). (M1)
- **`hub.prime` race fixed** — guarded by the hub mutex (`SetPrime`/`getPrime`). (C2)
- **Merge on POSITION freshness, not message age** (`merge.go`). A radio target with a recent
  Mode-S message but a stale position no longer wins the merge and plots a 40 s-old point;
  uses `SeenPos` when present. (H3)
- **HTTP hardening** — `ReadHeaderTimeout` + `IdleTimeout` on the server (no blanket
  `WriteTimeout`, which would kill `/ws`). (H4)

## Web pipeline

- **NaN/Inf projection guard** (`Renderer.ts`). Zero-width canvas at startup no longer feeds
  `NaN` into the camera scale (collapsed all aircraft to one point / NaN lat-lon). (H4)
- **Trail layer** no longer clones the aircraft array every frame when under the cap. (P1)
- **Spotlight** nearest-search uses a cheap flat distance in the per-frame hot loop (haversine
  kept for the placard readout). (P3)

## Deferred (documented, NOT applied this pass — lower confidence / needs runtime testing)

- `showTraffic` master toggle is not gated in `AircraftLayer`/`TrailLayer`/`LeaderLayer`
  (toggle currently does nothing). Real bug; deferred because gating the loop cleanly
  needs care around the home-beacon + save/restore balance and visual verification.
- `rangeRings`/`gridOverlay` config ignored by `MapLayer` (rings always baked). Needs the
  raster cache key updated too.
- Dead config fields (`showHud`, `showStars/Sun/Moon/Satellites`, `interpolate` "Smooth
  motion" switch that does nothing, `maxExtrapolationSec`/`staleSec`, bare `zoom`/`rotationDeg`,
  etc.) — removal must be synced across the Go `config` struct and the TS `Config` mirror,
  so it's a coordinated change for its own pass.
- Server: skip re-enrich on the 1 Hz heartbeat (conflicts with "late API merge" purpose —
  needs care); evict expired photo/route cache entries (slow multi-day leak); bound
  `route-cache.json`; serialize the notable webhook through one worker.
- Web: drop the `selectedNav` `useState` (whole-tree re-render on empty-space taps); lower the
  tile cache cap for the Pi; precompute trail segment colors; consolidate duplicated
  `roundRect` helpers; delete dead `moonPhase`/`moonPosition`.

## Integrated round 2 (this batch, on top of the above)

New feature — **realistic night airport lighting at all four fields** (`NightLightsLayer.ts` rewrite
+ `LIGHTING` table in `airports.ts`):

- Per-runway-end approach light systems from the current FAA cycle: ALSF-2 on SEA's 16-ends,
  MALSR on SEA's 34-ends + PAE 16R, MALSF on BFI 14R + PAE 34L, REIL-only on BFI 32L + the GA
  ends + both RNT ends. (Two data corrections from the spec: KBFI is 14/32 not 13/31, and every
  SEA end has a full ALS with centerline + TDZ lights.)
- Every lit end always shows edge lights (HIRL brighter than MIRL), a green threshold bar, and
  REIL strobes (synchronized ~2 Hz) where installed — so all four airports glow at night.
- The end being landed on lights its real system: steady bars, the 1000 ft decision bar, ALSF-2
  red side rows, centerline/TDZ on precision ends, and the sequenced "rabbit" running inbound at
  ~2 Hz (outer-fires-first so the pulse travels to the threshold). Additive, no shadowBlur,
  scaled by the night factor, gated to airport-scale zoom + on-screen ends only.

Toggle bugs fixed (were dead switches):

- **Show traffic** now actually hides glyphs, labels, trails, and leader ticks.
- **Range rings** / grid overlay now honored by the basemap (and the raster cache re-bakes on toggle).
- **Smooth motion** (`interpolate`) now does something — off = snap to the latest raw fix, no smoothing.

Optimization / leak fixes:

- Map tile cache cap 700 → 256 (bounded for the Pi; stops decoded @2x tiles piling up across
  style switches / long pans).
- Photo cache now sweeps expired entries when large (was a slow multi-day leak — only TTL-gated
  on read, never deleted).

Bug fixes (also in this batch): ground chevrons point along actual trail-derived travel
direction; pre-GPS-lock erroneous positions (0,0 / null-island / continental defaults) and
teleport glitches rejected so contacts no longer pop up off-map and jump in; ground forward-coast
capped short (rollout 1.2 s, slow taxi 0.6 s) to kill rubberband overshoot.

Still deferred (invisible polish, real breakage risk on an unwatched deploy — do with a watched
compile): React `selectedNav` re-render thrash; Go enrich route-cache eviction + notable webhook
worker; dead config-field removal (needs Go+TS+UI sync); `git rm` the four orphan files
(`internal/geo/geo.go`, `internal/httpd/metar.go`, `web/src/control/main.tsx`, `web/control.html`).

## Integrated round 3 — phantom ground-target root cause (two full audits)

Two independent audits (Go feed + web motion model) converged. The biggest finding: **the
teleport gate added in round 1 was itself a primary cause** — a single bad first fix wedged a
track at the wrong spot and it re-spawned every 30 s. Plus the server had no validity gate at
all, forwarding garbage every client then had to fight.

Server-side validity gate (`readsb.go normalize`, applies to BOTH radio + API via `parseSnapshot`):

- Drop records with **no position** and with a **frozen/stale position** (`seen_pos > 60 s`) —
  readsb keeps a target ~60 s after last contact with its last position frozen, which rendered as
  a phantom that then jumped.
- Drop **ground service vehicles** (emitter category C1/C2/C3) — the literal "ground targets
  moving around the ramp."
- Drop **TIS-B/ADS-R surrogate hexes** (`~`-prefixed) that shadow the real airframe as a duplicate.
- Low + slow with no "ground" string → treat as a **surface** contact, so it doesn't reach the
  airborne dead-reckoner (which flung it across the ramp).
- `merge.go`: a positionless entry is now infinitely old (`posAge` → can never win), and the
  merge output drops any positionless entry (defense-in-depth).

Client motion fixes (`TrackStore.ts`, `Renderer.ts`, `AircraftLayer.ts`):

- **Teleport gate no longer wedges a track**: it keeps the track alive on a reject (no
  prune/respawn), and if a second consecutive fix corroborates the new spot, it re-anchors there
  and snaps (the old anchor was the bad one).
- **Sanity gate armed from the first feed frame** (center set eagerly in `Renderer.update`, not
  lazily in `sample()`), so an initial bad fix can't slip in before the first render.
- **Parked-with-jitter pin**: a target that barely moves over the window (gs 3–10 kt GPS noise)
  is pinned instead of coasting along noise.
- **Large corrections snap** instead of gliding across the map (the visible "drift").
- **Chevron heading** uses only motion clearly above GPS noise (~10 m), so it stops spinning on
  jitter.

## Verification status

- Web: filtered `tsc --noEmit` clean (no real type errors). Full `vite build` could not run in
  the sandbox (node_modules installed for Windows; missing Linux rollup binary) — it runs on
  the Pi via `make pi`.
- Go: `go` toolchain unavailable in the sandbox; changes reviewed against existing
  `coder/websocket` usage and the aircraft/store types. Compiled on the Pi via `make pi`.
- `make pi` is the gate: if either the web or Go build fails, the deploy one-liner stops
  before installing the binary, so a broken build cannot reach the display.
