# SkyView 2 — Interaction Frame Budget (next tier)

A read-only diagnosis of the *remaining* pan/zoom sluggishness on the Pi 5, after the two
rounds already shipped (rail/highway decimation at stride 6 while `interacting`, skipped wide
glow under-strokes, skipped highway cars mid-gesture). It looks at the whole interaction frame
— the loop pacing, every layer's `draw()`, allocation/GC churn, the bundle, and the canvas
strategy — and ranks the next wins by leverage. All findings are grounded in the source as of
this audit; line numbers are approximate. **READ-ONLY: nothing here was changed.**

---

## TL;DR — do this first

**Cap the interaction loop. Today it runs UNCAPPED during a gesture, which is the single
highest-leverage lever left.** `Renderer.start()` sets `this.nextDue = 0` whenever
`now - lastInteractAt < 220`, bypassing `maxFps` and calling `draw()` on *every*
`requestAnimationFrame` for the entire gesture plus a 220 ms tail (Renderer.ts ~67-69). On a
Pi 5 software-ish 2D canvas, "uncapped" does not mean "smoother" — it means the device spends
its whole budget producing as many heavy partial frames as it can, with **zero idle headroom**,
so every per-frame cost (still ~28 layers deep) is paid at the maximum rate exactly when the
work per frame is also highest. Capping the gesture loop to a fixed 30-40 fps gives the Pi
breathing room between frames and almost always *feels* smoother than an uncapped stutter,
because frame *pacing* (consistency) matters more to perceived smoothness than raw count.
This is a one-line, low-risk change and should be measured first — it may make the rest
optional. Everything below is the next tier if capping alone isn't enough.

---

## 1. How the loop runs during interaction

- **`interacting` is set** by `lastInteractAt = performance.now()` on every `panByPixels()` /
  `zoomAt()` call (Renderer.ts ~115, ~124). During a drag, `Display.onMove` calls `panByPixels`
  on every `pointermove` (Display.tsx ~247), so the stamp is refreshed continuously and
  `interacting` stays true for the whole gesture **plus 220 ms** after the last input.
- **The loop is uncapped** for that window (`nextDue = 0`). At rest it honors `cfg.maxFps`.
- **`renderScale`** (resize, ~0.75 on the Pi) is the existing global lever and is orthogonal —
  it shrinks every pixel op but does nothing about *how often* frames run.

**Assessment — cap vs. cut-per-frame-work:** both help, but capping is strictly the bigger,
cheaper lever right now because it multiplies the savings of *every* other layer at once and
costs nothing to try. Cutting per-frame work (sections 3-5) is the durable follow-up that
lowers the cost of each frame the cap then schedules. Do the cap first, then the cuts.

---

## PRIORITY 1 (★ top) — Cap the gesture loop to 30-40 fps

- **Where:** `Renderer.start()`, the `if (interacting) { this.nextDue = 0; }` branch
  (Renderer.ts ~67-78).
- **What:** Instead of uncapping, run the *same* `maxFps`-style throttle while interacting but
  against a gesture budget — e.g. `const fps = interacting ? Math.min(cfg.maxFps||60, 36) :
  cfg.maxFps`, then apply the existing `nextDue` interval logic uniformly (don't special-case
  `nextDue = 0`). Keep the 220 ms window as-is for *when* the low-detail path applies; only
  change the *pacing*. Optionally expose a `gestureFps` config knob so the Pi (36) and a fast
  web panel (60) can differ.
- **Expected impact:** Large and immediate. The Pi stops over-producing janky frames; each
  scheduled frame gets the full inter-frame gap to finish, so motion reads as evenly paced
  instead of stuttering. Compounds with every layer below.
- **Risk:** Low, but it is a *feel* change — validate on the actual 1280×800 panel. If a fast
  web display looks worse at 36, gate the cap to the Pi via `gestureFps`/`renderScale<1`. This
  is the lever PERF-GESTURE.md #6 flagged as "if still short of budget"; it should now be
  promoted to first because the cheaper per-frame cuts are already shipped.

