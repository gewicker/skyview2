# Aircraft Label "Pop" — Design Diagnosis & Fix

## One-line root cause

**The data tags pop because label MEMBERSHIP and PLACEMENT are recomputed from scratch every
frame with no hysteresis or hold** — `drawLabels()` in `AircraftLayer.ts` re-sorts all aircraft by
distance and slices a hard "top K" each frame, so planes sitting near the K-cutoff flip their tags
on/off as their ranks swap; the same pass re-picks each card's left/right side and re-runs a greedy
anti-overlap reflow, so a tag also jumps position whenever a neighbour nudges. The fix is to make
membership and placement *sticky* (the same pattern `SpotlightLayer` already uses with `HOLD_MS`).

This is the inverse of how the rest of the system already behaves: glyph morphs ease over
`MORPH_MS` (AircraftLayer.ts:27), the spotlight holds its target for `HOLD_MS = 6000`
(SpotlightLayer.ts:12), ground headings gate out GPS jitter (AircraftLayer.ts:100-107). Labels
never got the same calming treatment.

---

## Evidence (code-grounded)

### 1. Membership churn — the primary "pop" (HARD ON/OFF)

`drawLabels()` (`web/src/display/render/AircraftLayer.ts:535`) selects which aircraft get a card:

- **adaptive** (the default — `Control.tsx:132`, `nearestN: 6`): `AircraftLayer.ts:544-550`
  ```
  let K = N <= 12 ? base : N <= 25 ? Math.round(base * 0.6) : 3;
  const sorted = [...jobs].sort((a, b) => a.dist - b.dist);
  chosen = sorted.slice(0, K);
  callsignOnly = sorted.slice(K, K + Math.min(6, N - K));
  ```
- **nearestN / nearestOnly**: `AircraftLayer.ts:555-561` — same hard `sort(dist).slice(0, n)`.

`dist` is squared distance from screen centre, recomputed every frame from live position
(`AircraftLayer.ts:273`). Two consequences, both per-frame and un-damped:

1. **Rank-swap flicker at the cutoff.** Any two aircraft straddling rank K/K+1 trade places as
   they move (or as the camera/home shifts). The one that drops out loses its full card; the one
   that rises gains it. In a congested bank near KSEA's final, several planes cluster at nearly
   equal range, so the K-th slot thrashes frame-to-frame → tags blink in and out. This is the
   loudest "popping".
2. **Tier-boundary jumps.** `K` is a step function of `N` (12 and 25 are cliffs). One aircraft
   appearing/leaving the visible set can drop `K` from `base` (6) to `round(base*0.6)` (4) or to
   3 — yanking 2-3 cards off the screen in a single frame. The same edge makes a plane jump
   between the full-card tier and the faded `callsignOnly` tier (a visible style pop, not just
   on/off).

There is **no hysteresis and no hold** anywhere in this selection — contrast `SpotlightLayer.ts:92-104`,
which keeps its current target as long as it's in range and `now < this.until`, only re-selecting
on a real exit. Labels need exactly this.

### 2. Placement jitter — leader side + anti-overlap reflow (POSITION POP)

Side selection, `AircraftLayer.ts:277-278`:
```
const onRight = p.x > f.w * 0.5;
const ax = onRight ? p.x - glyphS - 8 - (w + 8) : p.x + glyphS + 8;
```
A plane tracking across the screen midline (the busy approach corridor *crosses the centre*, as
the comment at :274-276 notes) flips its card from one side of the glyph to the other the instant
`p.x` crosses `f.w * 0.5` — a full card-width jump with no hysteresis on the threshold.

Anti-overlap reflow, `AircraftLayer.ts:577-586`:
```
chosen.sort((a, b) => a.drawY - b.drawY);
for (...) for (...) if (overlap) A.drawY = B.drawY + (B.h + A.h) / 2 + 3;
```
This greedy top-down push is recomputed each frame from current `drawY`. When the membership set
changes (item 1) or any card moves a pixel, the *whole stack below it* re-solves to new Y
positions — a small move cascades into many cards stepping. There is no easing of `drawY` toward
its target; it snaps.

### 3. Width cache is fine; sub-pixel is a minor contributor

`_labelW` (`AircraftLayer.ts:42-51`) caches text width by string and only changes ~1 Hz — **not** a
pop source. Label X/Y are drawn at raw projected floats (no rounding), so there's mild sub-pixel
shimmer as planes move, but that's a slow wobble, not the "pop" the owner is describing. Secondary.

### 4. Leader velocity vectors (`LeaderLayer.ts`) are NOT the issue

The speed leaders are recomputed per frame but are deterministic from each aircraft's own
track/gs/position (`LeaderLayer.ts:24-49`) — they glide, they don't pop. Membership isn't gated.
Leave them.

---

## Recommended fix (prioritized)

### P0 — Hysteretic, time-held label membership (kills the flicker)

Make a plane **clearly win to gain a tag and clearly lose to drop it**, plus a minimum hold so it
can't drop within a few seconds of gaining. Mirror `SpotlightLayer`'s hold.

Add a small persistent map in `AircraftLayer` (instance field, survives frames):
```ts
private labelHold = new Map<string, number>();  // hex -> wallclock ms the tag is held until
private LABEL_HOLD_MS = 4000;     // a tag, once shown, persists at least this long
private LABEL_HYST = 1.18;        // rank-distance must beat the cutoff by 18% to JOIN
```

