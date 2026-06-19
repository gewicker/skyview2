# SkyView 2 — Gesture (Pan/Zoom) Hot Path

A focused, read-only diagnosis of map-navigation lag *during* pan/zoom on the Pi 5, and a
prioritized, low-risk fix plan. This narrows the general `OPTIMIZATION-AUDIT.md` to the one
thing that only happens while the finger is down: large-polyline reprojection on an uncapped
loop. All findings are grounded in the actual call sites; line numbers are as of this audit.

---

## 1. Why gestures specifically are slow

### 1a. The frame loop runs UNCAPPED during a gesture
`Renderer.start()` (`web/src/display/render/Renderer.ts`, lines ~65–81):

```ts
const interacting = now - this.lastInteractAt < 220;
if (interacting) {
  this.nextDue = 0; // uncapped during a gesture (smooth pan on fast displays)
}
```

`lastInteractAt` is stamped on every `panByPixels()` / `zoomAt()` call. So for the duration
of a gesture (and 220 ms after the last input event) the `maxFps` throttle is bypassed and
`draw()` is called on *every* `requestAnimationFrame` — i.e. as fast as the panel will go.
This is the intended "smooth pan" behavior, but it means **whatever per-frame work each layer
does is now executed at the maximum frame rate, precisely while the most expensive per-frame
work (reprojection, below) is also being triggered.** The uncap multiplies the cost of 1b/1c.

### 1b. RailLayer reprojects ~4,900 vertices on EVERY gesture frame
`RailLayer.ensureProjected()` (`RailLayer.ts`, lines ~47–64):

```ts
const v = f.view;
const key = `${v.mapCenterLat},${v.mapCenterLon},${v.mapZoom},${f.cfg.mapRotationDeg},...`;
if (key === this.projKey) return;       // at rest: hit, zero work
this.projKey = key;
for (...RAIL_SEGMENTS...) pts.push(f.cam.project(lat, lon));   // ~4,900 projects
for (...TUNNEL_SPANS...)  pts.push(f.cam.project(lat, lon));   // + tunnel spans
```

The cache key embeds `f.view` (`mapCenterLat/Lon/Zoom`). During a gesture the `override` view
changes **every single frame** (set fresh in `panByPixels`/`zoomAt`), so the key never matches
and the *entire* `RAIL_SEGMENTS` set (~4,900 points per the rail.ts/RailLayer header note,
plus `TUNNEL_SPANS`) is re-`project()`ed every frame. This is the correct design at rest (the
key is stable → zero projection), but it is pathological during interaction.

Each `cam.project()` (`mercator.ts`, lines ~71–80) is **not** cheap: it calls `llToWorld()`
which does a `Math.sin` and a `Math.log` per point, then a rotation (cos/sin multiply),
mirror, and offset. So a single rail reprojection is ~4,900 × (sin + log + ~6 mults). On an
uncapped loop that is the dominant cost of the frame.

### 1c. HighwayLayer has the identical pattern over ~5,300 vertices
`HighwayLayer.ensureProjected()` (`HighwayLayer.ts`, lines ~49–65) uses the byte-for-byte same
view-keyed cache over the flattened `HIGHWAYS` segments (~5,300 points per the layer's own PERF
comment). When `showHighways` is on, gestures pay **another ~5,300 Mercator projections per
frame** on top of rail. (Off by default, so this only bites users who enabled highways — but
when on it roughly doubles the reprojection bill.)

**Combined worst case (rail + highways both on):** ~10,200 full Mercator projections *per
frame*, at uncapped frame rate, on a Pi 5 software-ish canvas. That is the gesture lag.

### 1d. Secondary per-frame churn that the uncap also amplifies
- **RailLayer station loop** (`RailLayer.ts` ~104–131): each frame it calls
  `f.cam.project(s.lat, s.lon)` per station, and for every station scans every live train
  (`distNMrail`) — O(stations × trains). Small today, but it runs at uncapped rate during
  gestures too.
