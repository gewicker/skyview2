# Strobe / Beacon Intensity — Design Review

Design-expert review requested by George (2026-06-18): "need a design expert to weigh in on
the intensity of our strobe lights." This document assesses the aircraft anti-collision
strobe, the red rotating beacon, and the home beacon as they read on an always-on bedside /
living-space panel, and recommends concrete, code-level adjustments that fit the existing calm
vocabulary (the codebase already favors a brightness "breath" over a size pulse, and confines
hard strobing to aircraft alone).

## What the code does today

Everything aircraft-light lives in `drawNavLights()` at the bottom of
`web/src/display/render/AircraftLayer.ts` (lines 679–711), called once per airborne aircraft
per frame from `airborne()` (line 332). It is gated on `this.lightsOn` and modulated by the
night factor `nf`, which is derived from sun altitude in `nightFactor()` (0 by day, 1 at full
night) and overridden by `lightsMode` ("auto" / "on" / "off") from the config. The steady
position lights (port red, starboard green, tail white) ride a `lvl = 0.18 + 0.82 * nf` so
they nearly vanish in daylight and bloom at night — that part is already well-judged and is not
the subject of this review.

The two animated lights are the concern. The red anti-collision beacon uses a phase
`bp = (t * 0.85 + seed) % 1`, which is a period of about **1.18 s**, and brightens as a cubed
sine over the first 55% of the cycle (`Math.pow(Math.max(0, Math.sin(bp * Math.PI * 2)), 3)`),
dark for the remainder. Its peak alpha is `0.34 * b * lvl`, drawn additively (`lighter`), with
the lamp radius growing from `lr * 0.95` up to roughly `lr * 2.05` at the peak (`lr ≈ glyphS *
0.12`). Because the rise is a cubed sine, the bright portion is actually quite brief and the
effect is closer to a soft swell than a snap — this one is mostly fine.

The white wingtip strobe is the hot element. Its phase is `ph = (t * 0.9 + seed) % 1`, a period
of about **1.11 s**, and it fires a real-world-accurate **double flash**: once for `ph < 0.04`
and again for `0.1 < ph < 0.14` (two pulses ~0.066 s apart, then a long dark gap). The leading
frame of each pulse (`ph < 0.012` and `0.1 < ph < 0.112`, ~12 ms) gets a "capacitor-dump"
overshoot: a larger radius (`sbase * 1.25` vs `sbase`, where `sbase = max(2.6, glyphS * 0.22)`)
at **alpha 0.95**, plus a second wide xenon-blue ring at `sbase * 1.7` and **alpha 0.5**, both
on both wingtips, additively. The trailing (non-lead) frames sit at `0.3 + 0.65 * nf`. The
seed (`seedFor(hex)`) desynchronizes aircraft so the sky twinkles out of phase. Notably, the
strobe alpha and the leading-edge overshoot are NOT scaled by `nf` for the lead frame — the
hot 0.95 white core fires at full intensity by day and by night alike. That is the single
biggest comfort problem: at night, a 0.95-alpha additive white blob roughly 1.25× the glyph
half-size, doubled across both wingtips with a 0.5-alpha blue halo on top, is the brightest
thing on the panel and it is firing twice a second per aircraft.

For contrast, every other animated element in the codebase has already been deliberately calmed:
the home beacon (lines 277–282) eases brightness on an ~8 s asymmetric "lighthouse" breath with
a floor so it never fully dims; the spotlight gimbal ring uses a slow brightness breath and
rotation, explicitly NOT a size pulse (`SpotlightLayer.ts` line 279, with a comment naming the
bedside screen); the emergency edge border breathes at ~0.2 Hz (`NotableLayer.ts`); ferries,
buses, rail and the radar all carry "no strobe — aircraft-only" comments. The aircraft strobe
is the one place the calm vocabulary was set aside in the name of realism, and on an always-on
screen that realism is now working against the product.

## 1. Strobe timing

The timing is, in isolation, faithful to real aircraft (a ~1.1 s double-flash), and the per-
aircraft seed offset is the right instinct. The problem is not the once-per-second cadence — a
single soft pulse per second is genuinely calm and pleasant, the way a distant aircraft looks
through a window. The problem is the **double flash** and the **hard leading edge**. The two
sub-pulses 0.066 s apart create, for that one transition, an instantaneous flicker on the order
of 15 Hz, and the 12 ms leading-frame overshoot is a true hard-edged flash with no easing in or
out — it snaps from nothing to 0.95 and back. On a glanced-at ambient screen the eye is drawn
to exactly that sharp transient, which is the opposite of what we want at rest.

