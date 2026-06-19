# Fire / EMS 911 Dispatch Layer — Design Review

Design proposal for a new live Fire/EMS 911 incident layer, sourced from the City of Seattle
real-time 911 SODA open-data endpoint (keyless): each record carries an address, a `type` string
(e.g. "Aid Response", "Medic Response", "MVI - Motor Vehicle Incident", "Fire in Building",
"Auto Fire Alarm", "Rescue"), a datetime, lat/long, and an `incident_number`. Incidents surface
within minutes and must auto-expire after a while.

This is the hardest taste problem in the product so far, because it is genuinely alarming source
material — live emergency dispatch — being placed on a calm, always-on bedside panel that runs over
the dark navy-to-teal basemap day and night. The whole job of this design is to let a glance say
"a couple of medic calls downtown, one structure fire near Ballard" without the room ever feeling
like a police scanner, and without an incident ever competing with an aircraft for the eye.
Everything below is grounded in the existing render code and obeys the calm vocabulary already
established in `docs/COLOR-PALETTE-DESIGN.md` and `docs/STROBE-INTENSITY-DESIGN.md`. Values were read
directly from source (the bash mount serves stale copies of edited files, so the Read tool is the
authority here).

## The governing principle: incidents are ground events, not contacts

The single most important framing decision is that a 911 incident is **a place on the ground where
something is happening**, not a moving contact the way an aircraft, train, bus or ferry is. That maps
it cleanly onto the layer the codebase already reserves for ground-tier ambient context — the band
below traffic that holds radar precip and marine fog (`RadarLayer.ts`, `MarineLayer.ts`), both drawn
deliberately "under everything alive, so aircraft always paint on top at full brightness." The
Fire/EMS layer belongs in that same subordinate ground tier. It draws after the basemap and the
weather washes but **before** the vessel/car wash, the transit beads, and aircraft, so it can never
sit on top of a live contact. This is the structural guarantee of subordination, and it is enforced
by draw order rather than by hoping the colors stay quiet. A new `internal/config/config.go` toggle
`ShowFireEms bool` (and the optional companion `FireEmsArrivalCue bool`, mirroring `NotableFlash`)
follows the exact `Show...` pattern of `ShowRail` / `ShowBuses` / `ShowFerries`, defaulting on, with
the layer gated `if (!f.cfg.showFireEms) return;` like every other ambient layer.

Critically, this layer must **not** reuse the `NotableLayer` machinery. NotableLayer is about
flagged *aircraft* — it draws a breathing color glow on a target, a stylised emblem above it, and,
for a true `emergency` squawk only, a breathing screen-edge border that is "the alert" because the Pi
has no speaker. A ground 911 incident must never trigger that edge border, never borrow the medical
`[214,30,30]` / emergency `[235,70,58]` reds, and never get an emblem floating above it the way a
flagged plane does. It is its own restrained family. The reason to keep them separate is semantic:
the red edge border means "an emergency aircraft is overhead right now, look up"; a routine aid call
six miles away is the opposite of that, and must read as quiet ambient civic texture.

## 1. Marker design

An incident is a small **soft-edged ground disc with a thin ring and a faint dark keyline**, sitting
at the incident lat/long — deliberately *not* a glyph, not a vehicle chip, not a bead, not a target
bracket. It reads as "a spot on the map," which is exactly what it is. Concretely, per incident:

- A soft radial-gradient pool ~7-9 px radius (severity-scaled, below) in the category hue, drawn
  `source-over` at low alpha — **never** `globalCompositeOperation = "lighter"`. Additive glow is
  reserved for aircraft (the bus/ferry/rail layers all carry the "no additive glow — aircraft-only"
  rule and this layer must too). A `source-over` pool over the dark basemap is calm; an additive one
  would bloom and shout.
- A thin 1 px ring at the disc edge at moderate alpha, so the spot has a crisp locus without a bright
  core. This is the inverse of the transit grammar: ferries/buses/trains carry a *bright near-white
  core* that says "a live thing is here and it is the brightest point"; an incident deliberately has
  **no near-white core** — its energy is in a dim ring, not a hot center, so it never out-reads a
  vehicle.
