# QA Scrub — v6 (bus route reveal · transit despawn · airport view · entry affordance)

> **Status 2026-06-19 — fixes applied (pending deploy).** P1-1 `busAhead` now gated on `onLine`;
> P1-2 transit card despawns when its feed is toggled off; P1-3 entry chip no longer flickers
> (debounced hide + chip enter/leave). P2-1 zero-length gradient guard, P2-2 head-vertex de-dup,
> P2-4 `dt` clamped in the render loop, P2-5 named `FIELD_ENTRY_ZOOM`. P0-1 addressed pragmatically:
> the four live feeds skip the fetch when `document.hidden` (the airport tab doesn't start these
> feeds and the kiosk is a permanent single timer, so a full teardown isn't warranted). P2-3 (tail
> collapse) and P2-6 (station-by-name, verified unique) left as noted.

Bug audit only — **no fixes applied**. Findings are ordered by severity. Each cites file · symbol ·
line region, the defect, how it manifests, and a suggested fix. A "verified clean" section at the end
records coverage so you know what was checked and found solid.

Scope prioritised the recently-changed v5/v6 surfaces, then widened to the render loop, track store, and
the live feeds / Go handlers.

---

## P0 — crash / wrong output / leak

### P0-1 · Live-feed polls leak a `setInterval` on every layer that polls — never cleared
`livebuses.ts startLiveBuses` (L171–172), `livetrains.ts startLiveTrains` (L117–118),
`liveferries.ts startLiveFerries` (L70–71), `livefire.ts startLiveFire` (L65–66).

Each `start*()` does `poll(); setInterval(poll, …)` and stores nothing — there is **no clear path**.
The guard `if (started) return;` makes it idempotent per page load, so on the always-on kiosk it's a
single permanent interval (acceptable there). But the **v6 airport page is a second SPA entry** that
imports the same modules; the module-level `started`/`vehicles`/`setInterval` live in that bundle's own
module instance, so the airport tab starts its own intervals that also never stop. More importantly, in
dev (`<StrictMode>` in both `main.tsx` files) and on any client that navigates display ⇄ airport, the
interval and its `vehicles`/`incidents` maps persist for the life of the document with no unmount hook.

Manifestation: not a hard crash, but an un-stoppable 20–30 s timer + unbounded module-global state per
tab. Combined with the `Renderer`/`useStream` effects (which *do* clean up), the feed timer is the one
resource with no teardown. On a long-lived airport tab it keeps fetching forever even with the canvas torn
down.

Suggested fix: have `start*()` return (or store) the interval id and expose a `stop*()` that
`clearInterval`s and flips `started=false`; call it from the layer/Renderer teardown, or gate polling on a
visibility/`AbortController`. At minimum, pause polling when `document.hidden`.

> Severity note: this is the strongest "leak" finding but it is a *steady-state* leak (one timer), not
> growth-per-event. If you consider a single never-cleared interval acceptable on a kiosk-class device,
> downgrade to P2 — but the airport view makes it a real second offender now.

---

## P1 — real bug under narrow conditions

### P1-1 · `busAhead()` slices from a STALE arc position once a bus goes off-route
`livebuses.ts busAhead` (L237–255) gated on `v.hasArc`; `tickLiveBuses` advances `v.s` only `if (v.ln && v.hasArc && v.onLine)` (L192).

`busAhead` and `liveBuses` (the road-snapped branch, L209) both require `v.onLine` for *position*, but
`busAhead` requires only `v.hasArc`. When a poll lands a fix farther than `GATE_M` off the shape,
`v.onLine` is set false (L162) — the bead correctly falls back to velocity and stops being drawn on the
road — **but `busAhead` still returns the ahead-slice computed from the now-frozen `v.s`.** The
`BusRouteLayer` then draws a route line whose head no longer sits under the bead (the bead is at the
velocity-fallback lat/lon, the line head is at the last on-line `posAt(v.s)`). They visibly diverge.

