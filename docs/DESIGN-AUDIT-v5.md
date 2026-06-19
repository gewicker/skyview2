# SkyView 2 — Holistic Design Audit (v5)

George asked for a whole-product design evaluation now that SkyView 2 has grown from "aircraft over
a teal map" into a dense stack of living layers: aircraft (glyphs, altitude ramp, nav lights and
strobe, spotlight, route, trails, notable/emergency, holding, winds), weather (precip radar, marine
fog), road traffic (synthetic highways), transit (Link rail including underground spans, live trains,
buses, ferries with crossing lanes and terminals), and the new Fire/EMS 911 layer. The question this
audit answers is not "is any one layer good" — most are individually excellent and well-documented —
but "does the WHOLE still compose as one calm, aircraft-first picture, or has it accumulated
competition and clutter." Every value cited was read from source with the Read tool (the bash mount
serves stale copies of edited files, so it is not trustworthy for this).

The short version: the system is in genuinely good shape and is more coherent than its layer count
would suggest, because almost everything obeys two organizing ideas — a warm-grounded / cool-high
semantic axis, and a stated brightness law (aircraft brightest, then vessels/trains, then ground
context/weather). The risks now are not individual layers misbehaving; they are *cumulative* — the
brightness law that each layer honors in isolation is not actually guaranteed to hold once a dozen
layers paint together at night, and the default-on count has crept high enough that a busy daytime
moment over the city can read as full rather than calm. The recommendations below are mostly about
enforcing the law globally and tightening defaults, not about reworking any one layer's look.

## Visual hierarchy: the law is honored locally but not guaranteed globally

The intended hierarchy is explicit and consistently referenced in the layer comments: a plane should
be the brightest, most attention-grabbing thing on the panel, with vessels and trains a clear rung
below, and ground context (incidents, congestion, weather) a rung below that. Three mechanisms are
supposed to enforce it, and two of them are solid. Draw order is correct (covered in its own section
below) so a plane always composites on top. Additive blending and the white double-strobe are
genuinely reserved for aircraft — every transit and ground layer carries and obeys the "no additive
glow / no strobe — aircraft-only" rule (BusLayer, FerryLayer, RailLayer, FireEmsLayer all use
`source-over`; only AircraftLayer, SpotlightLayer, NotableLayer, MarineLayer and the trail crest use
`lighter`). That is the strongest guarantee in the system and it is working.