- A 1 px dark keyline `rgba(8,14,22,0.5)` just inside the ring — the same trick `FerryLayer`'s hull
  and the ground-aircraft marker use to separate a mark from the teal water by an edge rather than by
  hue alone. This makes incidents survive the bright foreground part of the satellite grade and all
  CVD types.

Fire vs medical/aid vs vehicle read apart **by hue within one restrained, low-chroma family**, plus a
tiny optional inner mark (below) for the day-legibility case. The family is intentionally pulled into
muted, slightly-desaturated tones so the whole layer reads as one civic stratum, not five loud pins.
Recommended RGB values, chosen to fit `colors.ts` and to be clear of every existing semantic hue
(home gold `[255,200,70]`, notable/emergency reds `[214,30,30]`/`[235,70,58]`, congestion ramp's
amber-to-magenta `[235,150,60]`→`[236,70,120]`, aircraft altitude warm band, bus violet `[150,130,235]`,
ferry steel-cyan `[150,205,242]`, rail jade `[40,225,170]`):

- **Fire (major)** — a muted ember orange-red `[214,108,72]`. Warm = alert (the house axis), but
  deliberately *earthier and darker* than both the congestion ramp's hot orange `[236,118,70]` and
  the notable fire flame `[255,138,38]`, so a structure fire never reads as a jammed freeway or a
  fire-tanker aircraft. This is the only category allowed any extra presence (§4).
- **Medical / Aid** — a soft clinical teal-violet `[150,140,180]`, a quiet desaturated mauve-grey. It
  must NOT be red: a red cross on a bedside map is exactly the police-scanner feeling we are avoiding,
  and the notable layer already owns medical red for aircraft. A low-chroma cool-neutral reads as
  "minor, routine, calm" and sits clear of the bus periwinkle (more saturated, bluer) and the slate
  congestion "clear" `[110,128,145]`.
- **Vehicle (MVI / collision)** — a muted amber-tan `[198,156,96]`, earthy and dim. Distinct from the
  5k-ft aircraft amber `[232,176,82]` (brighter) and the home gold (brighter, additive, fixed point).
- **Alarm / Other** — the dimmest, a cool grey-blue `[128,142,158]`, essentially the congestion
  "clear" slate lifted slightly. Auto fire alarms and unclassified calls recede almost into the
  basemap; they are present-if-you-look, invisible at a glance.

A tiny **inner mark** (~5 px, drawn in the same hue at higher alpha, no white) may sit inside the
disc to help day legibility and CVD redundancy: a stubby flame notch for fire, a thin plus for
medical, a slash for vehicle, none for alarm. These follow the spirit of NotableLayer's emblems
(shape carries meaning so color is reinforcement, the CVD-correct pattern the palette doc praises)
but are smaller, hueless-white-free, and sit *inside* the disc rather than floating above a target.

## 2. Calm behavior — arrival, persistence, expiry

A new incident gets exactly one gentle **arrival cue**, and it is the calmest possible: a single
slow expanding ring that eases out from the incident point over ~1.2 s and fades to nothing — one
ripple, once, like a raindrop on still water. It is a **one-time** animation tied to the incident's
first-seen timestamp, not a repeating pulse, and it is `source-over`, not additive. This is firmly
inside the calm rules: it is a brightness/scale ease that happens once, not a strobe, not a flash, and
since it occurs a single time per incident it is trivially under the WCAG/Harding 3-flashes-per-second
cap (the same cap the strobe doc enforces). The arrival cue is also suppressed entirely during the
night/mute window using the **exact `muted()` predicate** NotableLayer already uses (lights-out
schedule via `isLightsOut`, or `muteUntil` while the sun is down) — at 2 a.m. an incident simply
appears at its resting dimness with no motion at all, so it can never wake or startle anyone. The cue
is also gated by the optional `FireEmsArrivalCue` config flag for users who want the layer fully
static.