Manifestation: tap a bus that subsequently drifts off its shape (GPS noise, reroute, shape lag) → the
violet route line detaches from the bus bead and points off from a stale spot until the next on-line fix.

Suggested fix: gate `busAhead` on `v.onLine` as well (mirror `liveBuses`/the layer): `if (!v || !v.ln || !v.hasArc || !v.onLine || v.ln.path.length < 2) return null;`. The layer already no-ops on null, so
the line simply disappears for off-route buses — which matches the documented "velocity-fallback buses get
no line" intent in the file header.

### P1-2 · Transit despawn can't fire when the feed layer stops ticking after toggle-off
`Display.tsx` despawn effect (L182–186) → `Renderer.onScreenTransit` (L224–238); feeds tick only inside their layer's `draw` while the toggle is on (`BusLayer.ts` L20–23, and the train/ferry/fire layers similarly).

`onScreenTransit` resolves the tapped element's *current* position by calling `liveBuses()/liveTrains()/…`
which read the module `vehicles` map. Those maps are only advanced by `tick*` **inside the layer's
`draw`, which early-returns when `f.cfg.showBuses` (etc.) is false**. If a user taps a bus/train/ferry to
open the card and then turns that feed OFF in settings, the layer stops ticking, `liveBuses()` keeps
returning the last (now frozen) entry, so `onScreenTransit` still finds it on-screen and the card never
despawns — it lingers over a vehicle that is no longer rendered.

Manifestation: card stuck open over an invisible vehicle after toggling its feed off (until you pan it
off-screen or close it manually).

Suggested fix: when `setTransit` is set, also clear it if the relevant `cfg.show*` goes false — either add
the toggle to the despawn effect's logic, or have `onScreenTransit` consult the live cfg and return false
when the element's feed is disabled. (Low blast radius; the card has a manual close, so it's a polish bug.)

### P1-3 · Airport-view entry button flickers when the cursor reaches it (desktop hover)
`Display.tsx` `onMove` hover reveal (L281–285), `onPointerLeave` (L381), the button render (L398–412) anchored at `top: y − 40`.

Desktop hover shows the chip when the cursor is within 42 px of KSEA's projected point. The chip is an
absolutely-positioned `<button>` drawn 40 px **above** that point, overlapping the canvas. Moving the
cursor up onto the button triggers the canvas's `onPointerLeave`, which (since `canHover`) calls
`setAirportEntry(null)` → the button unmounts → the cursor is over the canvas again → `onMove` re-fires
and (if still within 42 px) re-shows it. Result: rapid show/hide flicker in the band between the field
point and the chip, and the click target is hard to hit.

Manifestation: the affordance strobes / is hard to click when you actually try to use it on desktop.

Suggested fix: don't clear on `pointerLeave` when the pointer is entering the chip — e.g. give the chip
`pointer-events` that don't bubble a canvas leave (it's a sibling, so the canvas leave still fires);
better, debounce the hide (short timeout cleared on re-enter), or compute the hover hit-zone to *include*
the chip's rect, or place the chip with `pointer-events:none` and a larger invisible hit area. Simplest:
keep `airportEntry` set while the pointer is over the chip (`onMouseEnter` on the button cancels the
pending clear).

---

## P2 — latent / robustness

### P2-1 · `BusRouteLayer` gradient degenerates when the path's first and last points coincide on screen
`BusRouteLayer.ts` (L60) `createLinearGradient(a.x, a.y, z.x, z.y)`.

When the ahead-slice's endpoints project to (nearly) the same pixel — bus essentially at its terminus, or
the whole remaining path is sub-pixel when zoomed way out — the gradient has zero length. Canvas renders a
zero-length linear gradient as the **last** color stop (the dim 0.22), so a near-terminus route briefly
draws uniformly dim rather than bright-at-bus. Not a crash (Canvas tolerates it), purely cosmetic.

Suggested fix: if `Math.hypot(z.x-a.x, z.y-a.y) < 1`, use a flat `rgba(col,0.7)` stroke instead of the
gradient.