- **`liveTrains()` called twice per frame**: once in `RailLayer.draw()` (line ~102, for the
  station bloom) and again in `TrainLayer.draw()`. Each call rebuilds a fresh `LiveTrain[]`
  and runs `posAt()`/`lineLength()` arc-length walks (`livetrains.ts` ~156–175). Doubled, and
  at uncapped rate. (Same shape for `liveFerries`/`liveBuses`/`fireIncidents`, each once.)
- **MapLayer is NOT a problem during gestures** — it is already correct: while
  `f.interacting` it only transform-blits the cached buffer (one `drawImage`) and re-rasterizes
  only when the oversized buffer stops covering the viewport (`MapLayer.ts` ~39–52, `covers()`).
  Leave it alone.

---

## 2. Fix plan (prioritized)

### ★ HIGHEST-IMPACT QUICK WIN — Decimate rail/highway polylines while `interacting`

**The single change that removes most of the lag.** During a gesture the user cannot perceive
sub-pixel vertex fidelity on a moving polyline, so project only a strided subset.

- **Where:** `RailLayer.ensureProjected()` and `HighwayLayer.ensureProjected()`.
- **What:** When `f.interacting` is true, project every *N*th vertex (always keep the first and
  last of each segment so endpoints stay anchored), and tag the cache key with the stride so a
  settled frame rebuilds at full fidelity. Concretely:
  - Add the interacting flag + stride to the key:
    `const stride = f.interacting ? 4 : 1;` and append `,${stride}` to `key`.
  - In the projection loop, step by `stride` and force-push the final vertex:
    `for (let j = 0; j < seg.length; j += stride) pts.push(cam.project(...));`
    then `if last index not included, push it`.
  - A stride of 4 cuts ~4,900 → ~1,225 rail projections and ~5,300 → ~1,325 highway
    projections per gesture frame (~75% reduction). Stride 3–5 is imperceptible on a moving
    map; the full-fidelity reproject fires the instant the gesture ends (key drops the stride
    → cache miss → one clean reproject, then cached at rest).
- **Expected impact:** Large. ~4× fewer Mercator projections on exactly the frames that are
  tight. This is the recommended first move.
- **Risk:** Low. Lines look very slightly coarser *only while actively dragging*; they snap to
  full detail on release. No data/geometry change, no change at rest. Keep the existing
  `onScreen()` cull and `stroke()` path as-is. One caveat: decimation must keep endpoints or a
  long segment can visibly "shorten" — the force-push of the last vertex handles that.

### 2. (Alternative / complement to ★) Affine-nudge the cached projection during a gesture

Instead of (or in addition to) decimating, reuse the *already-projected* screen points and
transform them by the delta from the cached camera, exactly the way `MapLayer.blit()` already
does for the basemap (translate by `cam.project(cachedCenter)` and scale by
`liveZoom / cachedZoom`).

- **Where:** `RailLayer.draw()` / `HighwayLayer.draw()` — when `f.interacting` and a prior
  projection exists, skip `ensureProjected` and instead `ctx.translate/scale` the canvas before
  stroking the cached `proj[]` points (which were computed at the cached view).