---

## 2. What each layer still does during a gesture

The cache-and-blit structural pattern the prompt asks about **is already in place** for the
heavy static content: `MapLayer` (tiles + grade + glow + vignette + rings → one offscreen
buffer, transform-blitted during gestures, re-rastered on settle, MapLayer.ts ~30-79) and
`StaticOverlayLayer` (airport diagram + seaplane + airports, and separately place labels →
baked to an offscreen buffer, transform-blitted during gestures, StaticOverlayLayer.ts
~28-69). So the basemap and the static airport/label vectors are **not** reprojected per frame
— that big win exists. The remaining per-frame offenders are the *dynamic* and the
*not-yet-cached static* layers:

| Layer | Per-gesture-frame cost | Gated on `interacting`? |
|---|---|---|
| MapLayer | 1 `drawImage` transform-blit | ✓ already optimal |
| StaticOverlay (airports / labels) | 1 `drawImage` transform-blit each | ✓ already optimal |
| **RailLayer** | reprojects ~4,900 verts (stride 6 → ~820) + **per-station `liveTrains()` scan + per-station `project`** every frame | partial (stride+glow gated; station loop is NOT) |
| **HighwayLayer** | reprojects ~5,300 verts (stride 6 → ~880) + flow strokes | partial (stride+glow+cars gated) |
| TrailLayer | returns immediately while interacting | ✓ fully skipped |
| TrainLayer | `liveTrains()` rebuild + per-train gradient(s) + arc-length walks | ✗ not gated |
| FerryLayer | per-ferry 2-3 `createLinearGradient` (wake) | ✗ not gated |
| BusLayer | per-bus `createLinearGradient` (tail) | ✗ not gated |
| FireEmsLayer / Marine / Radar | off by default; cheap when on | n/a |
| AircraftLayer | glow halos skipped mid-gesture (✓); labels/sprites/nav-lights still drawn | partial |
| SpotlightLayer | nearest-aircraft scan + gimbal ring + placard | ✗ not gated |
| AtmosphereLayer | 1-2 full-screen `fillRect` (gradient cached) on top, every frame | ✗ (but bails if a plane is selected) |

Key reads:
- **AtmosphereLayer** is *not* a full reprojection cost — the golden gradient is cached and
  rebuilt only every ~20 s (AtmosphereLayer.ts ~79-87); the per-frame cost is 1-2 full-screen
  `fillRect`s. Cheap individually, but it is the topmost layer and runs at the uncapped rate,
  so the cap (Priority 1) is the right fix rather than touching it.
- **AircraftLayer** already skips the three additive glow arcs per airborne aircraft while
  interacting (`if (!f.interacting)` in `airborne()`, AircraftLayer.ts ~340-354) — good. It
  still measures/places/declutters labels, draws sprites, and draws nav-lights/strobes every
  frame. Labels are the next cut (Priority 4).

---

## PRIORITY 2 — Finish gating RailLayer's per-frame work (station loop + duplicate `liveTrains()`)

RailLayer's polyline reproject is decimated, but **two costs in the same `draw()` are not
gated and run at the uncapped rate**:

1. **`const trains = liveTrains();` inside `RailLayer.draw()`** (RailLayer.ts ~98) rebuilds a
   fresh `LiveTrain[]` — each on-line train runs `posAt()` (head) + `posAt()` (tail) +
   `lineLength()` arc-length walks (livetrains.ts ~156-175). `TrainLayer.draw()` calls
   `liveTrains()` **again** the same frame (TrainLayer.ts ~82). So the whole array + all
   arc-length walks are built **twice per frame**, doubled again by the uncap.
2. **The station bloom loop** (RailLayer.ts ~100-127) does, per on-screen station, a
   `f.cam.project()` *plus* an inner scan over every live train (`distNMrail`) — O(stations ×
   trains) — every frame, gesture or not.

