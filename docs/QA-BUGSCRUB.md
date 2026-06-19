# SkyView 2 — QA Bug Scrub (logic / edge cases)

Date: 2026-06-18
Scope: newest additions — live trains (arc-length dead-reckon), shared path engine, Fire/EMS
(client + server), live ferries, config plumbing, and the tap-card / transit-pick wiring.
Method: source read (Read tool, authoritative). READ-ONLY — no code changed.

Severity key: **P0** = crash or visibly wrong; **P1** = real edge-case failure; **P2** = cosmetic / latent.

---

## livetrains.ts

### P0 — Dead-reckon uses the *estimated* speed `sVel`, not the timetable pace; a train can freeze in a tunnel (the exact bug this code claims to fix)
**Area:** `tickLiveTrains` line 142 (`v.s += v.dir * v.sVel * dt`).
**What's wrong:** The module header (lines 6–8) promises: *"no fresh fix for a while (a tunnel…) → DEAD-RECKON: advance `s` at the timetable pace (path.paceVel)…"*. The implementation never imports or calls `paceVel`; it advances at `v.sVel`, the speed estimated from consecutive above-ground fixes. `v.sVel` is initialised to `0` and is only set on the **second** accepted on-line fix (and only when `dtFix > 0.5`).
**How it manifests:**
- A train that submerges with only **one** accepted fix so far (`hasFix===true`, `sVel===0`) dead-reckons at 0 m/s — it sits frozen over the tunnel portal until the hard `DROP_MAX_S` (10 min) cap deletes it. This is precisely the freeze the underground-rail feature was built to eliminate.
- The DLSTT (Downtown Seattle Transit Tunnel) is exactly where fixes are sparse, so a train acquired mid-tunnel never gets two surface fixes to seed `sVel` and never moves.
**Fix:** In the no-fresh-fix branch, dead-reckon at `paceVel(v.ln, v.s)` (already exported by path.ts) rather than `v.sVel`; reserve `sVel` for the above-ground smooth-glide-toward-fix case. Or, at minimum, seed `sVel` to `paceVel(...)` when `hasFix` is first set so it is never 0. Matching the code to the documented behaviour also fixes the comment/behaviour drift.

