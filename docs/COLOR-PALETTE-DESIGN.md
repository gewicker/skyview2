# Color Palette — Design Review

Design-expert review requested by George (2026-06-18): "our design expert needs to evaluate our
color palette." This document evaluates the whole color system of SkyView 2 — an always-on
ambient ADS-B + transit map that lives on a 1280×800 touch panel as a wall/bedside display,
viewed day and night over a dark satellite/teal-water basemap — for harmony, legibility against
that basemap, semantic clarity, color-blindness robustness, and day/night behavior. It closes
with a concrete, prioritized set of code-level changes that fit the established calm vocabulary.
Every value cited was read directly from the source (the bash mount is stale on edits, so the
Read tool is authoritative here).

## The ground truth: what the basemap actually is

Before judging the foreground colors it helps to be precise about what they sit on, because the
single recurring risk in this palette is "transit/traffic hue collides with the map's own hue."
The default config palette (`internal/config/config.go` line 204) is `bg #05080d`, a near-black
blue-navy. The satellite basemap is then graded in `MapLayer.gradeSatellite()` toward a desaturated
steel with a teal color-cast (`multiply rgb(168,192,210)`, then a `color`-blend of
`rgba(38,140,165,0.15)`), and the dark/wire map is graded explicitly teal→blue in `gradeDark()`
(a `color` gradient from `rgba(34,150,168,0.85)` at top to `rgba(28,96,150,0.85)` at bottom).
The cinematic pass adds a teal glow pool (`rgba(22,72,92)` / `rgba(26,86,108)`) and a navy-teal
vignette (`rgba(6,14,22)`). So the world the foreground competes against is a **dark navy that
warms to mid-teal and mid-blue** — chroma is low but it is unmistakably in the cyan-teal-blue
wedge, roughly hue 185–210. Anything we draw in that same wedge at low saturation will camouflage.
The altitude ramp's designers already knew this — the comment on the high-altitude stops in
`colors.ts` explicitly says the pale blues are pulled "off saturated cyan" and lifted in lightness
"so it doesn't collide with chart cyan." The rest of the palette needs to honor the same rule, and
mostly does, with two real exceptions called out below.

## Palette inventory

Reading across the render layers, the live semantic colors are as follows. The aircraft altitude
ramp (`colors.ts`, `ALT_STOPS`) runs as a gamma-correct earth→sky gradient: surface terracotta
`[176,107,67]`, burnt ochre `[206,138,71]` at 2.5k, amber gold `[232,176,82]` at 5k, golden wheat
`[238,210,110]` at 8k, sage `[190,214,120]` at 11k, meadow green `[126,205,150]` at 15k, teal
`[96,192,206]` at 20k, softening pale `[140,198,224]` at 27k, pale steel-blue `[188,216,238]` at
35k, near-white ice `[224,236,248]` at 44k. Ground aircraft are a fixed subdued warm
`GROUND_RGB [200,122,60]` (AircraftLayer) and a lost contact desaturates to cool grey
`[150,162,176]`. The home beacon is gold — `accent #ffc83c` in the layer, drawn additively as
`rgba(255,200,70)` (AircraftLayer lines 296–303). Nav lights are the real aircraft set: port red
`[255,42,38]`, starboard green `[40,235,90]`, warm-white tail `[255,247,235]`, red anti-collision
beacon `[255,40,32]`, white xenon strobe `[255,255,255]` with a day-only blue bloom `[200,225,255]`.

Comet trails (`TrailLayer.ts`) in altitude mode reuse the ramp; in climb mode they run green-up
`TRAIL_CLIMB [60,230,150]`, neutral `TRAIL_LEVEL [130,150,185]`, red-down `TRAIL_DESCEND [255,95,60]`;
in flat mode they use `palette.trail #cfd8e3` (a near-white cool grey).

Rail is jade: the Link **track ribbon** is `LINE rgba(40,225,170)` with a bright centerline
`[150,240,200]` and near-white station cores `[232,255,244]` (`RailLayer.ts`). The **live trains**
on top of it (`TrainLayer.ts`) use the *official* line colors instead — `LINE_RGB` 1 Line green
`[40,129,63]` (28813F) and 2 Line blue `[0,124,173]` (007CAD) — tinted by punctuality:
`LATE_RGB [255,150,90]` warm coral when late, `EARLY_RGB [180,210,255]` cool ice when early, capped
at 50% blend. Buses are periwinkle violet `BUS [150,130,235]` with a bright windshield core
`[238,234,255]` (`BusLayer.ts`). Ferries are steel-cyan `HULL [140,195,235]` with a near-white
deckhouse `[238,246,252]` and the crossing-lane reveal `LANE [140,195,235]` matching the hull
(`FerryLayer.ts`, `FerryRouteLayer.ts`).

