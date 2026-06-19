# SkyView 2 — Runtime Optimization Audit

A read-only performance pass over the per-frame render hot path and allocation pressure,
prioritized for a Raspberry Pi 5 running an always-on canvas map at ~60 fps, 24/7. The Go
backend feeds were reviewed too, but they are already efficient (timer-based polling at
20–60 s, mutex-guarded snapshots, disk-cache fallback, bounded result slices) and are not
the bottleneck. Everything below is in `web/src/display/render/`. Findings are ordered by
expected frame-time impact, with safe quick wins called out separately from larger reworks.

The architecture is mostly sound: the Camera is built once per frame, the visible aircraft
set is sampled once, sprites are cached and colour-bucketed, the altitude/congestion ramps
are LUTs, label widths and per-hex strobe seeds are memoized, and the highway/rail geometry
is projected into a view-keyed cache so there is genuinely zero projection at rest. The
remaining wins are concentrated in (a) gesture-time reprojection of large polylines, (b)
per-vehicle gradient and array churn in the transit layers, (c) redundant per-aircraft work
in the aircraft layer, and (d) a static bundle that inlines ~225k tokens of geometry.

## Top priority — safe quick wins

**1. RailLayer reprojects ~4,900 vertices on every frame of a pan/zoom gesture.**
`RailLayer.ensureProjected()` keys its cache on the full view string, which includes the
transient pan/zoom override. That is the correct design at rest (zero work), but *during* an
interaction the key changes every frame, so the entire `RAIL_SEGMENTS` set (~4,900 points
per the design note, plus `TUNNEL_SPANS`) is re-`project()`ed each frame — exactly when the
frame budget is tightest and the user is most sensitive to jank. `HighwayLayer` has the
identical pattern over ~5,300 points. Two complementary fixes: first, during interaction
(`f.interacting`) draw the cached projection translated/scaled by the delta from the cached
camera instead of reprojecting (an affine nudge of already-computed screen points is far
cheaper than 10,000 Mercator projections and is visually indistinguishable for a frame or
two); or, more simply, decimate the polylines by zoom level (Ramer–Douglas–Peucker or a
fixed stride) so that when zoomed out you project a few hundred points rather than thousands.
The second is the bigger structural win and also shrinks the draw call count. Expected
impact: large — this is the single most expensive thing that can happen in a frame, and it
happens precisely during gestures.

**2. `liveTrains()` (and the other `live*()` accessors) rebuild a fresh array every call, and
some are called more than once per frame.** `liveTrains()` walks the vehicle map, allocates a
new `LiveTrain[]`, and for on-line vehicles calls `posAt()` twice (head + tail) plus
`lineLength()` each invocation. It is called in `TrainLayer.draw()` *and* again in
`RailLayer.draw()` (for the station bloom proximity test) every frame — so the whole array
plus all the `posAt` arc-length walks are computed twice per frame. Cache the result once per
frame: compute the array in the renderer (or memoize on a frame counter / `f.t`) and pass it
through `FrameContext`, or have `liveTrains()` return a cached array invalidated only by
`tickLiveTrains()`. Same applies to `liveFerries()`/`liveBuses()`/`fireIncidents()`, which
each allocate a fresh array per call but are at least only called once. Expected impact:
moderate, and it removes a duplicated arc-length pass.

**3. AircraftLayer computes the local-arrival field redundantly per aircraft.**
`arrivingLocal(a)` (which calls `arrivalField(a)`, a glidepath/alignment test over all local
fields) is invoked in the main loop for the landing-light gate *and* again inside
`labelLines()` for the destination string — twice per aircraft per frame. `departingLocal()`
adds another `nearestLocalField()` scan inside `labelLines`. Compute `arrivingLocal(a)` once
near the top of the per-aircraft block and thread it into both the landing-light check and
`labelLines()`. Also `seedFor(a.hex)` is memoized (good) but is called up to four times per
airborne aircraft per frame (airborne glow seed, landing-light flick, landing-light shimmer,
nav lights) — fetch it once. Expected impact: small-to-moderate on a busy sky, and trivially
safe.

**4. Per-vehicle gradients are created every frame in the transit layers.**
`TrainLayer` creates a `createLinearGradient` for every live train's comet tail (and a second
for submerged ghosts), `BusLayer` one per bus, `FerryLayer` two-to-three per moving ferry
(wake legs + centerline froth), and `AircraftLayer` creates a linear gradient per
landing-light beam and per takeoff/landing streak. Gradient objects are among the more
expensive canvas allocations and they churn the GC. Where the gradient is a simple
fade-to-transparent along a short segment (bus/train tails), a flat `strokeStyle` with a
single mid-alpha, or a globalAlpha taper, reads nearly identically at these sizes and avoids
the allocation entirely. For the ferry wake, the gradient endpoints are in the rotated local
frame and constant in shape — it can be built once per (speed-bucket) and reused, or replaced
with a 2-stop flat stroke. Expected impact: moderate on the GC / allocation pressure that
matters most for a 24/7 process; low risk visually.