### P2-2 · `busAhead` head point can duplicate the first vertex (degenerate first segment)
`livebuses.ts busAhead` (L241–252).

`pts` starts with `posAt(v.ln, v.s)` (the head). The forward loop then pushes every vertex with
`cum[i] > v.s`. If `v.s` sits exactly on a vertex (or within float noise below it), the head and that
vertex coincide, producing a zero-length first segment. Harmless to Canvas (round cap), but the dashed
flow phase math assumes monotone spacing; a duplicate point is a tiny visual stutter at the head.

Suggested fix: skip the first ahead-vertex if it's within ~1 m of the head (compare `cum[i]` to `v.s` with
a small epsilon), or de-dupe consecutive identical points before returning.

### P2-3 · `liveBuses()` road-snapped branch ignores `onLine` flapping mid-tick for the tail
`livebuses.ts liveBuses` (L209–217).

The road-snapped resolve uses `v.onLine`, set at poll time. Between polls a bus on a sharp shape doubling
back can have `v.s - v.dir*TAIL_M` clamp to 0/total (L214), collapsing the tail onto the head so the bead
has no heading (BusLayer then renders it level). Cosmetic only; the velocity fallback would have given a
heading. Acceptable, noting for completeness.

### P2-4 · `pxPerSec`/dash flow uses `f.dt` unbounded on first frame / tab-refocus
`BusRouteLayer.ts` (L59) `this.phase = (this.phase + pxPerSec * Math.max(0, f.dt)) % DASH`.

`f.dt` is `(now - prev)/1000` from the Renderer; after a backgrounded tab refocuses, `dt` can be huge.
`% DASH` keeps `phase` bounded, so no NaN/overflow — but the dash visibly jumps once. The same `dt` feeds
`tickLiveBuses`/`tickLiveTrains` (`v.s += dir*sVel*dt`) which can lurch the vehicle a large arc on the
first post-refocus frame. Renderer doesn't clamp `dt`. Robustness only.

Suggested fix: clamp `dt` in the Renderer loop (e.g. `Math.min(dt, 0.1)`), which also protects the track
store's dead-reckon.

### P2-5 · Airport-entry touch poll uses a fixed `mapZoom >= 3` gate that disagrees with the airport view's own framing
`Display.tsx` poll effect (L199) `const zoomed = (r.getView().mapZoom || 1) >= 3;`

Cosmetic/UX: the chip only appears on touch when zoomed to `mapZoom >= 3`, but the airport view opens at
`FIELD_ZOOM = 6`. The threshold is a reasonable "zoomed in on the field" gate, but it's a magic number
unrelated to anything else and will silently stop matching if the default map zoom semantics change. Not a
bug today. Consider deriving it from a named constant.

### P2-6 · `onScreenTransit` "station" match is by display name, not a stable id
`Renderer.ts onScreenTransit` (L228) `RAIL_STATIONS.find((s) => s.name === pick.title)`.

Verified there are currently **no duplicate station names** (41 stations, all unique — checked the data),
so this is correct today. Flagged only because it's name-keyed: if a future station shares a name (e.g. a
relocated/insertion), the despawn check would match the wrong coordinate. Low risk; note for the next data
update.

---

## Verified clean (checked, no issue found)

- **`busShapePath` / `busAhead` direction logic** (`livebuses.ts` L225–255): forward (`dir>=0`) walks
  `cum[i] > v.s` ascending; reverse walks `cum[i] < v.s` descending. Both correctly terminate at the right
  terminus and start at the exact bus head. The `< 2` empty/short-path guards are present in
  `lineForShape`, `busShapePath`, `busAhead`, and `BusRouteLayer.draw`. No null deref.
- **Server↔client bus shape contract**: `buses.go BusSnapshot.Shapes` is `map[shapeId][][lat,lon]`;
  `lineForShape` reads `p[0]=lat, p[1]=lon` with a `p.length < 2` skip. Consistent. `decodePolyline` is the
  standard precision-1e5 algorithm and returns `[]` (not nil-deref) on garbage.
