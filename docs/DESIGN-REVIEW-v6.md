# SkyView 2 — Design Review (v6)

> **Status 2026-06-19 — all findings actioned (pending deploy).** Implemented: featuredHex
> double-flash + landing-beam gate, beacon/strobe decorrelation (~40/min) + crisper featured pop,
> ±8% strobe-period twinkle, day xenon-bloom restricted to the featured plane, position-light radius
> cap, `coreDim()` night floor → 0.45, notable-emblem pulse slowed. **Deliberately NOT done:** the
> "suspend night wash on the auto-featured plane" P2 — `AtmosphereLayer` is a full-field wash, so
> keying it to the (near-continuous) auto-feature would disable night dimming almost always; the
> manual-tap suspension stays as-is. Ferry `LANE` color + bus cap were already at their post-audit
> values (no change needed).

George asked for a fresh design-expert pass with the aircraft **blinking lights** (strobes +
beacon + nav/position lights) as the explicit priority, plus a lighter touch on the broader
system. This review reads the *current* implementation — not the earlier consult docs — and is
careful to credit what has already landed since `STROBE-INTENSITY-DESIGN.md` and
`DESIGN-AUDIT-v5.md` were written, then surface what is genuinely *still open* or newly worth
doing. Every value below was read from source with the Read tool (the bash mount serves stale
copies of edited files, so it is not authoritative). No code was modified.

The headline: the blinking-light system is in **much** better shape than the strobe doc's
"before" state — the doc's recommendations were almost entirely implemented (named constants,
`nf`-aware peak, eased pulse, density gate, radius cap, day-only blue bloom). What remains is one
real correctness gap (the double-flash never fires on the *auto*-spotlighted plane), a handful of
realism/polish wins, and a couple of broader-system items the audits flagged that are still live.

---

## Part 1 — Blinking lights (the priority)

Everything aircraft-light lives in `drawNavLights()` at the bottom of
`web/src/display/render/AircraftLayer.ts` (lines 717–763), called once per airborne aircraft per
frame from `airborne()` (line 360), gated on `this.lightsOn` and modulated by the night factor
`nf`. The strobe constants are now named at the top of the file (lines 34–38:
`STROBE_PERIOD_S`, `STROBE_PULSE_MS`, `STROBE_PEAK_DAY`, `STROBE_PEAK_NIGHT`,
`STROBE_RADIUS_MAX_PX`). The strobe attention gate (`strobeMode`) is computed per aircraft in
`draw()` (lines 173–177).

### What is right today (credit where due)

This is no longer a "swarm of hard white pops." The current behavior is genuinely calm and mostly
authentic:

- **Steady position lights are well-judged.** `lvl = 0.18 + 0.82*nf` (line 718): warm-red port
  `[255,42,38]`, cool-green starboard `[40,235,90]`, warm-white tail `[255,247,235]`, with a
  light radius that scales with the glyph (`lr = max(1.1, glyphS*0.12)`, line 722). They nearly
  vanish by day and bloom at night — exactly the real-world read, and the temperature pair
  survives even at 1 px. Keep.
- **The red beacon is a tasteful rotating-lens swell.** `bp = (t*0.85 + seed) % 1` → ~1.18 s
  period; brightness is a cubed sine over the first 55% of the cycle, dark for the rest, additive,
  radius growing `lr*0.95 → ~lr*2.05`, peak alpha `0.34*b*lvl` (lines 730–732). The cubed rise
  keeps the bright part brief, so it reads as a soft sweep, not a snap. This is the calmest of the
  three animated elements and is correct.