In the selection (replace the bare `slice(0, K)`):
1. Sort by `dist` as today; let `dCut = sorted[K-1].dist` be the cutoff distance (the K-th rank).
2. A plane is **in** this frame if **either**:
   - it ranks within K **and** `dist <= dCut` (normal win), **or**
   - it was shown last frame **and** `now < labelHold[hex]` (held), **or**
   - it was shown last frame **and** `dist <= dCut * LABEL_HYST` (still close to the band — sticky).
3. For every plane that ends up **in**, refresh `labelHold[hex] = now + LABEL_HOLD_MS`.
4. Cap the held set so a churning dense sky can't accrete unbounded cards:
   `maxShown = K + 2`. If over cap, evict the ones with the **largest** `dist` (the clearest
   losers), never the freshly-promoted.
5. Drop `labelHold` entries for hexes no longer visible (and clear on the existing 1000-entry
   hygiene like `_labelW`).

Effect: a plane on the K/K+1 boundary keeps its tag through brief rank swaps and only drops after
it has *clearly* fallen out of the band for `LABEL_HOLD_MS`. The 12/25 tier cliffs (item 1.2) stop
yanking cards because the hold carries them across the step.

### P0 — Fade tags in/out instead of hard pop (makes any remaining churn calm)

Even with hysteresis, tags must eventually appear/disappear. Never snap alpha 0↔1. Store a
per-hex eased `labelAlpha` and ramp it:
```ts
// target = 1 if chosen this frame else 0; ease ~200ms
la += (target - la) * Math.min(1, f.dt / 0.2);
```
Multiply the card's fill/stroke alpha by `la`; skip drawing when `la < 0.02`. A card that does
leave the set then **fades out over ~200 ms** rather than blinking. This single change also masks
the tier-style transition between full-card and `callsignOnly`.

### P1 — Deterministic, hysteretic leader side (kills the midline flip)

Replace the bare `p.x > f.w * 0.5` (`AircraftLayer.ts:277`) with a **held** side per aircraft:
```ts
// keep previous side unless p.x crosses well past centre (dead-band ±8% of width)
const prev = this.labelSide.get(a.hex);
let right = prev ?? (p.x > f.w * 0.5);
if (p.x > f.w * 0.5 + f.w * 0.08) right = true;
else if (p.x < f.w * 0.5 - f.w * 0.08) right = false;
this.labelSide.set(a.hex, right);
```
A ~10%-width dead-band means a plane loitering on the centreline doesn't flip-flop; it only swaps
sides on a committed crossing. (Optional, lighter: seed the side deterministically from
`seedFor(a.hex)` so it's fixed per aircraft — but the dead-band is calmer for crossing traffic.)

### P1 — Ease the anti-overlap `drawY` toward target instead of snapping

Keep the greedy solver (`AircraftLayer.ts:577-586`) but treat its result as a **target** and ease
the displayed Y:
```ts
// per-hex displayedY eased toward solved drawY
dy += (solvedY - dy) * Math.min(1, f.dt / 0.15);
```
So when membership or a neighbour shifts, the stack *slides* into its new arrangement over ~150 ms
rather than stepping. Use the eased Y for both the leader line and the card.

### P2 — Round draw coordinates to whole pixels

Quantise final label X/Y with `Math.round()` at draw time (`drawLabel`/`drawCallsign`,
`AircraftLayer.ts:601,631`) to remove sub-pixel shimmer. Cheap; do it after the easing so the ease
stays smooth.

---

## Suggested exact values (tune on the panel)

| Knob | Value | Why |
|---|---|---|
| `LABEL_HOLD_MS` | **4000 ms** | long enough to ride out rank swaps; shorter than spotlight's 6 s since labels are lower-stakes |
| `LABEL_HYST` (join/keep band) | **1.18** (keep) / **1.0** (join) | must rank in to *join*; can be 18% past the cutoff to *stay* |
| `maxShown` cap | **K + 2** | bounds the held set in a churning cluster |
| Tag fade in/out | **~200 ms** ease | calm appear/disappear; matches ambient feel |
| Leader-side dead-band | **±8% of width** | no flip-flop on the centreline approach corridor |
| `drawY` ease | **~150 ms** | stack slides, doesn't snap |

---

## What to avoid

- **Don't just raise `nearestN` / show "all".** More cards in a congested sky is the opposite of
  calm and burns the visual budget the ambient layers (radar/highway/rail) rely on. The goal is
  *steadier* cards, not *more*.
- **Don't fix it with a longer poll/lower frame rate.** The pop is logic, not framerate; slowing
  the loop just makes the same flicker chunkier and hurts glyph/leader smoothness.
- **Don't add a background plate/scrim to "anchor" the tags.** The transparent outline treatment is
  a stated preference (`AircraftLayer.ts:605-606`); plates would fight the brightness law and the
  glanceable look. Stability comes from hysteresis, not from making each tag heavier.
- **Don't reflow on every sub-pixel move.** Keep the greedy solver, but ease its output (P1) — a
  per-frame exact re-solve that snaps is itself a pop source.
- **Don't touch `LeaderLayer` velocity vectors or `_labelW`.** Neither pops; changing them is risk
  with no payoff.

---

## TL;DR for the implementer

1. Give `AircraftLayer` three persistent maps: `labelHold` (hex→ms), `labelAlpha` (hex→0..1),
   `labelSide` (hex→bool), `labelY` (hex→px).
2. In `drawLabels`, select with **hysteresis + hold** instead of a hard `slice` (P0).
3. **Fade** alpha in/out and **ease** Y; **hold** the leader side with a dead-band (P0/P1).
4. Round to whole pixels (P2).

Root cause is membership churn; the leader-side flip and reflow snap are the secondary position
pops. Fix membership first — it's most of the visible noise.