### P1 — `sVel` continuous prediction runs even above ground with NO per-poll easing toward the fix during the tick; correction only happens at poll time
**Area:** `tickLiveTrains` line 142 + poll-time `FIX_CORR` (line 106).
**What's wrong:** Between polls the train is advanced purely open-loop at `sVel`. The only correction is a single `* FIX_CORR (0.5)` nudge applied once per 20 s poll. If `sVel` is even slightly high (it is capped at `SPD_MAX 35 m/s` but is a noisy two-point estimate), `s` drifts ahead each frame and is yanked back 50% every 20 s — a visible periodic lurch at stations where the real train has stopped but `sVel` is still ~the last cruise speed. (The ferry code has the same open-loop structure but uses the vessel's *reported* speed, which is more trustworthy.)
**Fix:** Decay `sVel` toward 0 when no fix arrives for > one poll interval (so a stopped/dwelling train coasts to a halt instead of overshooting), or apply the projected-fix easing continuously in `tick` (the `advance()` helper in path.ts already does exactly this — livetrains re-implements a cruder version and doesn't use it).

### P1 — Travel direction `dir` defaults to +1 and can be wrong (or never set) underground
**Area:** poll, lines 102 / 83 (`dir: 1` default; updated only when `|ds| > DIR_EPS`).
**What's wrong:** `dir` is `1` until two fixes differ by > `DIR_EPS` (8 m). A train heading toward the **low-index** terminus that submerges before two surface fixes resolve direction will dead-reckon the **wrong way** (toward the high-index terminus). Even above ground, the first 1–2 polls of a southbound train glide north.
**How it manifests:** Wrong-direction ghost glide in/under a tunnel; a train briefly sliding backward right after acquisition.
**Fix:** Don't dead-reckon at all until `dir` has been confirmed by a real `ds` (gate the tunnel advance on a `dirKnown` flag), or infer initial direction from the line's nearest station sequence / the reported devSec. Pair this with the P0 fix.

### P2 — `submerged` is sampled from the pre-advance `s` (one-frame lag); terminus heading lookups fine
**Area:** `tickLiveTrains` line 137 vs 142. `posAt` is read before `v.s` is advanced, so the tunnel flag (and the drop decision that depends on it) lags the position by one frame. Cosmetic only.

### P2 — `liveLineSet()` keys on `v.line` even for vehicles whose fade has reached 0 but tick hasn't deleted yet
**Area:** line 174–178. `liveLineSet` iterates **all** tracked vehicles including ones `liveTrains()` would drop via `fade<=0` (above-ground, age between `DROP_S` and `DROP_MAX_S` while submerged-flag flips). For a brief window the sim train for that line is suppressed (`covered.has`) even though no live bead is drawn → a line momentarily shows **no** train. Low-probability; self-heals on the next tick delete.

---

## path.ts

### P1 — `project()` returns `{s:0,...}` for a single-vertex (or empty) line, silently pinning the vehicle to the origin
**Area:** `project` line 61–72. The loop `for (i=0; i<p.length-1; i++)` never executes when `p.length <= 1`, so `best` stays `{s:0, segIdx:0, dist:Infinity}`. `dist:Infinity` fails livetrains' `GATE_M` check (good — fix ignored), but the **ferry** lane is a 2-vertex path so it's safe there. The latent risk: any future 1-point line yields `dist:Infinity` forever → `hasFix` never set → permanent raw fallback with no warning. Defensive only.

### P2 — `paceVel` `segSec` path is effectively dead (no line ships `segSec`); always returns `NOMINAL_MS`
**Area:** lines 118–128 + rail.ts (grep confirms `segSec` appears nowhere in RAIL_LINES). `paceVel` always falls through to the 15 m/s nominal. Not a bug per se (documented as a placeholder), but it means the timetable-pace dead-reckon — once livetrains is fixed to use it — will be a flat 15 m/s everywhere, not schedule-true. Note for the P0 fix.

### P2 — `stationWindow` `next` defaults to the **last** station when `s` is past every station
**Area:** lines 106–111. If `s` exceeds `c[idx[last]]`, the loop never hits the `>= s` break, leaving `next = idx[idx.length-1]` and `prev = idx[idx.length-1]` → `sNext - sPrev === 0` → `paceVel` returns NOMINAL (the `dist<=0` guard catches it). Correct by luck via the guard; worth a comment.

### Verified OK
- `cumLen` WeakMap memo is keyed on the line object (generated once, never mutated) — correct; the ferry lane rebuilds a **new** object on each sailing so its old cache is GC'd, no stale length.
- `posAt` clamps `s<=0` and `s>=total`, guards `p.length===0`, and divides by `(c[hi]-c[lo]) || 1` (no NaN on a zero-length segment). Binary search bounds are correct.
- `haversine` clamps `asin` arg to ≤1 (no NaN at antipodes).

---

## livefire.ts + FireEmsLayer.ts

### P1 — Incident never updates after first sight; a re-dispatched/upgraded incident keeps its stale type & coords
**Area:** livefire.ts line 46 (`if (incidents.has(m.id)) continue;`). First-seen is intentionally sticky, but it also discards every later field — if the feed corrects an incident's `type` (e.g. "Aid Response" → "Fire in Building") or position, the client shows the original forever. Severity classification therefore can't escalate.
**Fix:** Keep `firstSeen` sticky but refresh `type`/`address`/`lat`/`lon`/`cat` (re-classify) on each poll.

### P2 — Cap sort is not stability-critical but `score()` ties resolve arbitrarily; equal-severity equal-age incidents can flicker in/out across polls
**Area:** FireEmsLayer.ts line 48 (`incs.slice().sort(...).slice(0, CAP)`). `Array.prototype.sort` is stable in modern engines, but the score includes a continuous age term that changes every frame, so two incidents straddling the CAP=24 boundary can swap on consecutive frames → marker pops in/out. Low chance (needs >24 simultaneous incidents within 30 mi). Cosmetic.

### P2 — Arrival-cue gating relies on `firstSeen` AND dispatch freshness; clock skew can suppress or mis-fire
**Area:** FireEmsLayer.ts line 104 (`(now - inc.time)/60000 < 8`). `inc.time` is server-derived dispatch time (Seattle-local parsed → UnixMilli). If the Pi clock and the SODA timestamps disagree (or the feed lags > 8 min, which the code itself says is typical — "lags ~30-60 min"), the `< 8` gate means **the arrival ripple essentially never fires** for real incidents, because by the time the client first sees a row its dispatch time is already 30–60 min old. The cue is effectively dead-on-arrival for the normal lag case.
**Fix:** Gate the cue on `firstSeen` recency alone (it already requires `since < ARRIVAL_CUE_S`), and drop or widen the `now - inc.time < 8 min` condition — the comment's intent ("don't ripple a backlog") is better served by "only ripple incidents whose dispatch time is within the LIFETIME window," not 8 minutes.

### Verified OK
- NaN radii: `c.disc`/`c.r` are constants per category; `zoomMul`, `dim`, `breath` are all bounded finite. No division by a possibly-zero map zoom (`f.view.mapZoom || 1`). `coreDim`/`nightF` bounded.
- `(lat===0 && lon===0)` guard drops null-island rows.
- Lifetime drop in `fireIncidents` measured from `firstSeen` (correct given feed lag); 45-min cap.

---

## liveferries.ts

### P1 — Lane rebuild on a dep/arr change resets `hasFix=false` mid-crossing; the vessel jumps to the projected fix
**Area:** line 86 (`if (key !== v.lnKey) { … v.hasFix=false; }`). WSF occasionally reports transient/blank `depLat…arrLat` between polls (a vessel maneuvering, or a feed hiccup). Any change to the comma-key — including a momentary drop to `0,0,0,0` and back — rebuilds the lane and clears `hasFix`, so on the next poll `v.s = pr.s` snaps the boat directly onto the lane with no easing (the smooth `FIX_CORR` blend is skipped on first fix). Visible teleport.
**Fix:** Only rebuild when the new endpoints are **valid** (`buildLane` returns non-null); ignore key changes that null out the lane. Optionally preserve `s` (re-project the old position onto the new lane) instead of hard-resetting `hasFix`.

### P2 — `atDock` ↔ underway transition snaps position between raw-ease and arc-length tracks
**Area:** lines 88 / 114 / 130. While `atDock` the vessel renders from the raw eased `lat/lon`; the instant `atDock` flips false (and a lane exists) it renders from `posAt(s)`. `s` was last set whenever it was previously underway (or 0 if never), so the marker can jump from the dock to a stale arc-length point. Usually small (dock ≈ lane endpoint) but visible on a route change. Cosmetic-to-P1 depending on geometry.

### P2 — `speedMps` dead-reckon never decays; a vessel that stops reporting speed but isn't `atDock` coasts off the far terminal
**Area:** line 115 (`v.s += v.speedMps * dt`). If the last poll's `speed` was high and the vessel then slows/stops while underway (no new poll for up to 15 s, or the feed freezes), `s` runs to `total` and clamps at the arrival terminal early. Bounded by the clamp, so it parks at the dock rather than overshooting — acceptable, but it arrives "early" visually. Minor.

### Verified OK
- `s` clamp `[0,total]` in both tick and render; `posAt` tail walk clamps `s - TAIL_M`.
- DROP at `DROP_S` (240 s) deletes the vessel and `continue`s (no double-process).
- `buildLane` returns null on any zero endpoint → falls back to raw ease (no NaN lane).

---

## internal/feed/fire.go

### P2 — Timezone fallback to UTC silently shifts the dispatch-time filter by ~7–8 h (only if tzdata is missing)
**Area:** lines 46–49. If `LoadLocation("America/Los_Angeles")` fails (no tzdata in the container/image), `loc = time.UTC`. The SODA `datetime` strings are Seattle-local but would then be parsed as UTC, so every `t` is 7–8 h **earlier** than reality. Effect on the `t.Before(cutoff)` (now-120min) filter: parsed times are shifted into the past, so **all** incidents look older than the cutoff → the filter discards everything → empty snapshot (silent). This is handled "safely" only in the sense that it doesn't crash; it silently drops the entire feed. The display `time` field would also be wrong (affecting "X min ago"). The Pi has full tzdata so this is latent, but a stripped deploy image would kill the feed with no log.
**Fix:** Log a warning when the load fails; consider embedding the zone (`time.FixedZone("PST/PDT", …)` is wrong across DST — better to fail loudly or vendor tzdata).

### P2 — `resp.Body` leaked on the decode-error path? No — closed before the status check. OK. But a non-200 with a body is decoded then discarded.
**Area:** lines 108–113. `json.NewDecoder(resp.Body).Decode(&raw)` runs before checking `resp.StatusCode`; on a 429/500 the body (an error JSON, not an array) fails to decode, `decErr != nil`, and the function returns keeping the last good snapshot. Correct behaviour, just slightly wasteful. SODA rate-limit (429) is therefore handled gracefully (keep-last-good). Empty array → empty snapshot overwrites last-good (a quiet night legitimately clears the map). OK.

### Verified OK
- Radius floor of 30 mi; uses `v.Lat, v.Lon` (home center) for `distMiles`, **not** 0,0 — correct.
- Millisecond-optional datetime parse: tries `…05.000` then `…05`, else skips the row. Correct.
- `lat==0 || lon==0` row guard. Disk cache load/save guarded on empty path + unmarshal error.

---

## internal/config/config.go + store.go + migrate.go

### Verified OK — `showFireEms` default survives a stale saved config
`NewConfig` (store.go line 30) seeds `c.cfg = config.Default()` (which sets `ShowFireEms:true, FireEmsArrivalCue:true`) **then** `json.Unmarshal`es the saved file onto it. Go's unmarshal leaves absent keys untouched, so a config.json written before these fields existed keeps the `true` defaults → **the layer is ON**, not off. `MigrateFile` does the same (unmarshal onto `Default()`). No bug. (A config that explicitly stored `showFireEms:false` is correctly preserved.)

### P2 — `Subscribe` unsubscribe uses a captured index into a slice that is never compacted
**Area:** store.go lines 64–69. Unsubscribe sets `c.subs[i] = nil` (emit skips nils). Indices stay valid since the slice only appends, so this is correct — but the slice grows unbounded across many subscribe/unsubscribe cycles. Not relevant at this app's scale; noted only for completeness.

---

## Display.tsx + Renderer.ts (tap-card / pickTransit / selectedFerryId wiring)

### P1 — Transit card does NOT auto-despawn when its target leaves range / is panned away (aircraft card does)
**Area:** Display.tsx lines 155–160. There's a `useEffect` that calls `r.onScreen(selected)` to drop the **aircraft** card, but no equivalent for `transit`. A tapped train/ferry/bus/incident that drops from its feed (train deleted after DROP_S, ferry undocks out of range, incident hits LIFETIME_MIN) leaves the `TransitCard` open showing a now-stale snapshot indefinitely, and for a ferry leaves `selectedFerryId` set so `FerryRouteLayer` keeps drawing a lane for a vessel that no longer exists.
**Fix:** Add a parallel effect: if `transit` is set and the corresponding live object is gone (check `liveTrains()/liveFerries()/liveBuses()/fireIncidents()` by id), `setTransit(null)` and `r.selectFerry(null)`.

### P2 — `TransitCard` snapshot is frozen at tap time (never updates); train delay / ferry speed / "min ago" go stale while open
**Area:** Display.tsx 611–638 + Renderer `pickTransit` returns a one-shot snapshot. Unlike `TapCard` (which reads the live `a` each render), `TransitCard` shows the values captured at the tap. A live train's `devSec`, a ferry's `speed`/`atDock`, and a fire's `agoText` are stuck. The fire "min ago" in particular keeps reading the same number. Cosmetic but the card advertises "live."
**Fix:** Re-resolve the picked element by id each render (or on `state.now`) and feed fresh fields into the card.

### P2 — `pickTransit` has no z-priority among transit kinds; an incident under a train wins on raw distance
**Area:** Renderer.ts 184–197. All transit kinds compete on pure pixel distance with the same `bestD`. Fire/EMS markers are drawn UNDER everything (by design), but in the hit-test a fire incident can out-rank a train/ferry sitting slightly farther in pixels, so you can tap "through" the visually-top element and select the one painted underneath. Minor UX surprise; consider ordering picks by render tier (aircraft > train > bus > ferry > fire) or biasing `bestD` per tier.

### Verified OK
- `setCardOpen(!!selected || !!transit)` correctly suppresses the canvas placard for **either** card (line 153).
- Tap branch order (plane → transit → static) clears the other selections in each branch; `selectFerry(tp.kind==="ferry" ? tp.id : null)` correctly clears the lane for non-ferry transit picks.
- `TransitCard` fire branch (`incidentColor(pick.title)`) re-runs `classifyIncident` on the type string — consistent with the layer's classification.
- Closing the transit card clears `selectedFerryId` (line 342).

---

## Highest-severity summary
1. **P0 (livetrains.ts):** dead-reckon advances at the two-fix speed estimate `sVel`, not the documented `paceVel` timetable pace; a train with ≤1 fix (or one acquired in a tunnel) has `sVel===0` and **freezes over the portal** — the exact failure the underground feature exists to prevent.
2. **P1 (livetrains.ts):** initial travel `dir` defaults to +1 and isn't confirmed until two fixes differ by >8 m, so a train can dead-reckon (and ghost-glide through a tunnel) in the **wrong direction**.
3. **P1 (livefire.ts):** incidents are write-once — a later type/coord correction (e.g. an aid call upgrading to a structure fire) is discarded, so severity can never escalate.
4. **P1 (FireEmsLayer.ts):** the arrival ripple is gated on `now - dispatchTime < 8 min`, but the feed's own documented lag is 30–60 min, so the cue **effectively never fires** for real incidents.
5. **P1 (liveferries.ts):** a transient/blank dep-arr report rebuilds the lane and clears `hasFix`, snapping the vessel onto the lane with no easing (teleport).
6. **P1 (Display.tsx):** the transit card has no leave-range auto-despawn (the aircraft card does), so a stale train/ferry/incident card — and a dangling `selectedFerryId` lane — can linger after the target is gone.

Lower-severity items (open-loop `sVel` lurch, `atDock` snap, UTC tz fallback silently emptying the fire feed, frozen `TransitCard` fields, transit pick z-priority) are detailed in the sections above. Config plumbing is correct: a stale saved config keeps `showFireEms:true` (layer ON), not off.