- **The white strobe is now eased, night-dimmed, radius-capped, and attention-gated.** `peak =
  STROBE_PEAK_DAY − (STROBE_PEAK_DAY − STROBE_PEAK_NIGHT)*nf` → 0.85 day / 0.70 night (line 738),
  i.e. *lower* at night because the dark room makes a lower absolute alpha still read as bright.
  Radius is clamped (`min(glyphS*0.22, STROBE_RADIUS_MAX_PX=5)`, line 739). The pulse uses the
  `pulseEnv()` smoothstepped triangle (lines 705–710) over a ~140 ms window that *widens* with
  `nf` (line 741) — a "breath-flash," not a hard edge. The xenon-blue bloom is day-only and fades
  out by `nf=0.5` (lines 754–759). The per-hex `seedFor()` (lines 765–774) desyncs the sky. All of
  the strobe doc's §1/§2/§4 asks are present.
- **The density gate exists.** `strobeMode` is `2` for the tapped aircraft, `1` for traffic inside
  the spotlight radius, `0` for distant ambient (lines 173–177). Distant traffic carries no white
  strobe at all — the steady red/green/tail + beacon swell carry the "this is an aircraft" read.
  This is the single most important calmness lever and it is working: a busy sky is no longer a
  crackling field of white.

So the brief's worries — twitchy, lockstep, swarm, night glare, accessibility cap — are
substantially handled. The remaining findings are about a correctness gap, authenticity nuance,
and polish.

### P0 — none

There is no broken blinking-light behavior. The system is shippable as-is. Everything below is an
improvement, not a fix.

### P1 — the authentic double-flash never fires on the *auto*-spotlighted aircraft

**This is the most consequential blinking-light finding.** `strobeMode === 2` (the real two-pulse
xenon double-flash, lines 743–747) is reached *only* when `a.hex === f.selectedHex` (line 177) —
i.e. only when the user has **manually tapped** an aircraft. But SkyView's signature behavior is
the **auto-spotlight**: `SpotlightLayer` continuously features the nearest aircraft to home (its
internal `this.hex`, lines 86–97) and rings it with the gimbal reticle, *with no tap required*.
That auto-featured plane is exactly "the aircraft you're attending to" — yet it is never told
apart from ambient traffic at the strobe layer, because the spotlight's featured hex is **not
exposed on `FrameContext`** (confirmed: no `featuredHex` field in `render/types.ts`, no writer
anywhere in `web/src/display`). So on a passive, glance-only kiosk — the *default* mode of use —
the beautiful authentic double-flash essentially never appears. The plane the system is
spotlighting only gets `strobeMode=1` (a single soft pulse), identical to any other in-radius
traffic.

The strobe doc itself anticipated this — its §3/§5 explicitly say "the spotlight's auto-featured
hex can be exposed on `FrameContext` the same way the plan threads `transitCardOpen`" — but that
plumbing was never done; only the manual-tap path landed.

**Recommendation (small, high-payoff):** expose the spotlight's currently-featured hex on
`FrameContext` (add `featuredHex?: string`) and have `SpotlightLayer` publish `this.hex` each
frame (it already computes it). Then in `AircraftLayer.draw()` line 177, promote that aircraft to
`strobeMode = 2` as well:
`const strobeMode = (a.hex === f.selectedHex || a.hex === f.featuredHex) ? 2 : (...inRadius ? 1 : 0);`
Order is a wrinkle: layers run aircraft-before-spotlight, so either (a) have the renderer compute
the featured hex once before the layer loop (cleanest — it's the same nearest-within-radius
calculation), or (b) accept a one-frame lag (imperceptible). Net effect: the plane the kiosk is
already ringing also earns the one tasteful authentic double-flash — turning a feature that
currently only power-users see on tap into the ambient reward it was designed to be, while every
other aircraft stays calm.

### P1 — the landing-light beam is still gated to `strobeMode > 0`, not to the featured plane

`DESIGN-AUDIT-v5` recommendation #2 was to gate the warm forward landing beam to the
featured/selected aircraft. The code currently gates it on `strobeMode > 0` (line 210) — i.e. it
fires on **every** arriving aircraft inside the spotlight radius, not just the one featured plane.
During an arrival bank into SEA, that is still a *row* of warm forward cones lit at once (each one
lovely in isolation, collectively a cluster competing with the strobes and the approach geometry).
The audit's intent was "a near-home detail on the one plane you're watching."

