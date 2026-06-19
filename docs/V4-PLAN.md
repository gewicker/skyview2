# SkyView 2 — v4 Implementation Plan

Planning-only document (no code yet). Derived from `SKYVIEW-V4-HANDOFF.md` + a read of the
current tree at `C:\skydeck\skyview2`. Sequenced so each batch lands shippable and the risky
shared infrastructure (`path.ts`, terminal coords, `tripId` plumbing) is built once and reused.

---

## Grounding — what the code actually shows (verified this pass)

- **Card collision is real and three-way.** `web/src/display/Display.tsx` renders the aircraft
  `TapCard` at **top-right** (comment line 327), the `TransitCard` at **`top:16 right:16`**
  (line 612), and `SpotlightLayer.drawPlacard` paints its canvas card at **`x = f.w - w - 18,
  y = 18`** (top-right, line 185). All three occupy the same corner. A ferry card + an aircraft
  card + the auto-spotlight placard can stack simultaneously. This is the confirmed defect.
- **`path.ts` does not exist yet.** The shared arc-length/project-to-path module is net-new.
- **`internal/feed/buses.go` parses `tripId`** (line 97) but only uses it to *filter out* rail
  (line 140); it is **not** carried into the `/api/buses` payload. Route/headsign in the bus card
  is blocked on plumbing this through.
- **`internal/feed/ferries.go` exposes terminal *names*** (`DepartingTerminalName`,
  `ArrivingTerminalName`, line 95-96) **but no coordinates.** Plot-a-ferry's-crossing-on-tap and
  ferry route-flow both need terminal lat/lon → WSF Terminals API or a static table.
- **`RouteLayer.ts` already draws a selected-aircraft great-circle on tap** and clears on
  deselect. This is the exact template for "plot the selected vehicle's route on tap."

---

## Batch 1 — Card deconfliction (do first; visible defect)

**Goal:** aircraft and transit cards coexist without overlap; the auto-spotlight canvas placard
never paints over a DOM card.

1. **Move `TransitCard` to bottom-left.** Change its container style from `top:16 right:16` to
   `left:16 bottom:16` (clear of the bottom-left mute/settings button cluster at line 340 — give
   it a higher bottom offset, ~`bottom:84`, or move the button cluster). Aircraft `TapCard` stays
   top-right.
2. **Gate the canvas placard on a `transitCardOpen` flag.** `SpotlightLayer.drawPlacard` repaints
   the top-right corner every frame regardless of DOM cards. Thread a `transitCardOpen` boolean
   into `FrameContext` (set from `transit != null` in Display) and early-return before
   `drawPlacard` when it's true — OR keep the aircraft side authoritative: suppress the auto
   placard only when the aircraft `TapCard` is open (`selectedHex`-driven) and let TransitCard own
   bottom-left. Decide which corner the auto-placard yields to; simplest is: auto-placard
   suppressed whenever **any** DOM card is open.
3. **Verify coexistence:** aircraft tap-card (top-right) + transit tap-card (bottom-left) +
   auto-spotlight reticle (ring only, no placard) all visible at once with no overlap.

**Files:** `Display.tsx` (TransitCard style, pass flag), `SpotlightLayer.ts` (gate placard),
`render/types.ts` (add `transitCardOpen`/`spotCardSuppressed` to `FrameContext`).
**Risk:** low. **Verify:** Pi build gate + on-device screenshot reproducing the DAL2543/Tacoma case.

---

## Batch 2 — Shared route geometry (`path.ts`) + glyph/motion overhaul

These two are grouped because the glyph motion and all route-flow work consume the same math.
Build `path.ts` first, then the glyphs that ride on it.

### 2a. `web/src/display/render/path.ts` (new, shared)
Pure functions, no rendering: build a cumulative arc-length table for a polyline; `project(point)
→ {s, lat, lon, segIdx}` nearest-point-on-path; `advance(s, meters) → {lat, lon, heading}`;
helpers for eased interpolation between two `s` values. This is the substrate for dead-reckoning
and timetable pacing in Batch 3. Unit-testable in isolation (the Cowork sandbox can't build Go,
but it *can* run a TS/node test of this module — worth a small test file).

### 2b. Per-mode glyphs oriented to heading
Ferry hull already shipped. Add:
- **Link railcar** — railcar + window-stripe silhouette, oriented to track heading
  (`TrainLayer.ts`), cached rotated sprites via the existing `glyphCache.ts`.
