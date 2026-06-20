# Rail Direction-of-Travel — Design Consult

**Verdict: DON'T add any indicator or animation to the rail LINE itself. Direction is already
carried by the moving trains, which is the correct place for it. If a future itch demands more, the
only acceptable form is a per-train heading chevron and/or an on-tap-only flow on a SINGLE selected
train's path-ahead — never an ambient line animation.**

Grounded in a read of `RailLineLayer.ts`, `RailLayer.ts`, `TrainLayer.ts`, `livetrains.ts`,
`BusRouteLayer.ts`/`livebuses.ts`, and `docs/RAIL-BALANCE.md`, `docs/UNDERGROUND-RAIL-DESIGN.md`,
`docs/DESIGN-REVIEW-v6.md`. No code was modified.

---

## Why not — the four reasons, in order of weight

### 1. It's redundant. The trains already answer "which way is it going?"
Direction is not missing from the rail render — it is *already solved at the train level*, and
better than a line cue could do it:

- `livetrains.ts` tracks each vehicle's `dir: 1 | -1` along its arc-length path and advances `s`
  in that direction every frame (`v.s += v.dir * spd * dt`). The motion you see is real travel,
  not a decorative loop.
- `TrainLayer.ts` draws a **heading-oriented railcar** — the capsule is rotated to
  `atan2(dy, dx)` of its along-track delta, with a comet tail trailing from the lagging anchor and
  an along-track window shimmer gliding nose→tail. A railcar pointed and streaking up-line *is* a
  direction-of-travel indicator, on the one element that's allowed to move.

A line-level cue would restate, less precisely, what a moving lit railcar already says. The
brightness law the whole product runs on (RAIL-BALANCE: "a live, measured thing should out-read
static infrastructure") wants the *train* to carry motion and direction, and the line to recede.

### 2. Link is bidirectional — a single line-flow would actively mislead.
Trains run both ways on the same track. A dash-flow or chevron set baked onto the ribbon points
**one** way. Half the trains on screen would then be moving *against* the line's implied flow — a
direct contradiction the eye will catch. There is no honest single-direction animation for a
two-direction line. (This is precisely why the bus flow is safe and the rail flow is not — see §5.)

### 3. It un-bakes the deliberate performance win.
`RailLineLayer` exists as a *separate file* for one reason, stated in its header: it's wrapped in
`StaticOverlayLayer`, bakes ~4,900 projected vertices to an offscreen buffer, and transform-blits
during pan/zoom — re-projecting only when the view settles. `draw()` runs essentially never during
steady state. **Any per-frame flow animation (a marching `lineDashOffset`, a moving gradient) forces
a full per-frame redraw of every on-screen multi-segment span**, which is exactly the cost the bake
was built to avoid, on a Pi. You'd trade the single biggest rail perf optimization for a redundant
cue. Not acceptable ambiently; only ever justifiable on a tiny, single-train, on-tap path (§5).

### 4. Calm + burn-in — this is the cue the design exists to refuse.
This is an always-on bedside/ceiling panel. A continuously animated line is *perpetual motion across
a large, fixed screen region* — both the calmness violation the product polices everywhere (the
strobe density gate, the "no pulse on an always-on screen" ban in UNDERGROUND-RAIL-DESIGN §3, the
burn-in orbit, the slowed notable-emblem pulse in DESIGN-REVIEW-v6) and a literal burn-in risk: the
ribbon's pixels never move, so animating them is the worst-case persistent-pattern stressor. The
moving trains are *transient* over those pixels — they don't camp. The line must not animate.

---

## What to do instead: nothing. (Optionally, make the existing train read crisper.)

The right "direction indicator" is the railcar that's already there. If direction ever reads as
unclear in practice, fix it *on the train*, not the line — these stay within the existing per-train
grammar and don't touch the baked ribbon:

- **(Preferred, if anything) A tiny nose cue on the moving railcar.** The capsule already rotates
  to heading. A single small brightening at the leading cap — e.g. nudge the window-band shimmer to
  rest a hair forward of center, or a ~1px brighter front edge on the keyline — makes "this end is
  the front" unmistakable, costs nothing extra (the rotate/translate context is already set up in
  `TrainLayer` lines ~134–155), and only ever paints under a moving transient bead. No ambient
  motion, no bake disturbance, no bidirectional lie (each car points its own true way).
- **Leave dwelling/submerged trains alone.** A platform-dwelling train deliberately drops to a bead
  (heading unknown at a standstill) and the submerged ghost is meant to be the calmest thing on
  screen. Don't add direction where the system honestly has none.

That's the whole recommendation. A nose cue is a *nice-to-have*, not a need — ship nothing here
without a concrete "I can't tell which way trains go" complaint from the owner.

---

## The one conditional "yes" — and its hard fences

IF (and only if) the owner specifically wants a richer directional reveal, the bus precedent
(`BusRouteLayer`) is the *only* idiom to copy, and only with all of these constraints:

- **On-tap / selected train ONLY, never ambient.** Like `BusRouteLayer` (gated on `selectedBusId`,
  `// never ambient`), draw it solely for one tapped train.
- **The path-AHEAD only, in that train's own travel direction** — the slice of its line from the
  train's `s` to its destination terminus, using its known `dir`. This sidesteps bidirectionality
  entirely: it's *this train's* one-way trip, not the two-way line. (Mirror `busAhead()`.)
- **A short slice, not the whole 4,900-vertex ribbon** — only the on-screen span to the next few
  stops / the terminus, so the per-frame redraw is cheap and bounded.
- **Frozen during gestures** (`if (!f.interacting)`), exactly as the bus flow and the train tails
  already freeze, so panning stays cheap.
- **Tapered + dimmed + night-aware** (gradient bright-at-train → dim-at-destination, `coreDim()`),
  jade to stay in the rail palette, sitting *below* the train so the live bead still out-reads it.
- It still costs a perpetual animation *while a train is selected* — so it must auto-dismiss with
  the existing transit-card despawn, never persist on the idle kiosk.

This is strictly a selection-state affordance, not a line treatment. It does not animate the baked
ribbon and it does not run when nothing is tapped.

---

## Explicitly avoid

- **Any ambient, always-on animation of the rail line** (marching dashes, traveling gradient,
  flowing glow). Redundant, misleading on a two-way line, un-bakes the perf win, and is a calm +
  burn-in violation. This is the thing the question asks about, and the answer is no.
- **Baked static chevrons/arrows on the ribbon.** Cheaper than animation, but still a fixed
  one-direction claim on a bidirectional track — it lies for half the trains. Rejected.
- **Recoloring or brightening the line to imply flow.** RAIL-BALANCE already pulled the line *down*
  a rung (glow 0.14/w7, body 0.72, dim hair 0.55) so the train out-reads it; adding directional
  emphasis to the line re-inverts the hierarchy it just fixed.
- **Any line-level cue that has to redraw per frame**, period — it defeats `StaticOverlayLayer`.

---

### One-line summary for the owner
The trains already point and stream the right way; the line is deliberately static for performance
and calm. Don't animate the line. If you want more, the most we'd add is a small "nose" highlight on
the moving railcar, or — only if you ask — a bus-style flow on a single *tapped* train's path-ahead.