- **What:** Cache the `Camera` (or its center+zoom) alongside `proj`. On an interacting frame,
  compute `s = liveZoom/cachedZoom` and `o = liveCam.project(cachedCenterLat, cachedCenterLon)`,
  set the transform, draw cached points, restore. Reproject fully only when settled (or when
  `s` drifts beyond, say, ±15% so accumulated Mercator skew doesn't show).
- **Expected impact:** Large — drops gesture-time projection to ~zero (one `project` call for
  the anchor). Strokes become a single transformed draw.
- **Risk:** Medium. Mercator is conformal but not affine, so a pure translate+scale of
  pre-projected points is slightly *wrong* at high zoom/large pan (the same approximation
  MapLayer already accepts for the basemap, so rail/highway will at least stay visually
  consistent *with* the basemap during the gesture — arguably better registration than the
  decimate path). Bounding the reproject to small `s` drift keeps it invisible. More code than
  the decimate win; do ★ first, add this only if needed.

### 3. Skip the glow under-stroke pass while interacting

Each rail segment currently draws **three** strokes (wide soft glow @9·wm, body @2.6·wm,
hairline @1·wm) — `RailLayer.ts` ~87–99 — and each highway segment draws a glow under-stroke
plus a core stroke (`drawFlowSeg`, `HighwayLayer.ts` ~141–159). The wide glow pass is the most
expensive (widest stroke = most pixels touched) and is pure ornament.

- **Where:** `RailLayer.draw()` line loop; `HighwayLayer.drawFlowSeg()`.
- **What:** When `f.interacting`, drop the 9·wm glow under-stroke (rail) and the `width*2`
  glow under-stroke (highway), keeping only the body/core. Restore on settle.
- **Expected impact:** Moderate — fewer wide-fill rasterization passes per frame; compounds
  with #1 because it's also a per-segment cost.
- **Risk:** Very low. Glow returns the instant the gesture ends; during motion the bloom is not
  missed.

### 4. Cache `liveTrains()` once per frame

- **Where:** compute the array once in `Renderer.draw()` and thread it through `FrameContext`
  (e.g. `f.trains`), or memoize `liveTrains()` on a frame counter / `f.t` and invalidate in
  `tickLiveTrains()`.
- **What:** Replace the second call site (`RailLayer.draw()` line ~102) and the `TrainLayer`
  call with the shared array. Removes one full `LiveTrain[]` rebuild + duplicate `posAt`/
  `lineLength` arc-length walks per frame.
- **Expected impact:** Moderate (and it's doubled by the gesture uncap). Also helps at rest.
- **Risk:** Low — pure caching, same data.

### 5. Hoist per-station `cam.project` and `coreDim()` out of the inner work

- **Where:** `RailLayer.draw()` station loop (~104–131).
- **What:** `coreDim()` is recomputed implicitly per station in the core-fill string; hoist it
  to one call/frame (the other layers already do this). The nearest-train proximity scan can be
  computed at a lower cadence (e.g. every ~0.25 s) and cached, since trains move slowly — this
  removes the O(stations × trains) work from most frames.
- **Expected impact:** Small now, but it's O(n·m) and runs at uncapped rate during gestures.
- **Risk:** Low.

### 6. (Optional) Tighten the interaction window / cap gesture FPS on the Pi

The 220 ms uncap window (`Renderer.ts` line ~67) keeps the loop uncapped for 220 ms after the
last input. If, after #1–#3, the Pi still can't hit refresh, consider *capping* the gesture
loop to a fixed budget (e.g. honor `maxFps` even while interacting, or a separate
`gestureFps`) rather than running fully uncapped — on the Pi, uncapped just means "produce
janky partial frames as fast as possible." This is a behavioral tradeoff (smoothness on fast
panels vs. consistent frame pacing on the Pi), so treat it as a tuning lever, not a default
flip.
- **Risk:** Medium — changes the feel; validate on the actual panel.

---

## 3. Recommended sequencing

1. **Do ★ (decimate rail + highway while `interacting`)** — biggest win, lowest risk, ~4×
   fewer projections on the hot frames. Ship and measure on the Pi first; it may be sufficient
   on its own.
2. Add **#3 (skip glow under-stroke during gesture)** and **#4 (cache `liveTrains()` per
   frame)** — both cheap, both compound with #1.
3. If still short of budget, evaluate **#2 (affine-nudge)** as a deeper replacement for the
   per-frame reproject, and/or **#6 (gesture FPS cap)** as a Pi-specific pacing lever.
4. **#5** is a free hoist to fold in opportunistically.

Leave `MapLayer` untouched — its gesture path (transform-blit, re-raster only on settle/
coverage loss) is already the model the rail/highway fix should imitate.

---

## 4. Verification notes

- Counts (~4,900 rail incl. tunnel spans; ~5,300 highway) are taken from the layers' own PERF
  headers and `OPTIMIZATION-AUDIT.md` #1; `rail.ts`/`highways.ts` are single-line inlined
  literals too large to re-tokenize here, but `RAIL_SEGMENTS` is the array iterated in
  `ensureProjected` and the only rail projection input, so the count is load-bearing and
  consistent across sources.
- The uncap, the view-keyed caches, and the duplicate `liveTrains()` calls were all confirmed
  directly in source at the cited line ranges. The MapLayer gesture path was confirmed to
  already transform-blit (not the bottleneck).
