# Bus Route Reveal — Design Consult

*Consult on the on-tap bus route line shipped in v5 #7. Verdict: the mechanism is sound, the
**idiom is wrong**. Below: why it fails, the principle it violated, the recommended redesign, and a
ranked set of novel moves — separated into what ships now (data we already hold) and what needs a new
feed pull.*

---

## 1. What we shipped, and why it reads as unusable

`BusRouteLayer` draws the **entire GTFS trip shape** as one dashed line, terminus dot to terminus
dot. That is a faithful render of the wrong thing. Three failure modes stack:

- **It draws the whole route, not the journey.** A GTFS shape is the full geometry of the trip —
  often a long corridor, sometimes a loop, frequently with a layover tail that doubles back on
  itself. The viewer's question on tap is *"where is this bus going?"* — a vector. We answered with a
  static map of the entire line, most of which is behind the bus or irrelevant.
- **The bus floats on the line with no relationship to it.** The bead sits somewhere in the middle of
  a long dashed string. Nothing says "you are here, headed that way." The two terminus dots are
  equidistant-looking and unlabeled, so the line has no read direction.
- **It fights the design system instead of joining it.** Everywhere else in SkyView, a *focus* reveal
  shows the path **ahead**: the aircraft `RouteLayer` draws a great-circle from the plane to its
  destination only (the trail already owns where it's been); the ferry `FerryRouteLayer` shows
  labeled *terminals*, never a connecting smear. The bus layer broke that grammar — it's the only
  reveal that paints the past, the present, and an undirected future all at once.

The root cause is one sentence: **we rendered the shape, when we should have rendered the remaining
trip.** Everything below follows from fixing that.

---

## 2. The principle this has to honor

SkyView already has a settled grammar for "I tapped a moving thing; show me its intent":

> The trail owns the past. The reveal owns the **future ahead**, and it terminates in a **named
> destination**. It is a *focus* element — brighter than ambient, quieter than aircraft, palette-true,
> night-aware, and it goes still during a gesture.

The bus reveal must read as a member of that family, not a one-off. The good news: the data to do it
right is already in hand — `livebuses` tracks each bus in arc-length `s` with a travel direction
`dir` along the shape, so "the path ahead" is a slice of the polyline from `s` to the
direction-of-travel terminus. No new feed required for the core fix.

---

## 3. Recommended direction — "the road ahead, to a named end"

Replace the full-shape line with three coordinated pieces:

**(a) Path-ahead only.** Draw the polyline from the bus's current position forward to the trip's
destination terminus (the `dir` end), trimmed of any layover loop. This is the bus-space twin of the
aircraft's destination great-circle. Behind the bus: nothing (the bead's comet tail already carries
recent motion) — *or* a very faint desaturated "ghost" of the traveled portion if we want the line to
feel anchored (see §4.6). Default: nothing, for calm.

**(b) A destination affordance with the headsign.** A small ring at the ahead-terminus, with the
bus's **headsign** as a label ("→ Downtown Seattle") in the same stroked-halo type the ferry terminals
and aircraft destination use. This is the single biggest legibility win: it ties the spatial line to
the text already in the tap card, and it answers "where's it going" in words *and* geometry.

**(c) Direction expressed as motion, not just a dot.** Taper the line — brightest/〜2.5px at the bus,
fading to ~0.25 alpha and thinner at the destination — so the eye reads flow without needing an
arrowhead. (Implementation note: a per-segment alpha ramp, or a single linear gradient along the
ahead-path.)

That trio alone converts the feature from "a tangle" to "a glanceable heading with a named end." It
is also **reasonably safe**: it reuses `s`/`dir`/`ln` we already compute and the `busShapePath`
plumbing already merged — the change is a new `busAhead(id)` accessor that slices the path, plus a
rewrite of `BusRouteLayer.draw`.

---

## 4. Novel moves, ranked — surface area vs. payoff

### Ships now (no new data; we already hold `s`, `dir`, `sVel`, headsign)

**4.1 — Live directional flow keyed to real speed.** *(High payoff, the standout move.)*
March the dashes along the ahead-path in the travel direction, at a rate proportional to the bus's
**estimated speed `sVel`**. A bus rolling at 30 mph streams briskly; a bus stuck at a light or in
traffic **slows to a near-stop crawl** — the line *becomes a live congestion read*. No other transit
map on a wall does this; it's genuinely novel and it's free, because we already estimate `sVel` for
road-snap pacing. It also extends the project's existing "flow / headway breathing" data-art thread
to buses. Must honor the perf rule: dashes go **static during a gesture** (no animated offset
mid-pan), exactly like the bead tails.