- **Arc-length engine** (`path.ts`): `cumLen` memoised per line via `WeakMap`; `posAt` clamps `s≤0` and
  `s≥total`, binary-search segment, divides by `((c[hi]-c[lo])||1)` so no divide-by-zero;
  `project` handles `len2===0` (degenerate segment) with `t=0`. `lineLength` guards empty path. Solid.
- **`Renderer.zoomForMapZoom`** (L295–300): explicitly guards `Number.isFinite(z)` and `Math.max(1, w)`,
  so NaN/Inf never reaches the camera scale. `clamp` on zoom (0.3–14) present.
- **`Renderer.override` release** (L255, `viewMatches`): released the instant config matches (epsilon
  compare) *and* on the safety timer (`scheduleRelease`); the timer is `clearTimeout`'d before re-arming.
  No rubberband / no stuck override observed in the code path.
- **Transit despawn id matching** (`Renderer.onScreenTransit` L224–238 vs `TransitPick` L16–21 vs the
  construction sites in `Display.onUp` L316–323 and `pickTransit` L188–206): kinds and id types line up —
  `train`/`bus` string ids, `ferry` numeric id, `fire` string id, `station` by (unique) name. The
  discriminated union is exhaustively constructed and consumed; no missing arm.
- **Aircraft despawn** (`Display.tsx` L174–178 + `Renderer.onScreen` L211–218): returns `true` before the
  first camera, `false` when gone from `lastVisible`, margin test otherwise. Correct.
- **`projectLL`** (`Renderer.ts` L167–169): null before first frame, reuses `lastCam`, never mutates state.
  Used safely by both the hover handler and the touch poll (both null-check).
- **Airport view config** (`Airport.tsx` L40–49): forces a self-contained airport-locked `Config`; layers
  are a strict subset of the display's and all are construction-safe. `kseaCenter` averages real runway
  thresholds (no magic constant). `useEffect` cleans up renderer + resize listener.
- **Vite multi-entry + Go route** (`vite.config.ts` L18–23, `httpd.go` L186–209): `display`→`index.html`,
  `airport`→`airport.html`; Go serves `/airport`→`airport.html` and `/`→`index.html` with the file server
  for assets. `airport.html` references `/src/airport/main.tsx`. Consistent end-to-end; no SPA-fallback
  trap that would mis-serve `/airport`'s hashed assets.
- **`TrackStore`**: ingest gates (null-island, range, physical-plausibility, teleport w/ 2-fix
  corroboration), strictly-increasing timeline nudge, history cap (700) + prune (120 s / 30 s). Interp vs
  dead-reckon branches all return a position (no null past the initial `hist.length===0`). No unbounded
  growth — tracks pruned at 30 s, history trimmed. Solid.
- **`liveferries` / `livetrains` / `livefire` stores**: all prune by `lastSeen`/lifetime
  (ferries `DROP_S`, trains `DROP_S`/`DROP_MAX_S`, fire `LIFETIME_MIN`); maps don't grow unbounded.
  `livetrains` per-frame memo is invalidated on tick and bucketed by time — correct. Fire severity
  escalation keeps sticky `firstSeen`. No id collisions.
- **`mercator.ts`**: lat clamp to 85.05°, `worldToLL`/`llToWorld` inverse pair, mirror handling symmetric
  in `project`/`unproject`. Seattle is far from the antimeridian so the `(lon+180)/360` wrap is not
  exercised; great-circle in `RouteLayer` guards the `dd≈0` (coincident) case. No projection edge bug for
  this deployment.
- **`Display.tsx` effect hygiene**: the burn-in interval, projector-power interval, ui-hide timeout, and
  touch-entry interval are each cleared on unmount/dep-change. `TapCard` photo fetch uses an `alive` flag.
  The only un-cleared timers are the *feed* `setInterval`s in the live-store modules (see P0-1).
