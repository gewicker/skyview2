# SkyView 2 — V6 Optimization Plan

A read-only performance audit of the always-on Pi kiosk render loop + the new client-rendered
airport view, written AFTER the three prior rounds (`OPTIMIZATION-AUDIT.md`, `PERF-GESTURE.md`,
`PERF-INTERACT.md`) shipped. **No code was changed here — this is the v6 plan.** Findings are
grounded in the current source (file · symbol · approx line). Items the prior rounds already
landed are listed in "Already optimized — leave alone" so they are not re-recommended.

The headline change since the last audit: the heavy gesture-frame costs are *already mitigated*
— rail/highway geometry is baked into `StaticOverlayLayer` buffers (`RailLineLayer`,
transform-blitted during gestures), highways decimate at stride 6 while interacting, the wide
glow under-strokes and highway cars are skipped mid-gesture, `liveTrains()` is memoized once per
frame, `coreDim()` is hoisted in `RailLayer`, aircraft labels + the three additive glow arcs are
skipped while interacting, trails bail entirely mid-gesture, and the gesture loop runs at 60 fps
again *because* the frames are now cheap. So the remaining wins have shifted away from
gesture-frame jank toward (a) **startup / memory / first-paint** — a 672 KB shared chunk the
kiosk AND the airport view both load — and (b) **steady-state allocation / GC churn** on a
24/7 process, plus a handful of small redundant-work cuts.

---

## P0 — clear wins

### P0-1. The 672 KB shared chunk pulls rail.ts + highways.ts into BOTH bundles, including the airport view that never draws them
- **Where:** `web/src/display/render/Renderer.ts` lines 7–11 import `liveTrains` (→ `livetrains.ts` → `rail.ts`), `liveBuses`, `liveFerries`, `fireIncidents`, and `RAIL_STATIONS` from `./rail` **directly at module top**. `Renderer` is imported by *both* entry points: `display/Display.tsx` and `airport/Airport.tsx` (`Airport.tsx` line 9). `vite.config.ts` defines the two MPA inputs but sets **no `manualChunks`**, so rollup hoists everything `Renderer` transitively needs into one shared chunk — which it names after a module in it (`AtmosphereLayer-*.js`, ~672 KB). That chunk is the bulk of the kiosk's JS and is *also* loaded by `/airport`, which renders only `MapLayer`/`AirportDiagramLayer`/`AircraftLayer`/`AtmosphereLayer` (`Airport.tsx` 10–18) and has **zero** rail/highway/bus/ferry layers.
- **Why it's the bug, not just bloat:** `rail.ts` (~160–214 KB of inlined coordinate literals) and `highways.ts` (~66–127 KB) are parsed as JS at cold start and resident forever, on a device where highways are off by default and the airport view never shows rail at all. The prior audits flagged the code-split (`OPTIMIZATION-AUDIT.md` #6, `PERF-INTERACT.md` P5) but framed it as "load behind a toggle." The v6 insight is sharper: the **transitive pull is through `Renderer`/`pickTransit`/`onScreenTransit`**, so even gating the *layers* won't shrink the chunk while `Renderer.ts` statically imports `liveTrains`/`RAIL_STATIONS`.
- **Fix (two parts, do both):**
  1. **Break `Renderer`'s static dependency on the transit stores + rail geometry.** `Renderer` imports them only for the hit-test helpers `pickTransit()` (lines ~186–211) and `onScreenTransit()` (~228–242). Move those into the transit layers (or a small `transitPick.ts` the *display* registers), or have `Renderer` call into an injected pick provider, so `Renderer.ts` no longer statically imports `livetrains`/`livebuses`/`liveferries`/`livefire`/`rail`. Then the airport bundle (which never registers transit layers) stops pulling any of it.
  2. **Dynamic-import the geometry blobs.** Load `rail.ts` when `showRail` first goes true and `highways.ts` when `showHighways` first goes true (each consumer needs a small async-init guard — `RailLineLayer.buildTunnelSpans()` and `livetrains.LINE_BY_ID` run at module load today). Or convert the coordinate payloads to JSON assets fetched on demand (`JSON.parse` of a blob evaluates faster than a giant JS array literal — a real cold-start win on the Pi).
  3. **As a floor-effort interim:** add `build.rollupOptions.output.manualChunks` to `vite.config.ts` to split `rail`/`highways` into their own chunks. This alone won't make them lazy (they're still statically reachable), but it stops them landing in the shared first-paint chunk and lets the airport entry tree-shake them once part 1 cuts the `Renderer` edge.