- **Where:** `RailLayer.draw()`; `Renderer.draw()`/`FrameContext`.
- **What:** (a) Compute `liveTrains()` **once per frame** in `Renderer.draw()` and pass it on
  `FrameContext` (e.g. `f.trains`); have RailLayer and TrainLayer read `f.trains`. (b) During
  `f.interacting`, skip the station nearest-train proximity scan entirely (freeze the last
  bloom radii — trains move slowly and the bloom is imperceptible while panning), or compute it
  at a low cadence (~0.25 s) and cache. (c) Hoist `coreDim()` to one call/frame (it's called
  per station in the core-fill string, RailLayer.ts ~125).
- **Expected impact:** Moderate, and it stacks with the cap. Removes a full duplicate
  arc-length pass per frame plus the O(n·m) scan on the tightest frames.
- **Risk:** Low — pure caching / a frozen ornament during motion. (a) also helps at rest.

---

## PRIORITY 3 — Kill per-vehicle gradient churn in the transit layers (allocation/GC)

`createLinearGradient` is among the costlier canvas allocations and these run per entity per
frame, ungated by `interacting`:
- **TrainLayer**: a `createLinearGradient` per live train comet tail, plus another for each
  submerged ghost, plus one per simulated train (TrainLayer.ts ~97, ~110, ~170).
- **FerryLayer**: two wake-leg gradients + one centerline-froth gradient per *moving* ferry
  (FerryLayer.ts ~65-82).
- **BusLayer**: one tail gradient per bus (BusLayer.ts ~47).
- **AircraftLayer**: a landing-light beam gradient and a takeoff/landing streak gradient per
  qualifying aircraft (AircraftLayer.ts ~222, ~247) — minority of aircraft, lower priority.

- **Where:** the four layers above.
- **What:** Two complementary moves. (1) **Mid-gesture**, skip the gradient-bearing ornaments
  entirely (comet tails, wakes, froth) the same way trails are skipped and aircraft glow is
  skipped — draw just the bead/hull/chip. This removes nearly all of it from the hot frames.
  (2) **At rest**, where a gradient is a short fade-to-transparent along one segment, replace
  it with a flat 2-stop `strokeStyle` at a mid alpha (or a `globalAlpha` taper) — visually
  near-identical at these sizes, zero allocation. The ferry wake gradient is constant in the
  rotated local frame and can be built once per speed-bucket and reused.
- **Expected impact:** Moderate on GC/allocation pressure (which matters for a 24/7 process and
  for steady frame pacing); the mid-gesture skip is a direct gesture-frame win.
- **Risk:** Low-to-very-low visually; the tails/wakes are ambient detail that isn't tracked
  while panning.

---

## PRIORITY 4 — Skip aircraft label layout + draw while interacting

AircraftLayer builds a `LabelJob[]`, pushes an object per labelled aircraft, runs
`measureLabel` per line, then `drawLabels` does `[...jobs].sort()` (twice in the adaptive
path) and a greedy O(n²) vertical-declutter pass, then strokes+fills each line with a 3.5 px
outline (AircraftLayer.ts ~144-280, ~528-591). None of this is gated on `interacting`, and
text stroke/fill is comparatively expensive on the Pi.

- **Where:** `AircraftLayer.draw()` label block + `drawLabels()`.
- **What:** When `f.interacting`, skip label collection and `drawLabels` entirely (keep the
  glyphs/sprites). Labels you can't read while the map is sliding aren't missed, and they snap
  back the instant the gesture ends — exactly the trade TrailLayer already makes. As a smaller
  at-rest win, reuse a hoisted `jobs` array (reset `.length = 0`) and sort indices in place
  rather than spreading into new arrays.
- **Expected impact:** Moderate on a busy sky during gestures (text is a real cost); small but
  steady at rest from the array reuse.
- **Risk:** Low. One judgment call: if the owner wants the selected aircraft's label to persist
  during a pan, keep just that one job.

---

## PRIORITY 5 — Code-split the inlined rail/highway geometry (startup + memory, not frame time)

