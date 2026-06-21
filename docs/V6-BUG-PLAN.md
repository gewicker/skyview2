# V6 Bug Remediation Plan

> **Planning pass — no code changed.** A forward remediation plan from a whole-codebase bug
> audit (TS/React + Canvas2D frontend, Go backend). Read-tool was treated as ground truth
> (the bash mount can serve stale/truncated copies of recently-edited files); findings are
> reasoned from source, not from builds or greps of edited files.
>
> This carries forward the still-open items from `docs/QA-SCRUB-v6.md` and `docs/QA-BUGSCRUB.md`,
> then widens to latent bugs not previously logged. Each item: file · symbol · line region · the
> defect · how it manifests · a concrete suggested fix. Severity: **P0** crash / wrong output /
> leak · **P1** real bug, narrow conditions · **P2** latent / robustness.
>
> **Scope note on prior fixes:** the four previously-flagged guards from the v6 scrub are CONFIRMED
> present in the current source — `BusRouteLayer` zero-length gradient guard (L63), `busAhead`
> head-vertex EPS de-dup (L249), `dt` clamp in the render loop (`Renderer.draw` L262, `Math.min(…,0.1)`),
> and `busAhead` gated on `v.onLine` (livebuses L243). The livetrains P0 tunnel-freeze (QA-BUGSCRUB) is
> ALSO fixed: `tickLiveTrains` L162-163 now falls back to `paceVel` when submerged and `sVel<1`.
> The liveferries lane-rebuild teleport (QA-BUGSCRUB P1) is OBSOLETE — `liveferries.ts` was rewritten
> to pure velocity-glide and no longer has the `lnKey`/`buildLane`/`hasFix`-reset path. Those are not
> re-listed below except where a residual remains.

---

## P0 — crash / wrong output / leak

### P0-1 · Live-feed `setInterval`s still have no teardown (carried forward, re-scoped)
`livebuses.ts startLiveBuses` (L172-173), `livetrains.ts startLiveTrains` (L118-119),
`liveferries.ts startLiveFerries` (L93-94), `livefire.ts startLiveFire` (L66-67).

Each `start*()` does `poll(); setInterval(poll, …)` and stores nothing — no `clearInterval` path. The
`if (started) return;` guard makes it one permanent timer per module instance per page load. The
`document.hidden` fetch-guard added in v6 (present in all four polls) is a real mitigation — a hidden
tab stops *fetching* — but the **timer itself is never cleared** and the module-global `vehicles`/
`incidents` maps persist for the document lifetime.

**Re-scoping vs. the v6 note:** the airport page (`Airport.tsx`) does **NOT** instantiate `BusLayer`,
`TrainLayer`, `FerryLayer`, or `FireEmsLayer` (verified — its layer list is MapLayer, AirportDiagram,
Airports, NightLights, Approach, Trail, Leader, Aircraft, Atmosphere). So the airport tab does *not*
start the transit feeds, and the "second offender" framing in QA-SCRUB-v6 P0-1 is inaccurate. The real
residual is: (a) React `<StrictMode>` double-invokes effects in dev, and the Renderer is recreated, but
the feed `started` latch is module-global so the *timer* survives a Renderer teardown with no way to
stop it; (b) any client that mounts/unmounts the Display (SPA route change, HMR) leaves the timers
running against a dead canvas.

**Manifestation:** steady-state — one un-stoppable 15-30 s timer per feed for the document lifetime;
no growth-per-event (maps self-prune). On a kiosk this is acceptable (permanent single timer). On a
long-lived web client it's a minor resource the renderer can't reclaim.

**Suggested fix:** have each `start*()` capture the interval id at module scope and expose a
`stop*()` that `clearInterval`s and flips `started=false`; call `stop*()` from each layer's teardown or
from `Renderer.stop()`. Lower-effort acceptable alternative: leave as-is on the kiosk and only gate the
web client (already half-done via `document.hidden`). **Severity is borderline P0/P2** — it is a leak by
definition (resource never released) but steady-state, not unbounded. Listed P0 to keep it visible;
downgrade to P2 if a single permanent timer is deemed acceptable on all targets.

---