- **Benefit:** first-paint + resident memory (large). The kiosk's first paint and the airport view's first paint both drop the rail+highway parse; airport view sheds it entirely. Lower resident memory → fewer/cheaper GC pauses during browsing on the Pi. Neutral on steady-state frame time.
- **Risk:** Medium — changes module-init order and adds async guards; the `Renderer` decoupling (part 1) touches the hit-test path, so test tap-to-reveal for trains/buses/ferries/stations/fire. Do it as its own well-tested change.
- **Effort:** Medium (part 3 alone is ~15 min; the full decouple + lazy-load is ~half a day).

### P0-2. The Go file server ships the embedded JS uncompressed (no gzip / Content-Encoding)
- **Where:** `internal/httpd/httpd.go` lines ~186–209 — `http.FileServer(http.FS(sub))` serves `go:embed dist` directly; grep for `gzip`/`Content-Encoding`/`Cache-Control` finds **nothing**. So the 672 KB chunk (P0-1) goes over the wire (and over localhost on the Pi kiosk) uncompressed, and with no `Cache-Control` the kiosk re-fetches on every Chromium relaunch (`/api/kiosk/restart` does `pkill chromium`, line ~170 — relaunches are routine).
- **Fix:** Wrap the static handler to (a) serve a pre-compressed `.js.gz` when present + `Accept-Encoding: gzip` (Vite/rollup can emit `.gz`, or gzip the embed at build), or wrap with a gzip `http.Handler`; and (b) set `Cache-Control: public, max-age=31536000, immutable` on the hashed `assets/*` files (they're content-hashed by Vite, so immutable is safe) and `no-cache` on the HTML entries. This is independent of P0-1 and compounds with it (a code-split + gzipped chunk is a double win).
- **Benefit:** first-paint / load (the JS payload compresses ~3–4×) and zero re-download across kiosk relaunches. No frame-time effect.
- **Risk:** Low — purely additive headers + an encoding negotiation; HTML stays no-cache so config/markup changes still land.
- **Effort:** Low.

### P0-3. AircraftLayer computes the local-arrival field twice per aircraft per frame
- **Where:** `AircraftLayer.draw()` calls `arrivingLocal(a)` at line ~215 (the landing-light gate) and **again** inside `labelLines(a, cfg)` at line ~665 (the destination string) — `arrivingLocal` runs `arrivalField(a)` (`ApproachLayer.ts`), a glidepath/alignment test over all local fields. `labelLines` also calls `departingLocal(a)` (line ~667 → `nearestLocalField()` scan). On every airborne aircraft, every non-gesture frame. The prior audit (#3) flagged this; it is **still present** in the current source.
- **Fix:** Compute `arr = arrivingLocal(a)` once near the top of the per-aircraft block, thread it into both the landing-light `if` and into `labelLines` (pass it in, or have `labelLines` accept a precomputed `arr`). Same for the `seedFor(a.hex)` calls — it is memoized (good, `_seedMemo`, line ~780) but fetched up to 4× per airborne aircraft per frame (glow seed ~196/205/207, landing-light flick + shimmer ~218–219, nav lights ~365); fetch once and pass the number.
- **Benefit:** frame-time on a busy sky (small-to-moderate, scales with traffic), and it's pure dedupe — exactly identical output.
- **Risk:** Very low.
- **Effort:** Low.

---

## P1 — solid wins

### P1-1. AircraftLayer makes two full passes over `f.aircraft` and allocates a fresh `LabelJob[]` + a `[...jobs].sort()` copy (twice in the adaptive path) every frame
- **Where:** `AircraftLayer.draw()` main loop (line ~145) iterates all aircraft, then a **second** loop (line ~292) iterates them again for the takeoff/landing flourish — which only acts on the tiny minority with an active `transitAge`. Also `const jobs: LabelJob[] = []` (line 144) is freshly allocated each frame and pushed per labelled aircraft; `drawLabels` then does `[...jobs].sort(...)` (line 548) and, in the adaptive tier, a second `[...jobs].sort(...)` (line 557) — full array copies. On the busiest layer, every non-gesture frame.
- **Fix:** (a) Collect the few flourish-eligible aircraft into a small list during the first pass (or cheap-test `a.transitAge` there) instead of re-scanning the whole set. (b) Hoist a reusable `jobs` array onto the layer instance and reset `.length = 0` each frame; reuse the job objects via an index-keyed pool. (c) Sort indices in place / sort `jobs` once and slice, rather than spreading into new arrays.
- **Benefit:** steady GC/allocation pressure (matters for a 24/7 process) + a small frame-time cut on a busy sky.
- **Risk:** Low — caching/pooling, same draw output.
- **Effort:** Low-to-medium.

### P1-2. The `live*()` accessors that are NOT yet memoized rebuild a fresh array every frame
- **Where:** `liveTrains()` is now memoized per frame (`livetrains.ts` ~176, `FRAME_BUCKET_MS`) — good. But `liveBuses()` (`livebuses.ts` ~202), `liveFerries()` (`liveferries.ts` ~116), and `fireIncidents()` (`livefire.ts`) each still allocate a fresh array per call, and `liveBuses()`/`liveFerries()` are each called in **two** places per frame: their layer (`BusLayer`/`FerryLayer`) *and* `Renderer.pickTransit()`/`onScreenTransit()` when a card is open or a tap fires. The per-frame layer call rebuilds the array (with `posAt`/`lineLength` arc-length walks for road-snapped buses) every frame regardless.
- **Fix:** Give `liveBuses`/`liveFerries`/`fireIncidents` the same per-frame memo as `liveTrains` (bucketed `performance.now()` key, hard-invalidated in their `tick*`). Note this partly resolves itself if P0-1 moves the pick helpers out of `Renderer` (the second call site goes away), but the memo is still worth it for the layer's own per-frame rebuild + the arc-length walks.
- **Benefit:** moderate GC/allocation churn reduction; removes duplicate arc-length walks for buses/ferries.
- **Risk:** Low — pure caching, same data (mirror the proven `liveTrains` memo).
- **Effort:** Low.

### P1-3. RailLayer's station bloom is O(stations × live trains) and the proximity scan runs every frame (gesture included)
- **Where:** `RailLayer.draw()` lines ~29–56 — for each on-screen station it scans **every** live train (`distNMrail`, line ~34) to find the nearest, every frame, gesture or not. `coreDim()` is already hoisted (line 26, done). `liveTrains()` is now shared via the memo (done). The remaining cost is the nested proximity scan, which is the most likely O(n·m) to bite as the train feed grows, and it is *not* gated on `f.interacting`.
- **Fix:** Trains move slowly and the proximity only drives a halo radius + a 30 s arrival-ring cooldown, so compute the per-station nearest-train distance at a low cadence (e.g. every ~0.25 s) and cache it, or skip the scan entirely while `f.interacting` (freeze the last bloom radii — imperceptible while panning). The bloom/ring then reads identically.
- **Benefit:** small now, but removes the only un-gated O(n·m) loop from the gesture frames and caps growth as the feed scales.
- **Risk:** Low — a frozen/low-cadence ornament during motion.
- **Effort:** Low.

### P1-4. Replace the per-frame transit/aircraft gradients with flat strokes AT REST (mid-gesture is already gated)
- **Where:** the mid-gesture skip is done everywhere (`TrainLayer` ~99/115/178, `FerryLayer` ~56, `BusLayer` ~64 all guard on `!f.interacting`). But **at rest** these still build a `createLinearGradient` per entity per frame: `TrainLayer` comet tail + submerged-ghost tail + sim-train tail; `FerryLayer` 2 wake legs + 1 centerline froth per moving ferry (`liveferries`… `FerryLayer` ~65–82); `BusLayer` one tail per bus (~65); `AircraftLayer` the landing-beam gradient (~227) and the takeoff/landing streak gradient (~252). Gradient objects are among the costlier canvas allocations and churn the GC continuously on the always-on display.
- **Fix:** Where the gradient is a short fade-to-transparent along one segment (bus/train/sim tails), a flat 2-stop `strokeStyle` at a mid alpha (or a `globalAlpha` taper) reads near-identically at these sizes and allocates nothing. The ferry wake gradient is constant in the rotated local frame — build it once per speed-bucket and reuse, or flatten it. Keep the aircraft landing-beam gradient (it's a true conic beam, minority of aircraft, lower value).
- **Benefit:** moderate sustained GC/allocation reduction at rest (the 24/7 case) → steadier frame pacing, fewer GC hitches.
- **Risk:** Low-to-very-low visually (ambient tails); validate the ferry wake reads the same.
- **Effort:** Medium (per-layer visual tuning).

### P1-5. SpotlightLayer scans every aircraft each frame and is never gated on interaction
- **Where:** `SpotlightLayer.draw()` lines ~83–90 — a nearest-within-radius loop over all `f.aircraft` (cheap flat distance, fine) plus the gimbal ring + (when a card isn't open) the placard with `getPhoto`, `measureText` per line, and a clipped photo draw (~154–227). None of this is gated on `f.interacting`, so it runs at the full gesture rate.
- **Fix:** While `f.interacting`, keep the nearest-aircraft scan + reticle (cheap, and the locked target should track) but **skip `drawPlacard`** (the text measure + photo blit) — it's unreadable mid-pan and snaps back on release, exactly the trade AircraftLayer's labels already make.
- **Benefit:** small-to-moderate during gestures on a busy sky (text + photo blit are real Pi costs).
- **Risk:** Low — the placard returns on settle.
- **Effort:** Low.

---

## P2 — minor / situational

### P2-1. Bake the animated highway flow wash into the StaticOverlayLayer model (Phase-2 structural)
- **Where:** `HighwayLayer` reprojects (decimated, stride 6) every gesture frame and strokes the flow ribbon live; the rail ribbon is already baked (`RailLineLayer` in `StaticOverlayLayer`). Highways are off by default, so this is low-value today (flagged so by the prompt — confirmed). The *scrolling* congestion dash + cars are genuinely dynamic and can't bake, but the static ribbon geometry could. Given the decimation already tames the reproject, this is a Phase-2 cleanup only if highways become a default-on feature. **Assessment: defer** — the decimation + mid-gesture car/glow skip already put highways within budget when on; baking adds complexity for a non-default layer.
- **Benefit:** would drop highway gesture cost to ~one `drawImage`, but only when highways are enabled.
- **Risk:** Medium (splitting static ribbon from the live wash/cars).
- **Effort:** Medium-high. **Recommend NOT doing in v6** unless highways go default-on.

### P2-2. `renderScale` / `maxFps` tuning levers (already correct; document, don't change blindly)
- **Where:** `Renderer.resize()` (~93–103) clamps `dpr = native*renderScale` to [0.5, 2]; `Renderer.start()` (~67–73) runs gestures at `GESTURE_FPS = 60` now that frames are cheap, rest at `cfg.maxFps`. These are the right global levers and are well-placed.
- **Assessment:** Leave the defaults. The one knob worth exposing is a **per-surface `gestureFps`** so a future heavier feed (or a slower Pi revision) can drop gesture pacing to ~40 without touching the web/airport client — but only if a real regression appears. `PERF-INTERACT.md` P1 already designed this; it was reverted to 60 deliberately because the baked geometry made it unnecessary. Don't re-cap without measuring a regression first.
- **Effort:** n/a (a tuning lever, not a fix).

### P2-3. Offscreen-canvas reuse — already the pattern; one micro-opportunity
- **Where:** `StaticOverlayLayer` and `MapLayer` reuse a single offscreen `<canvas>` and only resize on dimension change (`StaticOverlayLayer.bake()` ~60–61 guards `if (this.cv.width !== W)`), which is correct. The `glyphCache` sprites are cached/bucketed (good). No general offscreen-reuse problem remains.
- **Micro:** `StaticOverlayLayer.bake()` allocates a fresh `sub` FrameContext object each bake (line ~67) — but bakes are rare (only on settle), so it's not worth pooling. **No action.**

---

## Already optimized — leave alone

These were landed by the prior three rounds and are confirmed in the current source. Do **not**
re-recommend or "re-fix" them:

- **Gesture-frame polyline reprojection** — rail ribbon is baked into `StaticOverlayLayer`
  (`RailLineLayer`, full-fidelity reproject only on settle); highways decimate at stride 6 while
  `interacting` (`HighwayLayer.ensureProjected` ~56). The big gesture cost is gone.
- **Wide glow under-strokes + highway cars** skipped mid-gesture (`RailLineLayer`/`HighwayLayer.drawFlowSeg` ~150, cars ~100).
- **`liveTrains()` memoized once per frame** (`livetrains.ts` `FRAME_BUCKET_MS` ~132–199, hard-invalidated in `tickLiveTrains`).
- **`coreDim()` hoisted** out of the RailLayer per-station loop (`RailLayer.ts` ~26).
- **Aircraft labels skipped while interacting** (`AircraftLayer.draw` ~268) + label-width memo (`measureLabel`/`_labelW` ~42) + per-hex seed memo (`_seedMemo` ~780).
- **Three additive aircraft glow arcs skipped mid-gesture** (`AircraftLayer.airborne` ~347).
- **Transit gradient tails skipped mid-gesture** (Train/Ferry/Bus, all `!f.interacting`-gated).
- **TrailLayer bails entirely while interacting** (`TrailLayer.draw` ~22) + only clones/sorts when over the 40-trail cap (~31).
- **MapLayer + StaticOverlayLayer transform-blit during gestures, re-bake on settle** — the model the rail/highway fix imitated.
- **AtmosphereLayer golden-hour gradient cached** (~79–87, rebuilt ~every 20 s); sun recomputed ~every 20 s. Per-frame cost is 1–2 full-screen `fillRect` only; bails entirely when an aircraft is selected (~30).
- **TrackStore** is well-built: trail window walks only the visible tail (~199–206), `prune` trims history, interpolation/dead-reckon is bounded. The smoother is correct — leave it.
- **`path.ts`** arc-length engine memoizes `cumLen` per line via a `WeakMap`; `lineLength` rides it.
- **Camera built once per frame; visible set sampled once** (`Renderer.draw` ~279–298); hit-tests reuse `lastVisible`/`lastCam` instead of re-sampling.
- **Go feeds** — timer-based polling (15/20/30 s), mutex-guarded snapshots, disk-cache warm-start,
  bounded result slices, key held server-side, skips fetch on a hidden tab. Efficient; the only
  httpd gap is compression/caching of static assets (P0-2), which is a header change, not a feed
  change.

---

## Suggested sequencing

1. **P0-2** (gzip + Cache-Control headers) — lowest effort, independent, immediate first-paint win.
2. **P0-3** + **P1-1** (AircraftLayer dedupe + array/pass reuse) — cheap, safe, hottest layer.
3. **P1-2** (memoize the remaining `live*` accessors) — mirrors the proven `liveTrains` memo.
4. **P1-3** + **P1-5** (RailLayer station-scan + SpotlightLayer placard gating) — cheap gesture cuts.
5. **P1-4** (flatten at-rest gradients) — the durable 24/7 GC win; do after the cheap items.
6. **P0-1** (decouple `Renderer` from transit stores + lazy-load rail/highways geometry) — the
   biggest structural win for memory/first-paint, but the riskiest; do it last, well-tested, as
   its own change. Start with the `manualChunks` interim (P0-1 part 3) to measure the chunk split
   before committing to the full decouple.

Leave `MapLayer`, `StaticOverlayLayer`, `TrackStore`, `path.ts`, and the Go feeds alone except for
the P0-2 header change.