- **Bus** — small rounded square bead (`BusLayer.ts`), oriented or static (buses are dense; a
  simple oriented chip is enough).
- **Signature motion (calm, no strobe):** ferry **V-wake** speed-scaled (extend the shipped wake),
  train **along-track shimmer** (a gradient highlight moving along the railcar, NOT a pulse).
- **Ferry terminal anchors** — small dock markers at terminal coords (depends on Batch 4 coords;
  can land with placeholder hand-placed coords first, then swap).

**Files:** `path.ts` (new), `TrainLayer.ts`, `BusLayer.ts`, `FerryLayer.ts`, `glyphCache.ts`,
`aircraftGlyph.ts`/`carGlyph.ts` as sprite-cache references.
**Risk:** medium (sprite caching + heading math). **Verify:** Pi gate + visual check per mode.

---

## Batch 3 — Route-flow prediction (ferries → buses → trains)

Smooth, schedule-accurate motion between sparse live polls, built on `path.ts`. Do **ferries
first** (simplest path: terminal → terminal).

1. **Ferries.** Needs WSF **terminal coords** (Batch 4). On each poll, project the live vessel fix
   onto the dep→arr lane; between polls, dead-reckon along the lane eased by `path.ts`.
2. **On tap, plot the selected vehicle's route** (mirror `RouteLayer`): for a tapped ferry, draw
   the dep→arr crossing lane (terminal names → coords already in the feed). Add a transit-route
   layer or extend `RouteLayer` to accept transit picks.
3. **Timetable-paced prediction** (George, 2026-06-18): pace the arc-length animation to the
   **published schedule**, not raw GPS speed — position corrected by live fixes, but *between*
   fixes the motion follows the timetable's predicted progress. Ferries have scheduled crossing
   durations; rail has per-segment station times; buses have GTFS stop times. Blend: live fix
   snaps `s`; timetable sets the rate of `s` advance until the next fix.
4. **Buses.** Carry `tripId` through `buses.go` (currently dropped after line 140) into
   `/api/buses`; cache OBA `shapes` per trip; project bus onto its shape.
5. **Trains.** Needs the ordered per-line polyline from Batch 5 (`RAIL_LINES`).

**Files:** `path.ts`, `FerryLayer.ts` + `liveferries.ts`, `RouteLayer.ts` (or new
`TransitRouteLayer.ts`), `internal/feed/buses.go` (+tripId, +shapes cache), `BusLayer.ts`,
`TrainLayer.ts`. **Risk:** medium-high (schedule data sourcing). **Verify:** Pi gate + watch a
crossing animate smoothly through a poll gap.

---

## Batch 4 — GPS-accurate ferry terminals (+ seaplane bases)
WSF **Terminals API** (`terminals/rest/terminallocations`, reuses `WSDOT_ACCESS_CODE`) → static
table or a small poller in `internal/feed/`. Fold terminal coords into ferry route-flow (Batch 3)
and terminal anchors (Batch 2). Replace hand-placed seaplane bases with FAA/OSM coords.
**Unblocks** the ferry portions of Batches 2-3, so it can move *ahead* of them if convenient.
**Risk:** low.

---

## Batch 5 — Train route-flow geometry (ordered per-line polyline)
Stitch OSM **route relations** in `scripts/get-rail-osm.ps1` → `RAIL_LINES` including tunnels,
with a **per-segment tunnel flag**. **Unblocks:** data-art "A" (flowing crest) and the
**underground-vs-above-ground** train animation. Feeds train route-flow (Batch 3.5).
**Risk:** medium (OSM relation stitching is fiddly). **Verify:** rendered line matches real
alignment incl. tunnel segments.

### CONFIRMED BROKEN — underground train animation (George 2026-06-18)
The current train animation "doesn't make sense" underground. Two coupled problems flagged for
**design-expert review**:
1. **Coordinate / line tracking underground.** OBA GPS fixes are sparse/absent in tunnels (DSTT
   downtown, Beacon Hill, U-District→Northgate), so trains jump, freeze, or surface in the wrong
   place. Needs the ordered tunnel-inclusive polyline (this batch) + dead-reckoning along it.
2. **Animation grammar underground.** A train in a tunnel shouldn't render as a surface bead in a
   wrong spot; it needs a distinct treatment (e.g. ghosted/dimmed, paced along the tunnel
   centerline by timetable until it resurfaces). Ties to the timetable-paced prediction (Batch 3).

Design proposal being drafted to `docs/UNDERGROUND-RAIL-DESIGN.md`.