Persistence: once arrived, an incident sits at a **steady** resting appearance. If it animates at all
it is only a very slow brightness *breath* (the house idiom — "brightness breath not size pulse"),
on the order of the 0.2 Hz / ~8 s breaths used by the home beacon and the notable edge border, and
only for the single most-severe active fire; everything else is dead steady. No size pulsing, no
color cycling, no blinking — the marker's job between arrival and expiry is to be quiet.

Auto-expiry: the feed gives no clear-time, so each incident gets a fixed client-side **lifetime of 45
minutes** from its datetime (a sensible middle of the 30-60 min range — long enough that a glance over
dinner still shows the evening's activity, short enough that the map doesn't accumulate a day's worth
of stale dots). The visual lifetime has three phases on a smoothstep fade so nothing ever pops out:
full resting alpha for the first ~30 min, then a gentle linear-to-smoothstep fade of both the disc
fill and the ring over the final ~15 min, reaching zero at 45 min, at which point the incident is
dropped from the set. A `t²(3−2t)` smoothstep on the tail (the same easing the strobe doc recommends
for the flash envelope) means the dot dissolves rather than blinks off. Age also subtly dims the
resting alpha across the whole lifetime so a fresh call is marginally more present than a 40-minute-old
one — recency reads as faint brightness, never as motion.

## 3. Density

A busy Seattle evening can post many simultaneous calls, the great majority of them routine "Aid
Response" / "Medic Response." Left raw this would pepper the map and break the calm, the same failure
mode the strobe doc names for aircraft and the bus layer pre-empts with its `CAP = 70`. Three
mechanisms keep it calm:

- A hard **cap of ~24 visible incidents** (`CAP` constant, mirroring `BusLayer`). When more are
  active, keep the highest-scoring ones and drop the rest silently.
- A **priority score** for ranking against the cap, combining severity (§4), recency, and proximity
  to home, in that weight order — exactly the "nearest-home wins" logic `BusLayer` already uses for
  its cap, extended with severity and age. A major fire two miles away always survives the cap; a
  20-minute-old auto-alarm across town is the first to go.
- **Severity-graded dimming so minor calls recede.** This is the most important calm lever. Aid/Medic
  responses — the bulk of the feed — draw at the lowest resting alpha (~0.30-0.40) in the muted
  mauve-grey, so a cluster of them reads as a soft haze of civic activity, not a constellation of
  pins. Only genuine major incidents (§4) get more alpha. The result is that the *texture* of the
  city's night is glanceable (busy vs quiet downtown) while no individual routine call demands
  attention. A `zoomMul` term like `BusLayer`'s further dims the whole layer when zoomed way out so
  "the whole county" never becomes a swarm.

## 4. Severity encoding

The `type` strings map to four categories via prefix/keyword matching on the uppercased type, in the
spirit of `notable.ts`'s `classifyNotable` (ordered checks, first match wins). Suggested mapping
(`classifyIncident(type) -> IncidentCat`):

- **major** (fire `[214,108,72]`) — `type` contains "FIRE IN", "BUILDING", "STRUCTURE", "RESCUE",
  "MVI" with injuries/extrication keywords, "EXPLOSION", "HAZMAT", "AIRCRAFT". These are the only
  incidents granted any extra presence: a slightly larger disc (~9 px vs ~7), a marginally brighter
  ring, and — for the single most-severe active one only — the optional slow brightness breath. They
  still draw under traffic and still get no edge border.
- **medical** (mauve-grey `[150,140,180]`) — "AID RESPONSE", "MEDIC RESPONSE", "MEDIC", "AID", "MVI"
  without injury keywords. Lowest resting alpha; the recede-by-default majority.
- **vehicle** (amber-tan `[198,156,96]`) — "MVI", "MOTOR VEHICLE", "CAR", "COLLISION" (when not
  injury-major). Mid alpha.