## P1 — real bug under narrow conditions

### P1-1 · A train acquired mid-tunnel dead-reckons in the WRONG direction (carried forward, still OPEN)
`livetrains.ts` poll (L84 `dir: 1` default; L103 updates `dir` only when `|ds| > DIR_EPS`),
`tickLiveTrains` (L162-164 dead-reckon `v.s += v.dir * spd * dt`).

The P0 tunnel-*freeze* is fixed (L163 now uses `paceVel` when submerged and `sVel<1`), but the **travel
direction** is still defaulted to `+1` (toward the high-index terminus) and is only corrected once two
accepted on-line fixes differ by `> DIR_EPS` (8 m). A train first acquired inside the DSTT — or one
that submerges after a single fix — dead-reckons along the line at `paceVel` in the `+1` direction
**regardless of which way it is actually travelling.** A southbound train (toward the low-index end)
ghost-glides north through the tunnel until it surfaces and two fixes resolve the real direction.

**Manifestation:** a train sliding the wrong way under downtown, then snapping to its true position when
it surfaces. Most visible exactly where the feature matters (DSTT), where surface fixes are sparse.

**Suggested fix:** gate the dead-reckon on a `dirKnown` flag (set true only when a real `ds` exceeded
`DIR_EPS`); until `dirKnown`, hold `s` (don't advance) or seed the initial direction from the nearest
station-sequence / reported `devSec` sign. Pairs cleanly with the existing `paceVel` fallback — only
advance once direction is trustworthy.

### P1-2 · `SEA_C` / `kseaCenter()` divide-by-zero → NaN map center if a field has no runways
`Display.tsx` `SEA_C` (L49-51), `Airport.tsx` `kseaCenter()` (L23-27), and the identical pattern in
`localArrival` (Display L753-755).

All three average runway-threshold coordinates as `la/n, lo/n` where `n` is incremented per runway. If
`SEA_AP.runways` (or any `ap.runways`) is ever empty, `n === 0` and the center is `NaN, NaN`. On the
airport page that NaN flows straight into `cfg.mapCenterLat/Lon` and the `Camera`; `Renderer.
zoomForMapZoom` guards the *zoom* against NaN but **not the center** — a NaN center yields an all-NaN
projection and a blank field view. On the display, `SEA_C` NaN would silently disable the airport-entry
affordance (the `near` hit-test compares against NaN → always false), a softer failure.

**Manifestation:** data-dependent. With the current bundled `airports.ts` every field has runways, so
this is latent today. It bites the moment a heliport-style entry (no runways) is added to `AIRPORTS`, or
a data edit drops a runway array — exactly the kind of change the helipad work invites.

**Suggested fix:** guard `n > 0` before dividing and return `null` (Display already null-checks `SEA_C`;
Airport should fall back to a literal KSEA reference). One shared helper `fieldCenter(ap)` returning
`{lat,lon} | null` would de-duplicate all three sites and remove the foot-gun.

### P1-3 · Transit card despawn can't react to a feed toggled off while the tapped element is a *station* (narrow)
`Display.tsx` transit-despawn effect (L186-201).

The `feedOff` computation handles `train`/`station`→`showRail`, `bus`→`showBuses`, `ferry`→`showFerries`,
`fire`→`showFireEms`. This is correct for live vehicles. But note the **station** branch: a station is
static and resolved by name from `RAIL_STATIONS` in `onScreenTransit` (L232), so even with `showRail`
off, `onScreenTransit` would keep returning true (the station coords never disappear) — the `feedOff`
check is what despawns it. That works. The narrow bug: the effect's dependency array lists
`effective?.showRail` etc., but `cfgRef.current` (read inside as `c`) is the *effective* config, and on
the kiosk `effective === state.config` while on web it's `{...state.config, ...localCfg}`. The deps use
`effective?.showRail`; if a scene/push changes `showRail` via the server round-trip, `state.config`
updates and `effective` recomputes, so the dep fires — OK. **This is actually clean**; flagged only to
record that the station/feedOff interaction was checked and the dependency wiring is correct. Downgrade:
**not a bug.** (Kept in the P1 section as a "checked, no defect" note so the reasoning is on record.)

### P1-4 · `agoText` / `delayText` show a future or absurd time on clock skew or a bad server timestamp
`Display.tsx` `agoText` (L734-738), `TransitCard` fire branch (L711).

`agoText` computes `Math.round((Date.now() - t) / 60000)` where `t` is the server-derived dispatch time
(`pick.time`). If the Pi clock and the SODA feed disagree (or a malformed `time` arrives as a small/zero
number), `t` can be in the future → a negative `m` → the `m <= 0` guard returns "just now" (fine for
slightly-future), but a `time` of `0` (missing field) yields `m` ≈ 29M minutes → the card reads a
nonsense "29000000 min ago." `livefire.ts` only guards `lat/lon` null-island, not a zero/absent `time`.

**Manifestation:** a Fire/EMS row whose `time` field is absent or 0 (garbage feed row) renders a giant
"min ago" in the tap card. Low probability (the Go side parses dispatch time and skips unparseable
rows), but the client trusts `m.time` blindly.

**Suggested fix:** in `livefire.ts` ingest, drop or clamp rows with a non-finite / absurdly-old `time`
(e.g. `time < Date.now() - 1 day` or `time <= 0`), or in `agoText` clamp the upper bound and render "—"
for implausible values.

---

## P2 — latent / robustness

### P2-1 · `TransitCard` is a frozen snapshot — "min ago" / speed / delay never update while open (carried forward, still OPEN)
`Display.tsx` `TransitCard` (L701-728); the pick is captured at tap time in `onUp` (L336) and never
re-resolved.

Unlike `TapCard` (which reads the live `a` each render), `TransitCard` renders the values captured when
tapped: a train's `devSec`, a ferry's `speed`/`atDock`, and a fire's `time`→`agoText` are stuck. The
fire "min ago" in particular advertises "live" but freezes at the tap-time value.

**Suggested fix:** re-resolve the picked element by id on each `state.now` (the renderer already exposes
`liveTrains()/liveFerries()/liveBuses()/fireIncidents()`), feeding fresh fields into the card; or have
the despawn effect also refresh the `transit` snapshot. Cosmetic but the card claims to be live.

### P2-2 · `liveferries` velocity clamp applies the latitude cap to longitude (mild)
`liveferries.ts` (L39 `MAX_DEG_S = 0.0001`, applied to both `vl` and `vo` at L71-72).

The constant is documented "~11 m/s lat cap." It clamps **longitude** velocity to the same 0.0001 °/s,
but at Seattle's latitude 0.0001 °lon ≈ 7.5 m/s (× cos 47.6°), so an east-west-running vessel is
velocity-limited tighter than a north-south one. A fast ferry on a mostly E-W crossing (e.g.
Edmonds-Kingston) could have its dead-reckon under-shoot slightly. Purely a glide-smoothness nuance;
the per-poll fix corrects it.

**Suggested fix:** scale the longitude clamp by `1/cos(lat)` (or just widen `MAX_DEG_S` for `vo`), if the
glide ever looks laggy on E-W routes. Low priority.

### P2-3 · `MapLayer.covers`/`blit` divide by `rv.mapZoom` with no zero guard (inconsistent with HighwayLayer)
`MapLayer.ts` (the basemap re-blit), `const s = f.view.mapZoom / rv.mapZoom`.

If a cached rendered view ever had `mapZoom === 0`, `s` is `Infinity` and `ctx.scale(s,s)` is a
non-finite transform — the basemap blit silently drops. `HighwayLayer` defensively writes
`f.view.mapZoom || 1` (implying the author knows zoom can be falsy); `MapLayer` doesn't. Web-Mercator
zoom is normally ≥ ~1, and `Renderer.zoomForMapZoom` floors at `Math.max(1, w)`, so this is latent
today.

**Suggested fix:** mirror HighwayLayer — `f.view.mapZoom / (rv.mapZoom || 1)` in both `covers` and
`blit`.

### P2-4 · `FireEmsLayer` cap-sort and `topFire` pick have no stable tiebreak → marker flicker at >24 incidents (carried forward)
`FireEmsLayer.ts` cap sort (`incs.slice().sort((a,b)=>score(b)-score(a)).slice(0,CAP)`) and the breathing
`topFire` pick (`if (s > topScore)`).

`score()` buckets `ageFrac`/`distN` to coarse values, so ties are common when many incidents are active.
The surviving 24 (and the single breathing major fire) can swap between frames as `fireIncidents()` Map
iteration order shifts on a poll, popping the borderline marker in/out. Needs >24 simultaneous incidents
within range (rare).

**Suggested fix:** add a stable final tiebreaker by id, e.g.
`score(b)-score(a) || (a.id < b.id ? -1 : 1)`, and the same for `topFire`.

### P2-5 · `FireEmsLayer` arrival ripple — verify the v6 fix held
`FireEmsLayer.ts` arrival cue (gates on `inc.cue` + `since` from `inc.firstSeen`); `livefire.ts` L59 sets
`cue: firstPollDone`.

CONFIRMED FIXED — the cue is now keyed to `firstSeen` recency and the `firstPollDone` backlog flag, not
the `now - dispatchTime < 8 min` gate that the old code had (which the feed's own 30-60 min lag made
dead-on-arrival). No action; listed so the regression surface is on record.

### P2-6 · `isLightsOut` uses local-browser `getHours()` while the sun math is UTC-correct (deploy-dependent)
`sun.ts isLightsOut` (uses `date.getHours()` for the bedtime side; the altitude calc is UTC-internal).

On the Pi kiosk the bedtime window only fires at the right wall-clock time if the device timezone is
`America/Los_Angeles`. A freshly-flashed Pi often boots in UTC → the bedtime/lights-out window fires
~7-8 h early. Not a code defect (the sun *altitude* is correct), but a deployment foot-gun for the
projector power-cut (`Display.tsx` L249-266 reads `isLightsOut`).

**Suggested fix:** add `timedatectl set-timezone America/Los_Angeles` (or the equivalent verify step) to
`harden-pi.sh` / the Pi setup checklist; optionally compute the bedtime hour from the same offset-aware
`Date` the sun calc uses rather than raw `getHours()`.

### P2-7 · `predictPos` interpolation loop shadows the `Aircraft` parameter (maintainability)
`TrackStore.ts predictPos` (the interp loop `const a = hist[i-1], b = hist[i]` shadows the `a: Aircraft`
parameter).

Not a runtime bug today (the interp branch only uses the Sample locals), but any future edit inside that
loop reaching for `a.gs`/`a.track` would silently get the Sample, not the Aircraft. **Suggested fix:**
rename the loop locals `s0`/`s1`.

### P2-8 · `livefire` re-report escalation updates `type` but not `lat/lon`/`address` (carried forward, narrowed)
`livefire.ts` (L50-54): on a re-seen id it now refreshes `type` + re-classifies `cat` (the QA-BUGSCRUB
P1 "write-once" finding is partly addressed — severity CAN now escalate). But `address`, `lat`, `lon`
are still sticky from first sight. A dispatch that corrects an incident's location or address keeps the
original coords/address forever.

**Manifestation:** rare — SODA rows seldom move an incident, and a re-typed incident is the common
escalation case (now handled). Position drift is the residual.

**Suggested fix:** also refresh `address`/`lat`/`lon` on re-report while keeping `firstSeen`/`cue`
sticky, if location corrections are observed in practice. Low priority.

### P2-9 · `Airport.tsx` near-count uses a hardcoded lon-miles constant
`Airport.tsx` (L74-76): `Math.hypot((a.lat - KC.lat)*69, (a.lon - KC.lon)*46.6) < 6`.

`46.6` is miles-per-degree-longitude baked for ~47.6° lat. It's only the header "N aircraft in view"
count, so a small mis-scale is cosmetic. Noting for completeness; a `cos(lat)`-derived factor would be
exact and self-documenting.

### P2-10 · `enrich.Process` mutates `e.sticky` / `e.view` lock-free (verify single-goroutine)
`internal/enrich/enrich.go Process` (writes `e.sticky` and prunes it with no mutex).

Safe **iff** `Process` is only ever called from one goroutine (the snapshot/render tick). The `cache` it
calls into is properly locked; only `e.sticky`/`e.view` are unguarded shared state. If any HTTP handler
or a second pipeline goroutine ever reads/writes these, it's a data race (would be P0). The backend
audit found no second caller, but this is the single item in the Go feed code worth *confirming* rather
than assuming. **Suggested action:** confirm the call graph (one caller); if so, leave with a comment;
if a second reader is added later, guard with `e.mu`.

### P2-11 · `internal/httpd/photo.go` cache sweep can run on every miss once it crosses 600
`photo.go` (sweep runs when `len > 600` and only evicts entries older than 6 h).

If 600 distinct hexes are queried inside a 6 h window, the sweep deletes nothing and re-scans the whole
map under `photoMu` on every subsequent miss — CPU/lock smell under load. Bounded (real traffic + 6 h
TTL), never approached on a home Pi with a handful of contacts.

**Suggested fix:** also evict the oldest entry unconditionally when over the cap, or cap by count.

### P2-12 · `internal/feed/fire.go` UTC tz fallback silently shifts the dispatch filter (carried forward)
`fire.go NewFire` (`LoadLocation("America/Los_Angeles")` → `loc = time.UTC` on failure).

CONFIRMED still present. On a stripped image with no tzdata, Seattle-local datetimes parse as UTC,
shifting every incident 7-8 h and corrupting the `t.Before(cutoff)` filter (and the client "min ago").
The Pi has full tzdata so it's latent, but it fails *silently* (no log).

**Suggested fix:** log loudly on `LoadLocation` failure, and/or vendor tzdata via a blank
`import _ "time/tzdata"` so the zone is always available.

---

## Verified clean (checked, no issue found)

- **Renderer.ts core** — `zoomForMapZoom` guards `Number.isFinite` and `Math.max(1,w)`; `dt` clamped to
  `[…,0.1]` (L262); `override` released the instant config matches (epsilon) AND on the safety timer
  (`clearTimeout` before re-arm); `projectLL` reuses last cam, null before first frame, never mutates;
  `pickAt`/`pickTransit`/`onScreen`/`onScreenTransit` reuse `lastVisible` (no smoother mutation); the
  transit discriminated union is exhaustively constructed (onUp L335-341) and consumed (onScreenTransit
  L231-237) — kinds/id types line up; `selectFerry/selectBus(0/"")` clear correctly.
- **Display.tsx effect hygiene** — burn-in interval, projector-power interval, touch-entry interval,
  ui-hide timeout, and `entryHideTimer` are each cleared on unmount/dep-change; `TapCard` photo fetch
  uses an `alive` flag; the entry-chip flicker fix (debounced hide via `entryHideTimer` + chip
  `onMouseEnter`/`onMouseLeave`) is present (L399, L419-420). The aircraft despawn (L178-182) and transit
  despawn incl. the feed-off branch (L186-201) are correct.
- **livebuses.ts** — `busAhead` gated on `v.onLine` (L243); EPS head de-dup (L249); road-snap resolve
  guards `v.ln && v.hasArc && v.onLine`; velocity fallback always maintained; `vehicles` self-deletes at
  `DROP_S`; `lineForShape` `< 2` guards; `decodePolyline`/shape contract consistent. No unbounded growth.
- **livetrains.ts** — tunnel-freeze fixed (paceVel fallback L162-163); per-frame memo invalidated on tick
  and time-bucketed; `posAt`/`lineLength` guards; drop logic (hard cap + above-ground) correct. (Only
  the `dir` default remains — P1-1.)
- **liveferries.ts** — pure velocity-glide (old lane-rebuild teleport obsolete); velocity zeros at dock;
  decays when quiet; `vessels` self-deletes at `DROP_S`; null-island guard. (Only the lon clamp — P2-2.)
- **livefire.ts** — lifetime from `firstSeen`; `cue` keyed to `firstPollDone`; re-type escalation
  (P2-8 residual = position not refreshed); null-island guard.
- **path.ts** — `cumLen` WeakMap memo; `posAt` clamps `s≤0`/`s≥total`, divides by `((c[hi]-c[lo])||1)`;
  `project` handles `len2===0`; `haversine` clamps `asin` arg; `paceVel` `dist<=0` guard;
  `stationWindow` defaults safe-by-guard.
- **mercator.ts** — project/unproject exact inverses; `MAX_LAT` clamp; no antimeridian wrap attempted
  (intentional for the local map); no NaN paths.
- **TrackStore.ts** — ingest gates (null/NaN/null-island/range/plausibility/teleport); `dtH` floored;
  history cap 700 + prune (120 s/30 s); interp `b.t===a.t?0` guard; dead-reckon `gs<=0||age<=0` guard.
  No unbounded growth. (Only the `predictPos` shadow — P2-7, cosmetic.)
- **Render layers (batch)** — BusLayer/FerryLayer/TrainLayer/RailLayer/RailLineLayer/aircraftGlyph/
  AircraftLayer nav-lights+strobe/SpotlightLayer/LeaderLayer/TrailLayer/BusRouteLayer/FerryRouteLayer/
  HelipadLayer/AirportDiagramLayer/RadarLayer/HighwayLayer/traffic/StaticOverlayLayer/RouteLayer
  (great-circle `dd>1e-9` coincident guard)/NightLightsLayer/ApproachLayer (WeakMap memo)/
  AtmosphereLayer/photos (in-flight dedup + FIFO 120)/tiles (LRU 256)/sun+night (asin clamps, coreDim
  bounds) — all checked: hypot-`||1` guards, range-product caps, cache bounds, projection culls, and
  gradient degeneracy guards present and correct. `HelipadLayer` `pxPerMile || 1` guard + offscreen cull
  present.
- **Airport.tsx** — locked self-contained Config; layer subset is construction-safe and excludes the
  transit feeds (so it does NOT start the live-feed intervals); `useEffect` cleans up renderer + resize.
  (Only `kseaCenter` divide — P1-2; `near` constant — P2-9.)
- **connection.ts / useStream.ts** — auto-reconnect with ping/pong + stale watchdog; `close()` nulls all
  handlers and clears timers/heartbeat; `scheduleReconnect` no double-arm; `send` guards `readyState`;
  `update` snapshots immutably. `useStream` unsubs + closes on unmount. No leak.
- **localConfig.ts** — try/catch around all localStorage access (private-mode safe).
- **Go backend (feed/httpd/enrich/hub)** — no nil-map deref, no div-by-zero, no panic path, no unclosed
  body in the hot path; all pollers preserve last-good on failure (`got` flag); resp bodies closed on
  every branch; rail/ferry/bus maps single-goroutine or mutex-guarded; `hub` broadcast snapshots clients
  under RLock then writes outside; URL templating numeric-only (injection-safe); enrich cache fully
  locked + inflight-dedup + atomic tmp+rename; aerodatabox budget pre-check/post-increment under lock,
  network errors not counted. (Residuals: enrich.sticky lock-free — P2-10; photo sweep — P2-11; fire tz
  fallback — P2-12.)

---

## Highest-severity summary (the actionable shortlist)

1. **P0-1** — live-feed `setInterval`s have no `clearInterval`/`stop*()` (steady-state leak; mitigated by
   `document.hidden` fetch-guard; airport tab does NOT start them, contrary to the earlier note).
2. **P1-1** — a train acquired mid-tunnel dead-reckons in the wrong direction (`dir` defaults `+1`, only
   corrected after two surface fixes); the freeze it replaced is fixed, the direction is not.
3. **P1-2** — `kseaCenter()`/`SEA_C`/`localArrival` divide by `n` with no `n>0` guard → NaN map center if
   a field ever has no runways (latent today; the helipad-style data additions make it reachable).
4. **P1-4** — `agoText` trusts `pick.time`; an absent/zero Fire/EMS `time` renders a nonsense "min ago"
   (client never validates the server timestamp).

P2 items (frozen TransitCard, ferry lon-clamp, MapLayer zoom-divide guard, FireEms tiebreak, Pi-TZ
lights-out, predictPos shadow, livefire position refresh, airport near-constant, enrich lock-free,
photo sweep, fire tz fallback) are robustness/latent and detailed above.