`rail.ts` (~214 KB) and `highways.ts` (~127 KB) are inlined coordinate literals imported
**eagerly** in Display.tsx (lines 20-21) and pulled in transitively by RailLayer / HighwayLayer
/ livetrains / Renderer. That's ~340 KB of source the engine must parse as JS at cold start,
resident in memory forever — even though highways are off by default and rail rides a toggle.
This does **not** affect steady-state frame time, but it hurts first-paint responsiveness and
memory headroom on the Pi (which indirectly affects GC pauses during browsing).

- **Where:** the static imports in `Display.tsx`, `RailLayer.ts`, `HighwayLayer.ts`,
  `livetrains.ts`, plus the module-load side effects `buildTunnelSpans()` (RailLayer.ts ~29)
  and `LINE_BY_ID` (livetrains.ts ~59).
- **What:** Move the heavy payloads behind dynamic `import()` — load `highways.ts` only when
  `showHighways` first goes true, and `rail.ts`/geometry only when `showRail` first goes true.
  Or split the coordinates into JSON assets fetched on demand (`JSON.parse` of a blob evaluates
  faster than a giant JS array literal). Each consumer needs a small async-init guard since they
  import synchronously today and run side effects at module load.
- **Expected impact:** Large on bundle/parse/startup and resident memory; neutral on
  steady-state frame time. This is the structural change the audit flagged (#6) and remains the
  right "browse responsiveness" win once the gesture-frame cuts above are done.
- **Risk:** Medium — it changes module init order and adds async guards; do it as its own
  well-tested change, after the cheaper Priority 1-4 wins.

---

## On the "cache static layers" structural option

The prompt asks whether rendering the rarely-changing basemap/rail/highway to an offscreen
canvas and transform-blitting during gestures is the big structural win. **For the basemap and
the static airport/label vectors, it already exists** (MapLayer, StaticOverlayLayer) and is the
model to imitate. **Rail and highway are the holdouts** — they reproject (decimated) every
gesture frame instead of baking to a buffer. Wrapping them in the same `StaticOverlayLayer`
cache-and-blit is feasible *for the static line geometry* (the track ribbon, the highway flow
wash, the station rings) and would drop their gesture cost to one `drawImage` each — strictly
better than even decimated reprojection.

- **Caveat / risk:** their *dynamic* content (live trains, scrolling congestion dashes, station
  bloom that breathes with train proximity, scrolling cars) cannot be baked — it must still
  draw live on top of the blitted static buffer. So the clean split is: bake the **track ribbon
  + tunnel hairline + station markers** (RailLayer) and the **flow ribbon** (HighwayLayer) into
  cached buffers à la StaticOverlayLayer; keep trains/cars/bloom as thin live overlays. That is
  more rework than Priorities 1-4 and partly overlaps with them (the decimation already tames
  the reproject cost), so it is a *Phase 2* structural cleanup, not the first move. Given the
  cap (Priority 1) plus the per-frame cuts, it may not be needed; re-measure before committing
  to it.

---

## Recommended sequencing

1. **★ Priority 1 — cap the gesture loop to ~36 fps on the Pi.** One line, biggest leverage,
   multiplies every other saving. Measure on the panel first; it may suffice alone.
2. **Priority 2 — finish RailLayer gating** (per-frame `liveTrains()` once on FrameContext,
   skip/throttle the station scan while interacting, hoist `coreDim`). Cheap, stacks.
3. **Priority 3 — skip transit gradient ornaments mid-gesture** (train tails, ferry wakes, bus
   tails); flatten the easy ones at rest. Removes GC churn from the hot frames.
4. **Priority 4 — skip aircraft labels while interacting**; reuse the jobs array at rest.
5. **Priority 5 — code-split rail.ts / highways.ts** for first-paint + memory (separate,
   well-tested change).
6. **Phase 2 (optional) — bake RailLayer/HighwayLayer static geometry into StaticOverlayLayer
   buffers**, leaving trains/cars/bloom as live overlays — only if 1-4 don't hit budget.

Leave `MapLayer` and `StaticOverlayLayer` alone — their gesture path (transform-blit, re-bake
on settle) is already the correct model.