- **alarm / other** (grey-blue `[128,142,158]`) — "ALARM", "AUTO FIRE ALARM", "INVESTIGATE", and any
  unmatched type. Dimmest; near-basemap.

"Subordinate by default, only genuine major incidents get slightly more presence" is the whole rule:
the delta between a structure fire and an aid call is a couple of pixels and ~0.3 of alpha, never a
color-temperature jump to alarm-red and never an animation. Severity is *presence*, not *alarm*.

## 5. Tap card

Tapping an incident opens a compact detail card built in the exact mold of `TransitCard`
(`Display.tsx`), placed **bottom-left** to share the transit corner — `position: absolute, left: 16,
bottom: 160` is already taken by the open TransitCard, so the incident card uses the same family
(`background: rgba(8,12,20,0.92)`, `1px rgba(255,255,255,0.08)` border, `borderRadius: 12`, text
`#dfe7f2`, the colored 10 px dot + bold 16 px title + 11 px muted sub line grammar). Because only one
ground/transit element can be selected at a time, it occupies the same `left:16, bottom:160` slot as
TransitCard. This keeps the aircraft `TapCard` (top-right) as the privileged primary-subject card and
puts all "ground context" cards in the lower-left, a clean spatial hierarchy. The card shows:

- the colored category dot + the incident `type` as the title (e.g. "Fire in Building"),
- a sub line with the address,
- a `detail` line with relative time built like `TransitCard`'s `delayText` helper — "3 min ago",
  "just now", "28 min ago" — so the freshness is explicit text, never an animation.

The card must NOT show the `incident_number` prominently (it reads as a case file / scanner detail);
keep it out, or relegate it to the smallest muted line. Selection is plumbed exactly like
`selectedFerryId` (a `selectedIncidentId` on the renderer, set on tap, cleared on close), and the DOM
card open suppresses any canvas overhead placard via the existing `setCardOpen` path. No selection
ring or bracket is drawn on the incident itself (the house rule: brackets mean UI selection of a
*contact*; a faint brighten of the tapped disc is enough).

## 6. Night and subordination

The layer dims with the room through the shared night factor exactly as the palette doc prescribes for
all foreground presence. Because the incident markers have **no near-white cores**, they are inherently
quieter than transit at night, but they still scale: multiply the disc, ring, and inner-mark alphas by
`night.ts`'s `coreDim()` (`0.7 + 0.3*(1 − nf)`), so incidents settle into the dark basemap overnight
along with the transit cores and the aircraft lights. The arrival cue and the optional major-fire
breath are additionally fully suppressed in the muted window via NotableLayer's `muted()` predicate,
so the bedside hours are motion-free.

Subordination is guaranteed three ways at once and stated here so it stays auditable: (a) **draw
order** — the layer paints in the ground tier under the vessel/car wash, transit, and aircraft, so a
plane always paints on top at full brightness, the same contract `RadarLayer` documents; (b) **no
additive blending and no near-white cores** — the brightest pixel on the panel is always an aircraft
light or a transit core, never an incident; (c) **alpha ceiling** — even a major fire's resting alpha
(~0.6 day, less at night) sits below the transit beads and far below aircraft, preserving the product's
brightness law (aircraft brightest, then vessels/trains, then ground context/weather). An incident can
inform a glance; it can never win the eye away from the sky, which is the entire point of SkyView.

## Summary of recommended constants

For the eventual implementation, the auditable knobs (named constants in the new `FireEmsLayer.ts`):
`CAP = 24`, `LIFETIME_MIN = 45`, `FADE_START_MIN = 30`, `ARRIVAL_CUE_S = 1.2`, `BREATH_HZ ≈ 0.13`,
disc radii `7`/`9` px, keyline `rgba(8,14,22,0.5)`, and the four category RGBs above
(`[214,108,72]` fire, `[150,140,180]` medical, `[198,156,96]` vehicle, `[128,142,158]` alarm). Config:
`ShowFireEms` (default true) and `FireEmsArrivalCue` (default true) in `internal/config/config.go`,
following the `Show...` pattern.