**4.2 — Headsign destination chip (the legibility anchor).** Covered in §3(b); promoted here because
it is the highest *function* gain for the least code. Pill or ring + stroked label, palette-true,
adaptive-culled when zoomed out (matches the existing adaptive-label system).

**4.3 — Progress-aware taper.** §3(c). The ramp can additionally encode *trip progress*: more of the
line dim if the bus is near its end, so a route about to terminate visibly "runs out." Subtle, cheap,
and it makes two buses on the same corridor distinguishable at a glance.

**4.4 — Layover/loop trim.** GTFS shapes often append a layover tail or close a loop at the terminus.
Clip the ahead-path at the true end of revenue travel so the reveal never doubles back on itself. This
is partly a *correctness* fix for the "unusable" tangle and should land with the core change.

**4.5 — Shared-corridor lift.** On 3rd Ave / the downtown spine, a dozen routes overlap. Because only
the *selected* route draws, it already "lifts" — but we can reinforce it with a 1px dark underglow so
the bright core separates from the ambient car-wash beneath. Near-free, big clarity gain downtown.

**4.6 — Traveled-path ghost (optional).** A faint, desaturated trace of the portion *behind* the bus,
borrowing the underground-train "ghost" grammar already in the codebase. Anchors the bead to a known
line without competing with the ahead-path. Default **off** — offer it as a config/taste call; calm
usually wins on a glanceable device.

### Phase 2 (needs a feed pull, all keyless or already-proxied via OBA)

**4.7 — Upcoming stops as beads, next-stop emphasized.** Pull OBA *stops-for-route* / trip stop
sequence and render the next 2–3 stops ahead as small beads, the immediate next one ringed with its
predicted arrival. This is the move that turns "where is it going" into "when does it get *there*" —
the question a person at a stop actually has. Needs an `/api/bus-stops` proxy; OBA already supplies it
under the key we use for vehicles.

**4.8 — Real route color from GTFS `route_color`.** Agencies publish per-route brand colors (the
RapidRide letter lines, ST Express, etc.). Pulling `route_color` lets the reveal match the
real-world signage color instead of our generic violet, so a tapped 550 looks like a 550. Falls back
to violet/RapidRide-red when absent. Small feed addition; high "this is *my* bus" recognition.

**4.9 — Bus photo / vehicle type in the card.** Parallels the deferred ferry-photo idea: coach vs.
articulated vs. RapidRide vehicle imagery. Lowest priority; cosmetic; needs curated assets.

---

## 5. Visual spec (for the recommended §3 + 4.1–4.5 build)

- **Geometry:** ahead-path = slice of `ln.path` from `posAt(s)` to the `dir` terminus, layover-trimmed
  (§4.4). One selected route → project per-vertex each frame, no decimation needed.
- **Line:** core ~2.5px, route color (violet `150,130,235` / RapidRide red `224,96,86`), alpha ramp
  0.6 (at bus) → 0.25 (at destination); 1px dark underglow (`8,12,18` @ ~0.5) beneath for corridor
  separation.
- **Flow:** dash `[10,10]`, offset animated at `k · sVel` while at rest; **frozen during gestures**.
- **Destination:** hollow ring r6 + filled r2 at the terminus; headsign label, `600 10px system-ui`,
  white fill over a `rgba(8,12,18,0.85)` stroke halo; cull label below the bus zoom gate.
- **Hierarchy:** strictly below trains/aircraft; **no additive glow, no strobe** (aircraft-only, per
  the BusLayer rule); near-white anything passes through `coreDim()` for night.
- **Lifecycle:** unchanged — draws for `selectedBusId`, clears on deselect/despawn; degrades to
  nothing for velocity-fallback buses with no shape.

---

## 6. Recommendation

Ship **§3 + 4.1 (speed-keyed flow) + 4.2 (headsign chip) + 4.4 (loop trim) + 4.5 (corridor lift)** as
one coherent rewrite of `BusRouteLayer` — all from data already in hand, all within the existing
design grammar, and §4.1 is the novel, demoable hook ("the line *breathes with traffic*"). Hold 4.6
as a taste toggle. Queue **4.7 (next-stop beads)** as the phase-2 headliner once an OBA stops proxy
exists, with **4.8 (route_color)** riding alongside it.

The one-line version: *stop drawing the route; draw the journey — ahead, named, and alive.*