The third mechanism — relative *brightness* of the static cores — is where the law is not actually
guaranteed, and it is the most important finding in this audit. Aircraft position lights are scaled
by `lvl = 0.18 + 0.82*nf` in `drawNavLights` (AircraftLayer), meaning that by **day** the steady
red/green/tail lights sit at only ~0.18 alpha — deliberately near-invisible, because the strobe and
the additive glow carry the daytime aircraft read. But every live transit element draws a near-white
presence core at 0.88–0.99 alpha multiplied only by `coreDim()` (`night.ts`), whose floor is 0.7:
the train window band `rgba(232,246,255,0.9*cm)`, the dwelling-train core `0.98*cm`, the bus
windshield `0.95*cm`, the ferry deckhouse `0.99*cm`, the rail station core `0.98*cm`. So by day a
ferry deckhouse core (~0.99) and a train window band (~0.9) are far brighter, steadier white points
than an aircraft's own steady position lights (~0.18) — the only thing keeping the plane "brightest"
during the day is its additive glow and strobe, not its body. That is acceptable by design, but it
means the brightness law by day rests entirely on the additive/strobe channel, and any aircraft that
is *not* strobing (distant ambient traffic, where the strobe is gated off per the strobe doc) is
arguably out-read by a nearby ferry's white core. At **night** the inversion is real and not just
theoretical: aircraft position lights bloom to ~1.0×0.95 and the additive glow is present, so a close
plane wins — but a distant ambient plane (no strobe, glow only) against a transit core that still
sits at 0.7-floored near-white is a close contest the plane can lose. The palette doc anticipated
exactly this ("confirm the transit near-white cores, once nf-scaled, do not drop below the dimmed
aircraft position lights") and the `coreDim()` floor of 0.7 is too high to guarantee it. The fix is
to lower the night floor on the transit *cores specifically* (not the bodies) so the brightest pixel
on a dark panel is always an aircraft light; this is the single highest-leverage hierarchy change and
is listed first in the recommendations.

The Fire/EMS layer, by contrast, gets the hierarchy exactly right and is a model for how a new layer
should be added: it has no near-white core at all (its brightest pixel is a muted earth tone capped
around 0.62 alpha), no additive blend, no motion except one slow breath on the single worst fire, and
it sits in the ground tier under everything alive. The two Fire/EMS design docs reason about
subordination explicitly and the implementation matches them. It cannot win the eye from the sky, and
that is correct. No change needed there on hierarchy grounds.

## Clutter and density: the per-layer LOD is good; the aggregate default is heavy

Each moving layer has thoughtful internal LOD and capping, and individually none of them is the
problem. Aircraft labels are density-tiered (full cards collapse to callsign-only to glyph-only as
the sky fills, in `drawLabels`), trails cap at the nearest 40, buses cap at 70 and dim when zoomed
out, Fire/EMS caps at 24 with a severity+recency+proximity score, highways cap cars at 90 and gate
both cars and scrolling dashes behind a street-zoom `detail` factor, radar caps tiles, and the marine
fog is a fixed 14-blob pool. This is disciplined work and it is why the product does not fall apart.

The clutter risk is not within any layer; it is the *sum* of the always-on layers plus the moving
ornaments. Reading the registration order in `Display.tsx`, the layers that default ON and paint
ambient motion include rail (line + stations + live/sim trains with comet tails and shimmer), buses,
ferries (hulls + speed-scaled wakes + terminal anchors), Fire/EMS, plus the aircraft ornaments
(landing-light beams on every arrival, takeoff/landing flourishes, holding badges, the trail flow
crest, the home beacon breath, the spotlight gimbal). Radar, marine fog, highways, procedures, and
navaids are off by default, which is the right call and keeps the worst offenders opt-in. But on a
busy weekday over Seattle the default set alone — dozens of aircraft each with an altitude glow and
trail, a jade rail line threaded with green/blue train beads, a swarm of violet buses capped at 70,
several ferries dragging wakes, and a civic haze of incident discs — is a lot of simultaneous
low-level motion. The calm rule the docs repeatedly invoke ("a glance should say what's happening
without the room feeling like a scanner") is satisfied for any single layer but is under pressure from
the chorus.

Three concrete density levers are worth pulling. First, the **bus cap of 70 is high for an ambient
glance** — 70 periwinkle beads with comet tails is a swarm even capped, and buses are the least
aircraft-relevant layer; dropping the cap toward ~40 and steepening the zoomed-out dim would calm the
metro view substantially with little information loss (the nearest buses are the only ones a glance
cares about). Second, the **landing-light beam fires on every arriving aircraft** (AircraftLayer, the
`arrivingLocal` block) as a warm forward cone that lengthens on short final — lovely on the one plane
you're watching, but during an arrival bank into SEA that is a row of warm beams competing with the
strobes and the approach geometry; consider gating the beam to the spotlighted/selected aircraft the
same way the white double-strobe already is, leaving distant arrivals to the calmer steady lights.
Third, **highways and radar, when a user does turn them on, currently stack additively in attention
with everything else** — they are correctly off by default, but there is no "ambient vs focus" master
that thins the chorus; the design already has the spotlight concept, and a future "calm mode" that
drops bus/ferry/incident density and suppresses the non-featured landing beams would be the clean way
to give the busy moments a release valve. None of this is urgent; the product is not broken at
density. But the trend line is toward "full," and the defaults are the cheapest place to lean back.

## Coherence: one palette and one motion vocabulary, with a few residual outliers

The palette is a real system, not a pile of colors, and the dedicated color-palette design doc
already audited it thoroughly; most of its P0/P1 fixes have landed (the ferry hull is now
`[150,205,242]` with a dark keyline, the congestion alarm stop is the more-orange `[235,150,60]`, the
trail climb/descend pair carries a lightness split `[90,235,165]`/`[220,80,55]`, the 1 Line train
bead is lifted to the brighter `[70,180,110]` so the vehicle out-reads its own jade track, and the
transit cores route through `coreDim()`). The warm-grounded/cool-high axis holds across aircraft
altitude, congestion, lateness tint, the home gold, and the emergency reds; each transit mode owns a
distinct hue spoke (jade rail, violet bus, steel-cyan ferry); and selection/spotlight lives in a
cyan/gold pair deliberately outside the traffic vocabulary. A viewer needs no legend, which is the
whole point of an ambient display.

A handful of small coherence outliers remain. The clearest is a **stale color constant**: after the
ferry hull was bumped to `[150,205,242]` in `FerryLayer`, the `FerryRouteLayer` crossing lane was
left at the old `LANE = "140,195,235"`, so the lane and terminals that reveal on tap are a slightly
different steel-cyan than the hull they belong to — a one-line drift worth fixing for consistency.
The **violet bus** remains the one hue outside the warm/cool axis (it reads as "other"), which the
palette doc already accepted as the price of mode separation and is fine. The **motion vocabulary** is
otherwise impressively unified around "brightness breath, not size pulse, and never a strobe" — the
home beacon's ~8 s lighthouse breath, the spotlight gimbal's slow rotation-plus-breath, the notable
edge border's ~0.2 Hz breath, the rail station arrival ring's single "drop in water," the Fire/EMS
arrival ripple and major-fire breath, and the trail flow crest all read as one family. The one motion
element that still slightly stands apart is the **emblem pulse in NotableLayer** (`drawEmblem` uses
`0.7 + 0.3*sin(t*5)`, a ~0.8 Hz pulse that is faster and snappier than the calm ~0.2 Hz breaths
everywhere else) — minor, since emblems only appear on genuinely flagged aircraft, but it is the one
animation that does not match the house rhythm and could be slowed to the same breath rate the rest of
the system uses.

## Layer-order correctness

The draw order in `Display.tsx` (`useEffect`, the `r.use(...)` sequence) is correct and matches the
documented intent. From bottom to top: basemap, then radar precip (a translucent ground tint), then
the cached static airport geometry and night runway lights, then approach/procedure/navaid overlays,
then place labels, then marine fog, then **Fire/EMS** (correctly the lowest of the "civic" marks,
under all traffic per its design doc), then highways (the synthetic car wash, above fog), then the
ferry crossing lane and ferry hulls, then rail (line + stations, above the car/vessel wash because
real infrastructure shouldn't be buried by the synthetic congestion ribbon), then buses, then trains,
then trails, route, leader, and finally the aircraft glyph stack (aircraft, spotlight, notable,
holding, winds), with the atmosphere dimming/golden wash drawn last over everything. This honors the
brightness law structurally: aircraft and their ornaments composite on top of all transit, transit on
top of the ground/weather context, and the atmosphere grade sits above all of it so night dimming
applies uniformly (and is correctly suspended when an aircraft is selected, so a tapped plane shows in
full color even at night). The one subtle point worth noting is that **winds is drawn after aircraft
and atmosphere** but is a fixed top-left panel, so it is never dimmed by the night wash and never
overlaps the spotlight card (top-right) or the transit/incident cards (bottom-left) — that placement
is deliberate and fine. No reordering is needed.

## The top refinements, prioritized

**1. Lower the night floor on transit near-white cores so the brightness law holds at night
(hierarchy — highest leverage).** `night.ts`, `coreDim()` returns `0.7 + 0.3*(1 - nf)`; a 0.7 floor
leaves the transit window/deckhouse/station cores brighter at full night than the dimmest aircraft
position lights, which is the one place the documented law can invert. Lower the floor for the cores
specifically (e.g. `0.45 + 0.55*(1 - nf)`), or add a separate `coreDimNight()` the transit core fills
use, so the brightest pixel on a dark panel is always an aircraft light. Verify against the aircraft
`lvl = 0.18 + 0.82*nf` so cores land below a night-bloomed position light.

**2. Gate the landing-light beam to the featured/selected aircraft (clutter).** AircraftLayer, the
`if (!ground && this.lightsOn && arrivingLocal(a))` block draws a warm forward cone on *every*
arriving aircraft; during an arrival bank that is a row of competing beams. Reuse the existing
`strobeMode`/`f.selectedHex`/spotlight-radius gate that already calms the white strobe, so the beam is
a reward for the plane you're attending to rather than ambient noise on all of them.

**3. Drop the bus cap and steepen the zoomed-out dim (clutter).** `BusLayer`, `CAP = 70` and
`zoomMul = max(0.45, …)`. Lower `CAP` toward ~40 and the `zoomMul` floor toward ~0.3 so the metro view
shows the nearest buses as quiet texture instead of a violet swarm; buses are the least
aircraft-relevant moving layer and the cheapest to thin.

**4. Fix the stale ferry crossing-lane color (coherence).** `FerryRouteLayer`, `LANE =
"140,195,235"` is the pre-keyline hull color; the hull is now `[150,205,242]` in `FerryLayer`. Update
`LANE` to `"150,205,242"` so the tapped crossing lane and terminals match the hull they belong to.

**5. Slow the notable emblem pulse to the house breath rate (coherence).** `NotableLayer`,
`drawEmblem` uses `pulse = 0.7 + 0.3*sin(t*5)` (~0.8 Hz), the one animation faster than the system's
~0.2 Hz breaths. Drop it to roughly `0.78 + 0.22*sin(t*1.3)` to match the edge-border and beacon
rhythm so flagged-aircraft emblems read as part of the same calm vocabulary.

**6. Add a "calm/ambient" density master for busy moments (clutter — design-forward).** The product
has a spotlight (focus) concept but no global thinning lever. A single config flag that, when on,
drops bus/ferry/incident caps and densities and suppresses the non-featured landing beams and the
trail flow crest would give the busiest daytime city view a release valve without forcing the user to
toggle five layers. This is the structural answer to "the trend is toward full"; it formalizes the
ambient-vs-focus idea the spotlight already gestures at.

**7. Confirm the two-greens separation on the panel (coherence — verify, don't change blindly).** The
1 Line train bead `[70,180,110]`, the jade rail track `[40,225,170]`, the 15k-ft altitude meadow
green `[126,205,150]`, and the climb-trail green `[90,235,165]` all live in the green wedge. The
palette doc's fixes were aimed at exactly this and have landed; the remaining action is to *verify on
the actual 1280×800 panel* that a low climbing aircraft trail and a 1 Line train do not read as the
same family over teal water, rather than to nudge values speculatively.

**8. Reconsider whether Fire/EMS should default on (taste — for George).** The Fire/EMS layer is
beautifully subordinated and cannot win the eye, so this is not a hierarchy concern; it is a taste
call. A live 911 feed on a *bedside* panel is the most loaded content in the product, and while the
night arrival cue and breath are suppressed in the muted window, the discs themselves persist. Worth a
deliberate decision on whether the default-on is right for the bedside surface specifically (the
per-surface config model already supports differing the kiosk from the web), versus on for the
wall/living-space surface only.

Net: nothing here is a redesign. The architecture is sound, the draw order is right, the palette is a
real system, and the motion vocabulary is unified. The work is to (a) make the brightness law a
global guarantee at night rather than a per-layer convention, (b) lean the defaults back toward calm
as the layer count has grown, and (c) clean up a few residual constants and one off-rhythm animation —
so the whole continues to read as one calm, aircraft-first picture even on the busiest evening.