The recommendation is to keep the once-per-second rhythm but soften its shape, and to drop the
double flash in the calm (night / ambient) regime. Concretely: replace the two boxcar windows
and the binary `lead` overshoot with a single short eased pulse per cycle whose envelope rises
and falls over ~120–160 ms rather than snapping — a raised-sine or `t²(3−2t)` smoothstep
envelope reads as a "breath-flash": clearly a flash, clearly rhythmic, but without the
retina-grabbing hard edge. Keep the period near 1.1 s. The authentic double-flash is a lovely
touch and worth preserving for the **spotlighted / selected aircraft only** (see §3), where the
viewer is deliberately attending to one airplane and the realism is a reward rather than
ambient noise. Day vs night should differ in shape as well as brightness: by day a slightly
crisper pulse survives the bright satellite background and reads correctly; at night the
envelope should be longer and gentler (lerp the pulse width up with `nf`), because at night the
panel is the brightest object in a dark room and any sharp white transient is fatiguing.

## 2. Intensity / brightness

The peak is too hot at night, and the fix is to route the strobe through the same `nf` ceiling
the steady lights already respect. Today the lead frame ignores `nf` entirely and the trailing
frame only partly tracks it. Recommendation: give the strobe a single brightness term
`strobeLvl = (0.45 + 0.55 * nf) * peak`, and set `peak` from a configurable ceiling rather than
the literal 0.95. A peak alpha around **0.7 by night and ~0.85 by day** (i.e. invert the usual
dimming slightly so the night peak is *lower*, since the night background is darker and a lower
absolute alpha still reads as "bright") is far more comfortable while still legible across a
room. Drop the separate 0.5-alpha xenon-blue ring at night to roughly half (it is pure bloom and
contributes most of the glare); keep a hint of it by day where it helps the flash punch through
the bright map. Also cap the strobe radius growth: `sbase = max(2.6, glyphS * 0.22)` with a
1.25× lead multiplier means a zoomed-in widebody throws a very large white disc — clamp the
absolute strobe radius (e.g. `min(sbase, 5px)` for the core, `min(sbase * 1.5, 8px)` for the
halo) so zooming in on one aircraft doesn't detonate a floodlight.

There is already a global `brightness` field in `Config` (`shared/types.ts` line 32) and a
`lightsOutBrightness` / `lightsOutHour` monitor-mode pair (line 53); the cleanest home for a
hard ceiling is a small derived term in `AircraftLayer.draw()` that multiplies all aircraft
light alphas, so the existing night/lights-out machinery automatically dims the strobes along
with everything else. At minimum, fold `nf` into the lead frame today — that is a one-line change
with the biggest single comfort payoff.

## 3. Per-aircraft density

This is the most important point for the lived experience of the screen. A busy Seattle sky can
hold 30–60 airborne aircraft, each firing a double-flash roughly twice a second, seeded out of
phase. The aggregate is a continuously crackling field of white pops across the whole panel —
visually it reads as static / noise, not as calm sky, and it is the single thing most likely to
make the screen unpleasant to live with at night. Realistically you would never see this many
strobes at once out a window; the density is an artifact of a top-down synoptic view.

Recommendation: **gate the white strobe by attention and proximity**, not on every aircraft. The
spotlight system already computes the featured / selected aircraft (`f.selectedHex`,
`SpotlightLayer`), so the natural rule is: full authentic double-flash strobe only on the
spotlighted or tapped aircraft; for everyone else, either drop the white strobe to the single
soft eased pulse from §1 at a much lower ceiling, or suppress it entirely and let the steady
red/green/tail position lights carry the "this is an aircraft" read (they already do most of the
work). A middle path that preserves life in the sky without the noise: keep a gentle single
pulse for **close** traffic (inside the spotlight radius or above some altitude/size threshold)
and suppress the white strobe for distant ambient traffic, mirroring the existing distance
desaturation pattern used for callsign labels (`drawLabels`) and the traffic LOD already noted
in the pop-pass work. The red beacon swell is calm enough to leave running on all aircraft; it is
specifically the white xenon strobe that should become a feature of attention rather than a
property of every glyph. This single change — strobe follows the spotlight — converts a
flickering field into one or two tasteful, realistic flashes on the aircraft you're actually
looking at, which is both calmer and more meaningful.