**Recommendation:** change the beam gate at line 210 from `strobeMode > 0` to `strobeMode === 2`
(which, once the P1 above lands, means *the* featured/spotlit plane). The beam then becomes the
reward for the single aircraft you're attending to; other arrivals keep the calmer steady lights +
beacon. One-token change with the P1 plumbing in place.

### P1 — beacon and white-strobe are phase-correlated per aircraft (same seed)

Both the red beacon (`bp = (t*0.85 + seed) % 1`, line 730) and the white strobe (`ph =
(t/STROBE_PERIOD_S + seed) % 1`, line 740) use the **same** `seedFor(hex)` offset and near-equal
periods (1.18 s vs 1.10 s). On a real airframe the beacon and the strobe are independent systems
on different timers — they drift in and out of phase. Here, because they share a seed and have
almost the same period, on any given aircraft the red swell and the white flash will sit at a
nearly fixed relative phase that drifts only very slowly (the ~0.08 s period difference takes ~15 s
to walk a full cycle). It's subtle, but it slightly flattens the "two independent lights" realism
and can read as a single compound blink.

**Recommendation (polish-toward-realism):** give the beacon a second, decorrelated phase offset —
e.g. `const beaconSeed = seed * 1.7 + 0.37;` used only in `bp` — and/or widen the period gap (drop
the beacon to a true ~40/min, `t*0.67`, which is also closer to a real anti-collision beacon's
~40–45 flashes/min than the current ~51/min). The two lights then beat against each other the way
real ones do, with zero added cost.

### P2 — beacon realism: most real beacons are a fast double-pop, not a single swell

The current beacon is a single cubed-sine swell per cycle (line 731). Real rotating-beacon and
LED anti-collision beacons read to the eye as a quick *flash* (often a brief double on modern LED
units), not a slow swell — the swell is closer to a strobe-through-haze look. This is a
deliberate, defensible calm choice and **should not** become a hard flash on ambient traffic. But
for the *featured* plane (once `strobeMode=2` is reachable via the auto-spotlight), the beacon
could earn a slightly crisper profile to match the authentic double-flash it now sits beside —
e.g. a shorter, sharper cubed rise (`Math.pow(..., 4)`) at the same low peak. Low priority,
featured-only, keeps ambient calm.

### P2 — strobe radius cap can make a zoomed-in widebody's strobe *smaller* than its position lights

The strobe core radius is `min(glyphS*0.22, 5px)` (line 739), hard-capped at 5 px. The steady
position-light radius is `max(1.1, glyphS*0.12)` (line 722), **uncapped**. When you zoom in on a
single large aircraft (the zoom coupling lets `glyphS` grow up to ~2.6×, lines 137–139), the
position lights keep growing past where the strobe is frozen at 5 px — so on a zoomed-in widebody
the *steady* red/green can become physically larger than the *strobe* lens, which inverts the
real-world read (the strobe is the brightest, most eye-grabbing light on the airframe). The cap is
correct for *floodlight* safety, but it shouldn't let the steady lamps out-size the strobe.

**Recommendation:** either also cap the position-light radius (`lr = min(max(1.1, glyphS*0.12),
4.5)`), or lift the strobe cap a touch and tie it to the position-light size so the strobe is
always ≥ the steady lamp (e.g. `sr = clamp(glyphS*0.22, lr, 6)`). Keeps the floodlight guard while
preserving "strobe is the hottest light" at every zoom.

### P2 — `strobeMode=1` and the day-only blue bloom: confirm the single-pulse path is on the right ceiling

