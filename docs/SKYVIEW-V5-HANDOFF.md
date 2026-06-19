# SkyView 2 — v5 Handoff / Kickoff

Continuation doc for starting v5 in a fresh chat. Repo: `C:\skydeck\skyview2`. Pi: `skyview.local`
(kiosk renders off localhost). The persistent memory (`MEMORY.md` + `skyview-*` notes) carries durable
detail; this is the consolidated snapshot + the v5 backlog.

---

## Where things stand (2026-06-18)

**v4 was tagged** (`git tag v4`, pushed). A large run shipped to `origin/main` AFTER the tag and is
live on the Pi (deployed by direct on-device build all session). So `main` is well ahead of the `v4`
tag — decide in v5 whether to re-tag/refresh `RELEASE-NOTES-v4.md` or roll it all into `v5`. The
GitHub *release asset* for v4 was never published (`gh` isn't installed on the PC or Pi) — only the
git tag exists; publish via the web UI or install `gh` if the auto-update channel is needed.

### Shipped post-v4 (this session), all live:
- **Transit suite matured.** Link light rail (jade line + stations + live OBA trains + timetable
  fallback), live Metro/ST buses, real WSF ferries — all with tap-cards (bottom-left "ground context"
  corner; aircraft keep top-right).
- **Underground rail (the hard one).** `get-rail-osm.ps1` rewritten to stitch tunnel-inclusive,
  ordered, line-keyed `RAIL_LINES` via greedy nearest-endpoint chaining (fixed an earlier phantom-chord
  bug). New shared **`path.ts`** arc-length engine (project/posAt/cumLen/paceVel/advance, unit-tested).
  Live trains tracked in arc-length: above-ground speed-estimated prediction; in tunnels a dimmed
  schedule-paced **ghost** on a dashed subsurface track; P0 portal-freeze fixed (paceVel floor).
- **Predictive motion for all 3 modes.** Trains (speed-estimated), ferries (on-water GPS easing —
  reverted an earlier straight-chord pacing that crossed land), buses (OBA **route-shape snap-to-road**
  via `path.ts` when a shape is available, else velocity-glide fallback).
- **Fire/EMS 911 layer.** Seattle Fire real-time SODA feed (keyless), subordinate ground markers with
  symbol icons (flame/cross/impact/bell) on small dots, severity-graded, `firstSeen` lifetime (the
  SODA feed lags 30–60 min), gentle daytime arrival ripple, tap cards. Seattle only (no keyless
  Eastside feed).
- **King County transit depth.** Bus route + headsign in tap cards (OBA references), **RapidRide**
  branded red, **Water Taxi** as steel-cyan marine beads.
- **Bellevue.** Neighborhood/landmark labels (`places.ts` `local` tier, gated to mapZoom≥1.6:
  Downtown Bellevue, Bellevue Sq, Wilburton, Spring District, BelRed, Crossroads, Overlake, Factoria,
  Eastgate); East Link emphasis carried by those labels (not a line recolor — see RAIL-BALANCE).
- **Five design consults + rebalances:** strobe intensity (night-aware, eased, density-gated), color
  palette P0/P1/P2, Fire/EMS design + visibility + icons, rail balance (train out-reads line/stations).
- **Performance.** Gesture loop paced (now 60fps display-native after the heavy work was removed); the
  static rail ribbon **baked to an offscreen buffer** (`RailLineLayer` wrapped in `StaticOverlayLayer`,
  transform-blits during gestures); rail/highway decimated + glow/cars skipped mid-gesture; `liveTrains()`
  memoized once/frame; aircraft labels skipped mid-gesture; `coreDim` hoisted.
- **Cleanup.** Pruned the orphaned synthetic `VesselLayer.ts`/`vessels.ts` + dead `showVessels` config;
  QA fixes (incident severity escalation, arrival-cue flag, etc.).

---

## Architecture pointers
- **`web/src/display/render/path.ts`** — shared arc-length engine (`RailLine`{path,stationIdx,segSec},
  `project`/`posAt`/`cumLen`/`lineLength`/`paceVel`/`advance`). Consumed by `livetrains.ts` and
  `livebuses.ts` (road-snap). `liveferries.ts` deliberately does NOT use it (raw on-water easing).
- **Layers + draw order** live in `web/src/display/Display.tsx` (`r.use(...)` calls). Ground tier →
  traffic → transit → aircraft → atmosphere. Fire/EMS is in the ground tier (under all traffic).
- **Feeds** `internal/feed/*.go` (radio/readsb, traffic=WSDOT, rail+buses=OBA, ferries=WSF,
  fire=Seattle SODA). All disk-cached, last-good on failure, graceful when key empty. Keys are env
  defaults in `cmd/skyview/main.go`; endpoints wired in `internal/httpd/httpd.go` (`Deps`).
- **`night.ts`** `coreDim()` = night-aware multiplier for near-white "presence" cores (floor 0.5).
- **`StaticOverlayLayer`** = the bake-offscreen + transform-blit pattern (basemap, place labels, rail
  ribbon). Reuse it for any heavy STATIC vector layer.

## Deploy + workflow (gotchas baked in — see [[command-blocks-include-cd]], [[skyview-deploy-workflow]])
- **PC = cmd, one command per line** (George switches cmd/PowerShell; `&&` differs). A stray Windows
  reserved `nul` file recurs and breaks `git add -A` ("short read while indexing nul") — clear it with
  `del \\.\C:\skydeck\skyview2\nul`.
- **Pi build-on-device is the compile gate** (`make pi` → `tsc -b && vite build` + `go build`; aborts
  before install on any error). The Cowork bash sandbox **cannot build Go** and its mount **serves
  stale/truncated copies of edited files** — trust the Read tool + the Pi gate, never bash greps/builds
  of edited files. New files DO sync to the mount.
- Deploy block: `cd ~/skyview2 && git pull && make pi && sudo install -m755 bin/skyview
  /usr/local/bin/skyview-server && sudo systemctl restart skyview && pkill -f chromium`.

---

## v5 backlog — prioritized
1. **East Link station gap** — `rail.ts` is missing East Main, Downtown Redmond, Judkins Park, Mercer
   Island. Re-run `pi-setup/get-rail-osm.ps1` (data regen, no code) + eyeball; may need the station-snap
   thresholds widened. (Owner-run PowerShell.)
2. **Schedule-accurate underground rail** — motion is smooth + tunnel-correct but paced at a NOMINAL
   speed. Add a real per-segment Link timetable to `RailLine.segSec` so `paceVel` is schedule-true.
   (Needs published Link schedule data.)
3. **Transit-card despawn** — the aircraft tap-card auto-despawns when it leaves range; the transit/
   incident card does not (QA-BUGSCRUB P1). Add an equivalent.
4. **AIS for all Sound vessels** — `aisstream.io` free websocket (needs a free key) — the real
   replacement for the retired synthetic vessel layer; renders live ships beyond just WSF ferries.
5. **Fresher Fire/EMS + Eastside coverage** — SODA lags 30–60 min; the `web.seattle.gov` real-time
   scanner page is fresher but needs scraping. Bellevue/Eastside Fire has NO keyless feed (PulsePoint
   needs an agency partnership) — still deferred.
6. **Remaining optimization** (most runtime wins done): rail/highway code-split (LOW value for an
   always-on kiosk — first-paint/memory only), bake the highway flow (it's animated, harder),
   station-bloom proximity-scan throttle during gestures, AircraftLayer label/seed dedup. See
   `docs/PERF-INTERACT.md` + `docs/OPTIMIZATION-AUDIT.md`.
7. **Bus route-line drawing** — buses now road-snap to the route SHAPE for motion, but the route line
   itself isn't drawn; could draw the selected bus's shape on tap (like FerryRouteLayer/RouteLayer).
8. **More data-art** (consults a9bba998 etc.): ghost-trail, headway breathing, system vitality,
   bidirectional ribbons, bus pollen. **Ferry/vessel photo in tap card** (curated WSF fleet images).
9. **Tag v5** — refresh release notes + `git tag v5` (+ publish the GitHub release asset if the
   auto-update channel is wanted; install `gh` first).

**Hardware-blocked / excluded:** FIS-B off-air weather (needs a 978 MHz UAT SDR).

## Design / audit docs (in `docs/`)
`V4-PLAN`, `STROBE-INTENSITY-DESIGN`, `COLOR-PALETTE-DESIGN`, `UNDERGROUND-RAIL-DESIGN`,
`FIRE-EMS-DESIGN`, `FIRE-EMS-VISIBILITY`, `FIRE-EMS-ICONS`, `RAIL-BALANCE`, `DESIGN-AUDIT-v5`,
`OPTIMIZATION-AUDIT`, `PERF-GESTURE`, `PERF-INTERACT`, `QA-BUGSCRUB`, `QA-DEADCODE`. Memory index:
`MEMORY.md` → `skyview-v4-progress` (the running detail) + the other `skyview-*` notes.