Highway congestion (`colors.ts`, `CONG_STOPS`) climbs cool-dim → hot-bright: clear slate
`[110,128,145]`, pale steel `[132,160,180]` at 0.35, amber `[230,170,70]` at the 0.6 alarm
crossover, orange `[236,118,70]` at 0.8, hot red-magenta `[236,70,120]` at jam. Precip radar is
RainViewer's cool "Universal Blue" scheme (`RadarLayer.ts`, `SCHEME = 2`), a blue→green→yellow
ramp painted source-over (deliberately *not* additive). Selection/spotlight is the cyan/gold pair
`RING_CYAN [57,194,216]` (= the config `accent #39c2d8`) and `RING_GOLD [255,184,92]`, lerped by
golden hour. Emergency/notable markers (`NotableLayer.ts`) carry their own category set: medical
red `[214,30,30]`, fire orange `[255,140,36]`, police blue `[70,132,255]`, military olive
`[150,170,100]`, emergency-warn red `[235,60,50]`; the config `warn #ff5a4d` is the same red family.

## Harmony: a coherent system, with two structural tensions

Taken as a whole this is a genuinely well-considered palette, and it is more coherent than most
data-display palettes because almost everything was chosen against a single organizing idea:
**warm = grounded/alert, cool = high/calm**, on a cool basemap. The altitude ramp is the spine of
that idea and it is excellent — monotonic in perceived lightness, densest where the traffic is
(0–12k), gamma-correct so the warm→green→teal transitions don't mud through their midpoints, and
deliberately steered away from saturated cyan up high. The congestion ramp deliberately mirrors
the *same* warm-means-bad logic and ends on a magenta that the map never uses. The transit modes
were each picked to occupy a different hue spoke — jade rail, violet bus, steel-cyan ferry — and
the layer comments show the author actively deconflicting them ("violet is clear of the rail jade,
the aircraft cyan/amber, the gold home beacon"). The selection language is a tight cyan/gold
complementary pair that is intentionally *outside* the traffic vocabulary so "this is UI, this is
the thing you picked" always reads. This is a system, not a pile of colors.

There are two structural tensions worth naming. The first is **the two greens problem in the rail
stack**. RailLayer paints the static track in a bright, saturated jade `[40,225,170]`, but the live
trains that ride that exact track use the official 1 Line green `[40,129,63]`, which is a much
darker, more olive, less saturated green. The intent (track = SkyView's house jade; vehicle =
authentic agency color) is defensible, but the result is that a 1 Line train is a dim olive bead
sitting on a vivid mint ribbon — the vehicle reads as *less* alive than its own track, which
inverts the brightness law the rest of the system follows (live/measured should out-read static
infrastructure). Worse, the 1 Line green `[40,129,63]` is close enough to the altitude ramp's
15k-ft meadow green `[126,205,150]` and the climb-trail green `[60,230,150]` that a low train and a
climbing aircraft trail can read as the same family. The jade track is fine and distinctive; it is
the *train* green that is the weak link.

The second tension is **the violet bus is the one outlier hue**. Periwinkle `[150,130,235]` is the
only thing on the map in the blue-purple wedge, which is exactly why it was chosen (maximum
separation), and at full saturation against the teal map it does pop. But it is also the only hue
in the whole system that does not participate in the warm/cool semantic axis — it reads as neither
"grounded/alert" nor "high/calm," just "other." That is acceptable for a transit mode (mode
identity legitimately wants its own spoke), but it does mean the bus is the one element that can
look slightly out of key, especially against the radar's blue-green tiles. It does not need to
change hue; it needs to be confirmed legible (below) and that is enough.

## Legibility on the dark teal basemap

This is where the two real problems live, and both are in the marine/cyan corner of the wheel.

**Ferry steel-cyan `[140,195,235]` is the most at-risk color in the system.** A WA State Ferry's
entire job is to be visible *on the water*, and the water is precisely the teal-blue the ferry hull
is made of. The hull is a desaturated light blue at hue ~210; the graded water warms to teal at hue
~190–200; the separation is mostly *lightness* (the hull is lighter) plus a little hue. The layer
author clearly fought this — the comment says "brighter steel-cyan so it stands off the teal water,"
the halo was widened, and the deckhouse core was made near-white `[238,246,252]`. That near-white
core is doing most of the legibility work and it is the right instinct. But the *hull body* and the
*crossing lane* still sit only ~one lightness step off the brightest (foreground) part of the
graded water, and the ferry is also the slowest-moving, least pre-attentive vehicle on the map (no
glow, no strobe by design). The recommendation is **not** to abandon steel-cyan — it is the correct
marine color — but to push the hull cooler-and-lighter away from the water's hue and lean harder on
the bright core. A hull around `[150,205,242]` (a touch lighter and very slightly less green than
today) plus keeping the near-white deckhouse is a safe quick win; the larger, more reliable fix is
to give the hull a thin **dark contour** (a 1px `rgba(8,14,22,0.5)` stroke around the hull polygon,
the same trick `drawGroundMarker` already uses for ground aircraft) so the boat is separated from
the water by a dark edge rather than by hue alone. A dark keyline survives any background and any
color-vision type, which is exactly what an always-glanced marine marker wants.

**Jade rail near teal water is the second case, milder.** The track ribbon `[40,225,170]` is a
saturated mint-green; over teal water (hue ~190) the hue separation is real (green vs. cyan) and the
ribbon is bright, so the *track* is fine. The risk is narrower: the **station halo** is drawn at
`0.18–0.45` alpha in that same jade, and a low-alpha saturated green over teal can desaturate toward
the background and read as a smudge rather than a "stop." The station ring and the near-white core
carry the read, so this is low priority, but if it ever looks soft, lift the halo's minimum alpha or
borrow the same near-white core trick the ferries use. The train *bead* legibility issue is the green
one discussed under harmony, addressed below.

Two smaller notes. The **flat-trail / lost-contact greys** (`#cfd8e3`, `[150,162,176]`) are cool and
light and read fine; no action. The **congestion "clear" slate `[110,128,145]`** is intentionally
dim so clear road recedes into the navy — that is correct, but verify on the actual panel that it
does not vanish entirely under the foreground-warm part of the satellite grade; if it does, it has a
healthy floor (the FLOOR cutoff means clear road draws nothing anyway, so this is self-correcting).

## Semantic clarity: mostly excellent, one overloaded hue

The semantic mapping reads well at a glance. Warm-equals-alert is consistent: ground aircraft are
warm, low altitude is warm, congestion's alarm is warm-to-magenta, lateness is warm coral, the home
beacon is warm gold, emergencies are red. Cool-equals-calm/high is equally consistent: high altitude
is cool, early trains are cool ice, the selection ring's resting state is cyan. Each transit mode is
hue-distinct. A viewer does not need a legend, which is the whole point of an ambient display.

The one genuinely **overloaded hue is amber/gold in the warm band**, and it is worth being honest
about. Amber currently means at least four things: aircraft at ~5k ft (`[232,176,82]`), *all* ground
aircraft (`[200,122,60]`), the **congestion "slow" alarm** at 0.6 (`[230,170,70]`), and the home
beacon (`[255,200,70]`). These mostly disambiguate by *context and shape* — a glyph vs. a road
ribbon vs. a breathing ring at the fixed home point — so in practice the collision is tolerable, and
the altitude/ground ambers are *meant* to be one family. But the congestion "slow" amber `[230,170,70]`
is almost exactly the home-beacon gold and very close to the 5k-ft aircraft amber, which means a
moderately congested freeway segment near home glows the same color as a low aircraft over the same
spot. The fix is cheap and improves the congestion ramp on its own terms: nudge the congestion alarm
stop slightly more *orange* (toward `[235,150,60]`) so the "first alarm" reads as hotter and more
clearly road-traffic, widening the gap from both the aircraft amber and the gold beacon. The gimbal
`RING_GOLD [255,184,92]` and home gold `[255,200,70]` being near-identical is fine and arguably good
— they are both "SkyView's attention gold."

The **late-train coral `[255,150,90]`** is a deliberate, well-judged choice: it is described as
"earthier than aircraft amber" specifically to avoid reading as an altitude color, and at the 50%
blend cap it stays a tint, never a category flip. That restraint (lateness is *temperature*, not a
state change) is exactly right for an ambient display and should be preserved.

## Color-blindness

The system is more robust here than most, because its primary semantic axis is **lightness**
(altitude ramp, congestion ramp) rather than hue — and lightness survives all three common CVD
types. The altitude ramp's own comment confirms this was a design goal. That is the single most
important fact and it is good news: the most information-dense element in the product is already
CVD-safe by construction.

The exposures are at the points where **hue alone** carries meaning:

The **nav-light red/green pair** (port `[255,42,38]`, starboard `[40,235,90]`) is the classic
deuteranopia/protanopia hazard — a red-green axis at similar-ish lightness. Here it is largely
acceptable for two reasons: it is *realism reproduction* (real aircraft use exactly this red/green
and a CVD pilot lives with it), it is redundant with **position** (port is always the left wingtip,
starboard the right, anchored to the airframe), and the white tail + red beacon + white strobe give
multiple non-red/green cues that "this is an aircraft." No change needed, but it is worth keeping the
green bright (the current `[40,235,90]` is high-lightness, which helps protans for whom red darkens).

The **climb/descent trail pair** (green-up `[60,230,150]` / red-down `[255,95,60]`) is a real
red-green encoding carrying real meaning (vertical trend) with no redundant channel — a deutan sees
both as muddy yellows of similar lightness. This is the weakest CVD spot in the system *for the
information it carries*. The good news is that there is already a redundant channel available and
unused: the **vertical-rate arrow `↑`/`↓`** is printed in the label (`AircraftLayer.labelLines`),
and altitude-mode trails (the default-ish alternative) encode trend as lightness via the ramp. The
recommendation is to lift the **lightness** difference between the climb and descend trail colors so
the encoding is lightness-plus-hue rather than hue-only: keep descend warm but **darker** and climb
cool-green but **brighter**, e.g. descend `[235,110,80]` (slightly lighter is wrong — make it read
*heavier*) is the wrong direction; the correct move is climb = bright high-lightness green
`[90,235,165]`, descend = a deeper, lower-lightness red-orange `[220,80,55]`, so up literally reads
lighter/lifting and down reads heavier/darker. That makes the trail trend survive deuteranopia on
lightness alone while keeping the intuitive warm/cool hue for everyone else. (`TRAIL_LEVEL` neutral
is already mid-lightness and fine.)

The **early/late train tint** (warm coral / cool ice) is a warm-vs-cool axis, which is more
CVD-robust than red-vs-green, but late-coral and early-ice can both desaturate toward grey for a
strong deutan. Because lateness is a soft tint and not a hard state, this is low-risk; if you ever
want it bulletproof, lateness already has a redundant home in the tap card text, and the cool-ice
early tint reads as "lighter/bluer" which survives.

The **emergency category colors** (medical red, fire orange, police blue, military olive) lean on
hue, but each notable marker also draws a **distinct icon** (cross, flame, shield, chevron — see
`NotableLayer`), so the shape is the real carrier and color is reinforcement. That is the correct
pattern and needs no change.

## Day vs. night

The product already has the right machinery: a sun-driven `nightFactor` (0 day → 1 night) that
dims the aircraft lights, the strobe ceiling work documented in `STROBE-INTENSITY-DESIGN.md`, the
monitor modes (`day`/`night`/`red`/`lightsout`), and a global `brightness`. The palette-level
observation to add is this: **at night the panel is the brightest object in a dark room, and the
fatiguing elements are the near-white cores, not the colored bodies.** The system leans on near-white
cores everywhere for "there is a live thing here" — train window band `[232,246,255]`, train shimmer
and bus/ferry cores `[238,…]`, station cores `[232,255,244]`, the strobe `[255,255,255]`. By day
against the bright satellite grade these are perfect and necessary. At night, against the dark
basemap, a 0.9–0.99-alpha near-white dot is the panel's brightest pixel and it does not need to be —
a `0.7`-alpha warm-white would read just as present and far calmer. The strobe doc already makes
this argument for the aircraft strobe (peak *lower* at night because the background is darker); the
recommendation here is to **generalize that principle to the transit cores**: introduce a single
`nf`-aware multiplier on the bright-core alphas in TrainLayer/BusLayer/FerryLayer/RailLayer so the
"presence" dots dim with the room exactly as the aircraft lights already do. That is the one
palette-level night adjustment beyond the existing `nightFactor` dimming, and it makes the whole
foreground settle at night instead of only the aircraft layer settling. (The `red` monitor mode for
true night-vision-preserving use is a separate, more drastic path and is out of scope for the color
*palette* per se.)

A second night note: the home beacon's resting gold and the gimbal gold are warm and additive; they
are already on breaths with floors and are calm. Confirm only that the transit near-white cores,
once `nf`-scaled, do not drop *below* the dimmed aircraft position lights — the brightness law
(aircraft brightest, then vessels/trains, then cars/weather) should hold at night too.

## Prioritized code-level changes

These are sequenced safe-quick-wins first, then the small reworks. None touch the altitude ramp,
which is correct as-is.

**P0 — quick wins, fit the existing vocabulary directly.**

1. **Ferry hull dark keyline (legibility).** `FerryLayer.ts`, the hull fill block (~lines 92–100):
   after the `fill()`, add a thin dark stroke `ctx.strokeStyle = "rgba(8,14,22,0.5)"; ctx.lineWidth
   = 1; ctx.stroke();` on the same hull path. Optionally bump `HULL` from `[140,195,235]` to
   `[150,205,242]`. This is the single highest-value legibility fix; the keyline separates the boat
   from the teal water in any light and for any CVD type.

2. **Congestion "slow" alarm more orange (semantic disambiguation).** `colors.ts`, `CONG_STOPS`
   index 2: change `[0.6, [230,170,70]]` to `[0.6, [235,150,60]]`. Pulls the first congestion alarm
   off the home-beacon gold and the 5k-ft aircraft amber, sharpening "this is road traffic."

3. **Climb/descent trail lightness split (CVD).** `TrailLayer.ts`: change `TRAIL_CLIMB
   [60,230,150]` → `[90,235,165]` (brighter) and `TRAIL_DESCEND [255,95,60]` → `[220,80,55]`
   (deeper/darker), keeping `TRAIL_LEVEL` as-is. Encodes vertical trend in lightness as well as hue
   so it survives deuteranopia; the printed `↑`/`↓` arrow remains the explicit redundant channel.

**P1 — small rework, clear payoff.**

4. **Lift the live-train bead green so the vehicle out-reads its track (harmony + brightness law).**
   `TrainLayer.ts`, `LINE_RGB`: the 1 Line bead at official `[40,129,63]` is darker than its own
   jade ribbon and close to the meadow-green altitude stop. Either brighten the bead toward the
   house jade while keeping it identifiably green (e.g. 1 Line `[70,180,110]`), or — cleaner — keep
   the official color for the tap-card swatch but draw the *bead body* in the brighter house jade
   family so live trains glow above the static track. Confirm the 2 Line blue `[0,124,173]` stays
   clear of the ferry steel-cyan (it does: more saturated, darker, different role/location).

5. **Night-aware transit cores (`nf` generalization).** TrainLayer / BusLayer / FerryLayer /
   RailLayer: thread the same night factor the aircraft layer computes (or expose it on
   `FrameContext`) and multiply the **near-white core** alphas (train window band `[232,246,255]`,
   bus/ferry cores `[238,…]`, station core `[232,255,244]`) by a `0.7 + 0.3*(1−nf)` term so the
   bright presence-dots calm down at night with the room, preserving the brightness law. This is the
   one palette-level night change beyond existing dimming.

**P2 — optional polish.**

6. **Station halo floor over water (legibility, low priority).** `RailLayer.ts`: if the jade station
   halo reads soft over teal water on the panel, raise its minimum alpha (the `0.18` base) or add the
   near-white core trick the ferries use. Verify on-device first; the ring + core already carry it.

Net effect: the altitude spine and the warm/cool semantic axis are preserved untouched; the two
real legibility risks (ferry-on-water, train-on-track) get fixed with the codebase's own existing
tricks (dark keyline, brightness law); the one overloaded amber is teased apart; the one hue-only
CVD encoding gains a lightness channel; and the whole foreground learns to settle at night the way
the aircraft lights already do — all without introducing a single new hue or breaking the system's
existing, genuinely good coherence.