## 4. Accessibility / photosensitivity

The guidance to clear is the WCAG / Harding three-flashes-in-any-one-second rule: content should
not flash more than 3 times per second in any region, and large bright-red flashing is a special
hazard. Per individual aircraft the strobe fires 2 sub-pulses per ~1.1 s cycle, which is under 3
flashes/second for that one glyph — so a single aircraft is within guideline. However, two risks
exist. First, the **0.066 s gap inside the double-flash** is a ~15 Hz transient for that pair;
while it is only one occurrence per second, hard sub-100 ms flashing is exactly the kind of
transient the guideline is built to discourage, and softening it (§1) removes the concern
entirely. Second, and more importantly, the guideline is about flashing *within a region of the
screen*: with dozens of seeded strobes, any small patch of sky where three aircraft overlap can
easily exceed 3 flashes/second in that region even though each plane is compliant. The §3
density gate is therefore not just an aesthetic fix but an accessibility one — limiting strobes
to the spotlighted aircraft (plus a soft single pulse elsewhere) keeps any screen region well
under the 3 Hz threshold by construction.

Recommendation: add an explicit hard cap as a named constant so the property is auditable —
document that no single light element exceeds one flash per ~1 s, that no flash is shorter than
~120 ms once eased, and that the per-region aggregate is bounded by the density gate. The red
beacon should also be confirmed under the red-flash special case: its peak alpha (`0.34 * b *
lvl`) times the additive blend is well below a saturated full-screen red flash and is fine, but
it should stay capped and never approach the strobe's brightness.

## 5. Concrete code changes

All changes are in `web/src/display/render/AircraftLayer.ts`, function `drawNavLights()` (and one
plumbing change to pass the selected/spotlight state in), with no change to `aircraftGlyph.ts`
anchors or `colors.ts`.

The first and highest-value change is to fold the night factor into the strobe's leading frame
and lower the ceiling. In the strobe block (lines 697–709), replace the binary `lead`/non-lead
alpha with a single eased envelope and a night-aware peak: compute a peak like `const peak =
0.85 - 0.15 * nf;` (lower at night), build a smoothstep envelope `env` over a ~140 ms window
that widens with `nf`, and set the lamp alpha to `peak * env`. Drop the `sr` lead-size multiplier
in the ambient case and clamp the radius (`Math.min(glyphS * 0.22, 5)`). Halve the xenon-blue
ring alpha and gate it on `nf < 0.5` (day only) so it stops contributing night glare.

The second change implements the density gate. Thread the "is this aircraft featured" boolean
into `airborne()` and on to `drawNavLights()` — the layer already has `f.selectedHex`, and the
spotlight's auto-featured hex can be exposed on `FrameContext` the same way the plan threads
`transitCardOpen` (`render/types.ts`). In `drawNavLights()`, branch: if `featured`, render the
full authentic double-flash (today's behavior, but still with the §1/§2 softening and ceiling);
otherwise render at most the single soft pulse, and for aircraft beyond the spotlight radius (or
below a size/altitude threshold) skip the white strobe entirely, leaving the steady position
lights and the red beacon swell. This reuses the distance logic already present for label density.

The third change is small and tidy: pull the magic numbers into named constants at the top of the
file — `STROBE_PERIOD_S`, `STROBE_PULSE_MS`, `STROBE_PEAK_DAY`, `STROBE_PEAK_NIGHT`,
`STROBE_RADIUS_MAX_PX`, `BEACON_PERIOD_S`, `BEACON_PEAK` — so the comfort ceiling and the
accessibility cap are visible in one place and can be exposed to the config later (alongside the
existing `lightsMode`, `brightness`, and `lightsOutBrightness`) if George wants a slider.

Optionally, also reduce the red beacon's per-cycle brightness floor at night by reusing the same
`nf`-aware peak, so the whole aircraft-light family dims together as the room darkens. The home
beacon (lines 277–295) is already calm and needs no change beyond confirming its peak
(`0.12 + 0.22 * breath` additive) stays below the new aircraft strobe ceiling, which it does.

Net effect: by day the sky keeps its crisp, legible, realistic strobing; at night the panel
settles into a calm field of soft red swells and steady jewel-toned position lights, with one or
two tasteful authentic double-flashes only on the aircraft the viewer is actually attending to.