For ambient/close traffic (`strobeMode=1`) the strobe is a single `pulseEnv(ph, w)` at `peak`
(lines 746, 750). That's correct and calm. But the day-only xenon-blue bloom (lines 754–759) fires
for **both** mode 1 and mode 2 (it's inside the `if (strobeMode > 0)` block, gated only on
`nf < 0.5`). On a busy *daytime* sky, that means every in-radius aircraft gets a blue halo twice a
second. By day the blue bloom is the thing that "punches the flash through the bright satellite
map" — fine for a few close planes, but with a dozen inside the radius it re-introduces a milder
version of the daytime swarm the night gate already solved. **Recommendation:** restrict the
blue-bloom to `strobeMode === 2` (the featured plane) so day ambient traffic gets the clean white
single-pulse and only the attended plane gets the extra xenon punch. Low risk, removes a daytime
density creep.

### Performance note (blink animation)

The blink cost is low and well-managed. `drawNavLights` is plain `lamp()` arc fills (no
`shadowBlur`, no per-frame gradients except the gated landing beam), the silhouette is a cached
sprite (`glyphCache.ts`), `seedFor()` is memoized (line 765), label widths are cached, and the
whole nav-light/glow path is skipped during gestures (`!f.interacting`, lines 342, 360). Nothing
here needs optimizing. The only micro-note: `pulseEnv` and the two `% 1` phase computations run per
airborne aircraft per frame regardless of `strobeMode` — trivial, but if you ever want to shave it,
early-out of the strobe block when `strobeMode === 0` *before* computing `peak`/`w` (currently the
`if (strobeMode > 0)` guard is already there, so this is effectively done — no action).

### A novel idea worth considering (calm + beautiful + more real)

**Altitude-aware strobe cadence "twinkle."** Right now every aircraft's strobe period is identical
(`STROBE_PERIOD_S = 1.1`), only the *phase* varies by seed. Real anti-collision systems vary
subtly by type/era. A tiny per-aircraft period jitter — `period = STROBE_PERIOD_S * (0.92 + 0.16 *
fract(seed*3.3))` — would make the sky's flashes *beat* against each other organically instead of
all sharing one tempo, reading more like real distant traffic through a window and less like a
metronome grid. Pairs beautifully with the beacon decorrelation (P1 above) and costs nothing. Keep
it small (±8%) so it stays calm, not chaotic.

---

## Part 2 — Broader system review

The two prior audits (`COLOR-PALETTE-DESIGN.md`, `DESIGN-AUDIT-v5.md`) are thorough and most of
their P0/P1 items have landed (verified in source: ferry hull `[150,205,242]` + keyline, congestion
alarm `[235,150,60]`, trail climb/descend lightness split `[90,235,165]`/`[220,80,55]`, 1 Line bead
lifted to `[70,180,110]`, `RAIL-BALANCE.md` rebalance values). The broader system is coherent and
genuinely good. Below are the items that, reading the current code, are **still open** or newly
worth flagging — kept tight.

### P1 — the night brightness-law floor is still too high (`coreDim()`)

`night.ts` `coreDim()` returns `0.5 + 0.5*(1 - _nf)` — a **0.5 floor** at full night. The
DESIGN-AUDIT-v5 #1 recommendation (its highest-leverage item) was to lower the transit-core night
floor toward `0.45 + 0.55*(1-nf)` (or split off a `coreDimNight()`) so a distant ambient aircraft —
whose strobe is gated *off* (`strobeMode=0`) and whose only night presence is steady position
lights at `lvl = 0.18 + 0.82*nf ≈ 1.0` × the small `0.95*lvl` lamp alpha — is never out-read by a
near-white transit core sitting at `0.9–0.99 × 0.5`. Note the comment in `night.ts` line 12 still
says the floor is `0.5`; the RAIL-BALANCE doc (line 141) corroborates it. The rail-internal
hierarchy holds regardless, but the *cross-layer* law (aircraft always brightest at night) does
not yet. This is a one-line change in `coreDim()` and is the single highest-leverage broader fix.
Recommend implementing the audit's value and verifying a distant ambient plane's position lights
read above a full-night ferry deckhouse / train window core.

### P2 — bus density default still high for an ambient glance

`DESIGN-AUDIT-v5` #3 recommended dropping the bus cap toward ~40 and steepening the zoomed-out dim;
worth confirming whether that landed (the audit lists it as open). Buses are the least
aircraft-relevant moving layer and the cheapest place to lean the metro view back toward calm. If
`BusLayer` still has `CAP = 70`, drop it. (Verify in source before changing — not re-read here.)