**5. AircraftLayer allocates a `LabelJob[]` plus an object per labelled aircraft, then copies
it two-to-three times for sorting.** Each frame builds `jobs: LabelJob[]`, pushes a fresh
object per labelled aircraft, then `drawLabels` does `[...jobs].sort(...)` (and in the
adaptive path a second `[...jobs].sort(...)`), allocating full copies. Hoist a reusable
`jobs` array on the layer instance and reset its length each frame (reuse the objects too via
a small pool keyed by index), and sort indices or sort in place rather than spreading into new
arrays. Expected impact: small per frame but steady — this is pure churn on the busiest layer.

## Larger reworks

**6. Bundle size: ~225k tokens of geometry are statically inlined and code-split-able.**
`rail.ts` is ~160k tokens and `highways.ts` ~66k tokens of inlined coordinate literals, both
imported eagerly, which is the bulk of the ~889 KB bundle. Neither is needed for the first
paint: highways are off by default, and rail/trains ride the rail toggle. Move the heavy
coordinate payloads behind dynamic `import()` (load `highways.ts` only when `showHighways`
first goes true, `rail.ts`/geometry when `showRail` first goes true), or split them into
JSON assets fetched on demand and parsed once. `JSON.parse` of a coordinate blob is also
meaningfully faster to evaluate than a giant JS array literal the engine must parse as code,
which helps cold-start on the Pi. This is a real win for initial load and memory residency,
but it is a structural change (the layers and `livetrains`/`RailLayer` import these
synchronously today, and `buildTunnelSpans()`/`LINE_BY_ID` run at module load), so it needs
a small async-init guard in each consumer. Expected impact: large on bundle/parse/startup;
neutral on steady-state frame time.

**7. RailLayer station bloom is O(stations × live trains) every frame, plus a `coreDim()`
call inside the inner loop.** For each on-screen station it scans every live train to find the
nearest (`distNMrail`), every frame. Station and train counts are small today, but this is the
kind of nested loop that compounds with the aircraft/incident/bus growth the audit asked
about. Since trains move slowly and the proximity only drives a halo radius and a 30 s-cooldown
ring, compute the per-station nearest-train distance at a lower cadence (e.g. every ~0.25 s,
or only when `liveTrains()` actually changed) and cache it. Also `coreDim()` is called once
per station inside the loop (and again in the core fill) — hoist it to one call per frame like
the other layers already do. Expected impact: small now, but it is the most likely O(n·m) to
bite as feeds grow; the `coreDim` hoist is a free quick win.

**8. Two full passes over `f.aircraft` in AircraftLayer.** The main draw loop iterates all
aircraft, then a second loop iterates them again for the takeoff/landing flourish (and a third
implicit pass via the `f.cfg.showTraffic === false ? [] : f.aircraft` guard re-evaluated).
The flourish loop only acts on aircraft with an active `transitAge`, which is a tiny minority;
collect those few into a small list during the first pass (or skip-test cheaply) rather than
re-scanning the whole set. Expected impact: small, scales with traffic count.

## Notes and non-issues

`path.ts` is well-built: `cumLen` is memoized per line via a `WeakMap`, and `lineLength`
rides that memo, so the arc-length engine itself does no repeated O(n) work — the only waste
is calling `posAt`/`lineLength` more often than necessary (covered in #2). `project()` does a
full O(vertices) nearest-segment scan, but it runs only in the ~20 s/15 s poll handlers, not
per frame, so it is fine. The Camera, sprite cache, colour LUTs, hex/label/seed memos, and
the trail-window walk in `TrackStore.sample()` are all already optimized and should be left
alone. The `renderScale` lever and the gesture FPS uncap in `Renderer` are good existing
controls. The Go feeds need no changes for efficiency; if anything is touched there it should
be correctness, not performance.

Suggested sequencing: do the quick wins (#1 decimation or affine-nudge, #2 per-frame live*
caching, #3 redundant arrival/seed calls, #4 gradient removal where flat reads the same, #5
job-array reuse, plus the #7 `coreDim` hoist) first — they are low-risk and target the
hottest paths. Tackle the bundle code-split (#6) as a separate, well-tested change since it
alters module init order.