---

## Batch 6 — New feeds + transit depth
- **Fire/EMS dispatch** — Seattle Fire real-time 911 (public) + PulsePoint (Eastside);
  auto-expiring incident markers, subordinate styling. New `internal/feed/fire.go` + layer.
- **King County transit depth** — RapidRide branding/route lines, Water Taxi; **bus route/headsign
  in tap card** (needs Batch 3.4 `tripId` plumbing).
**Risk:** medium. Independent of 1-5 except the bus card needs tripId.

---

## Batch 7 — More data-art (consult a9bba998)
C ghost-trail signature, E headway breathing, F system vitality, G bidirectional ribbons,
H bus pollen. Each is self-contained and additive; pick per visual appetite. **Risk:** low.

---

## Batch 8 — Vessel media + AIS
Curated WSF fleet photos by vessel name in the ferry tap card (no free photo-by-vessel API).
**AIS for ALL Sound vessels** (aisstream.io free websocket / MarineTraffic paid) — the real
replacement for the deprecated synthetic `VesselLayer` (files currently orphaned). **Risk:**
medium (websocket lifecycle, last-good caching). **Verify:** Pi gate + live vessel coverage.

---

## Batch 9 — Tag v4
`RELEASE-NOTES-v4.md` + version bump + `git tag v4`. Roll deferred route-enrichment hardening
(audit af24f552: sustained-heading hysteresis, `pickADB` correlation, hexdb coord backfill,
collapse the two route booleans into one confidence enum) into v4 or carry to v5.

---

## Suggested execution order
1 (defect) → 4 (coords, unblocks ferries) → 2 (path.ts + glyphs) → 3 (route-flow, ferries first)
→ 5 (rail geometry) → 3.5 (train flow) → 6 → 7 → 8 → 9.

Rationale: kill the visible bug, then build the shared substrate (`path.ts` + terminal coords)
before anything that depends on it, ferries as the simplest end-to-end proof of the route-flow
pattern, rail geometry last among the core work because OSM stitching is the fiddliest piece.

## Owner backlog additions (2026-06-18)
- **Ferries more noticeable + speed-scaled animated wake — DONE 2026-06-18.** `FerryLayer.ts`:
  ~1.3x larger hull, wider halo, brighter core; replaced the lagging-anchor wake with a
  speed-scaled V-wake astern (length + spread + animated flow-rate all grow with speed). Shipped
  with the ferry crossing-lane work.
- **Strobe-light intensity — design-expert review.** Owner wants a design opinion on the intensity
  of the aircraft strobe/beacon lights (always-on bedside screen → glare/comfort tradeoff).
  Proposal being drafted to `docs/STROBE-INTENSITY-DESIGN.md`.
- **Underground light rail — design-expert review (BROKEN).** See Batch 5; proposal in
  `docs/UNDERGROUND-RAIL-DESIGN.md`.
- **Predict + smooth out light-rail animations (George 2026-06-18).** Same work as the
  underground-rail prediction: arc-length dead-reckoning + timetable pacing in `path.ts` so trains
  glide smoothly AND schedule-accurately between sparse OBA polls (above ground too, not just
  tunnels). Covered by the underground-rail implementation task.

- **Improve ferry smoothness on transit — DONE 2026-06-18.** liveferries.ts now paces underway
  vessels along the dep→arr crossing lane in arc-length (path.ts over a 2-vertex line), dead-reckoning
  at the reported speed between WSF polls + a gentle per-poll correction. Docked/terminal-unknown
  vessels fall back to raw easing.
- **Predict + smooth light-rail movement — DONE 2026-06-18.** livetrains.ts now estimates each
  train's speed from consecutive fixes and predicts forward continuously (no ease-and-stall between
  ~20s polls), above ground and through tunnels; gentle per-poll correction onto the fix.

## Cross-cutting reminders (from memory / handoff)
- **Compile gate is the Pi** (`make pi`); the Cowork bash mount is stale on edits and can't build
  Go — trust the Read tool + the Pi gate, not bash greps of the mount.
- **PC blocks use cmd syntax** (`2>nul`, not PowerShell); always prefix command blocks with the
  `cd` since George pastes into a fresh prompt. Deploy = Pi build-on-device over SSH.
- **Route direction: server is sole authority.** Do not reintroduce client-side re-swap.
- Keep keys server-side (env defaults in `cmd/skyview/main.go`); every feed graceful when key empty.