### P2 — `selectedHex` suspends the night wash, but the auto-featured plane does not

`DESIGN-AUDIT-v5` notes the atmosphere night-dimming is correctly suspended when an aircraft is
*selected* (manual tap) so a tapped plane shows full color even at night. The auto-spotlighted
plane gets the gimbal ring but **not** the dimming suspension. With the P1 `featuredHex` plumbing
from Part 1, it would be natural and coherent to also let the featured plane (and only it) read at
full color — so the one plane the kiosk is highlighting is consistently treated as "the focus"
across strobe, landing beam, *and* atmosphere dimming. Optional, but it would unify the
ambient-vs-focus model the whole product gestures at.

### P2 — coherence cleanups the audit flagged (verify + sweep)

Two small residual constants the v5 audit named, worth confirming in current source:
- **Stale ferry crossing-lane color** — `FerryRouteLayer` `LANE` was `"140,195,235"` (the
  pre-keyline hull) while `FerryLayer` hull is now `[150,205,242]`. One-line drift.
- **Off-rhythm notable emblem pulse** — `NotableLayer.drawEmblem` `0.7 + 0.3*sin(t*5)` (~0.8 Hz)
  is the one animation faster than the house ~0.2 Hz breath; slow it to `~0.78 + 0.22*sin(t*1.3)`.

Neither is urgent; both are pure coherence polish.

### What needs no change

- **Altitude ramp** (`colors.ts` `ALT_STOPS`): excellent, monotonic-luminance, gamma-correct,
  CVD-safe by lightness. Untouched, correctly.
- **Spotlight card / gimbal** (`SpotlightLayer.ts`): the rotation+brightness-breath reticle (no
  size pulse, line 279), golden-hour warm lerp, and the CPA placard are all on-vocabulary and
  calm. Good.
- **Trails** (`TrailLayer.ts`): the flow-crest speed channel, smoothstep taper, MAX_TRAILS=40 cap,
  and gesture skip are disciplined. The climb/descend lightness split has landed. No change.
- **Draw order** (`Display.tsx`): verified correct by the v5 audit (basemap → ground/weather →
  transit → aircraft stack → atmosphere wash). No reorder needed.

---

## Summary — what to do, in priority order

1. **(P1, blinking) Expose the spotlight's featured hex on `FrameContext` and promote it to
   `strobeMode=2`** so the authentic double-flash fires on the auto-spotlighted plane, not only on
   manual tap. This is the biggest blinking-light win — the signature flash is currently
   near-invisible in passive kiosk use. `AircraftLayer.ts:177`, `SpotlightLayer.ts`,
   `render/types.ts`.
2. **(P1, blinking) Gate the landing-light beam to the featured plane** (`AircraftLayer.ts:210`,
   change `strobeMode > 0` → `strobeMode === 2`) so an arrival bank isn't a row of beams.
3. **(P1, broader) Lower the `coreDim()` night floor** (`night.ts`) so a distant ambient
   aircraft's steady lights always out-read a transit near-white core at night — the one place the
   brightness law still inverts.
4. **(P1, blinking) Decorrelate the beacon from the strobe** (separate seed + a slightly slower
   true ~40/min beacon, `AircraftLayer.ts:730`) for two-independent-lights realism.
5. **(P2) Polish set:** restrict the day xenon-blue bloom to the featured plane; cap position-light
   radius so the strobe is always the biggest lamp; optional ±8% per-aircraft strobe-period
   twinkle; sweep the stale ferry `LANE` color and the off-rhythm notable emblem pulse; confirm the
   bus cap.

No P0s. The blinking-light system is calm, night-aware, accessibility-bounded, and shippable
today; these changes make the *featured* aircraft the meaningful, beautiful focus the
ambient-vs-focus design intends, and close the last place the night brightness law inverts.
