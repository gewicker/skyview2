# SkyView 2 — v6 Data-Art Plan (calm-first)

> **What this is.** A *planning* document (no code) curating which generative / data-visualization
> moves genuinely deepen SkyView's beauty and meaning without adding noise, distraction, or burn-in
> risk on an always-on 1280×800 bedside/wall panel. It judges every previously-floated idea
> (V4-PLAN Batch 7: **C** ghost-trail, **E** headway breathing, **F** system vitality, **G**
> bidirectional ribbons, **H** bus pollen; plus the **ferry/vessel photo card**), proposes a small
> set of **novel** calm moves, separates **safe wins** from **ambitious**, and explicitly flags what
> would violate the calm / brightness-law / burn-in rules and must be avoided.
>
> Every claim below is grounded in source read with the Read tool (the bash mount serves stale copies
> of edited files — not authoritative). Cited files/symbols are real and current.

---

## The non-negotiable rules every move must pass

These are the laws the existing system already enforces; any new art that breaks one is rejected on
sight, no matter how pretty.

1. **Brightness law (cross-layer).** A plane is the brightest, most pre-attentive thing on the panel;
   vessels/trains a clear rung below; ground context (congestion, incidents, weather) below that.
   Enforced today by draw order (`Display.tsx`), by reserving additive `lighter` + the white
   double-strobe for aircraft only (every transit/ground layer uses `source-over`), and by
   `night.ts → coreDim()` (`0.45 + 0.55*(1−nf)`) pulling the transit near-white cores below a
   night-bloomed aircraft position light. **No new layer may introduce an additive glow, a strobe,
   or a near-white core that out-reads an aircraft.**
2. **One motion vocabulary: brightness *breath*, not size pulse, never a strobe (outside aircraft).**
   The house rhythm is ~0.2 Hz / ~5–8 s (home beacon breath, gimbal `0.82 + 0.18*sin(t*1.9)` in
   `SpotlightLayer.gimbalRing`, notable edge breath, rail station "drop-in-water"). New motion joins
   that family or it doesn't ship.
3. **Burn-in discipline (always-on panel).** No bright pixel may sit at a *fixed screen location*
   doing a *repeating high-contrast pattern*. This is why `RAIL-DIRECTION-DESIGN.md` rejected an
   animated track-flow: the 4,900-vertex ribbon's pixels never move, so animating them is the
   worst-case persistent-pattern stressor. Anything baked to a fixed buffer must stay *static*; only
   things that *move across the screen* (vehicles, trails, the sun-driven wash) may animate brightly.
4. **Night settles with the room.** At night the panel is the brightest object in a dark room; the
   fatiguing elements are near-white cores, not colored bodies. `coreDim()` + the strobe's lower
   night peak already do this. New art must thread `nightF()` and calm down at night, not punch.
5. **Perf budget (Pi paint).** Trails cap at `MAX_TRAILS = 40`, the costly layers skip during a
   gesture (`if (f.interacting) return`), static vector geometry is baked to an offscreen buffer
   (`StaticOverlayLayer`). New per-frame work must respect the cap-and-gesture-gate pattern.

---

## Verdict table (fast read)

| Idea | Verdict | Priority | One-line why |
|---|---|---|---|
| **C — Ghost-trail signature** (per-airframe trail "personality") | **DO, narrowed** | **P1** | Already 80% built in `TrailLayer` flow-crest; the calm win is a *featured-only* persistence ghost, not per-plane flair on all traffic. |
| **E — Headway breathing** (transit cadence as ambient rhythm) | **DO, on the *line*, gentle** | **P1** | Turns schedule into calm meaning; must be a slow brightness breath on the *baked* line, NOT animated dashes (burn-in). |
| **F — System vitality** (one ambient "the city is alive" signal) | **DO, as a single quiet glyph** | **P2** | Beautiful and novel, but easy to make gimmicky; ship it as one small, slow, corner-anchored breath, opt-in. |
| **G — Bidirectional ribbons** (direction-of-travel on rail) | **DON'T (ambient) / DO (on-tap only)** | — | `RAIL-DIRECTION-DESIGN.md` already ruled it out as an ambient line animation (it lies for half the trains + burn-in). The moving trains carry direction. |
| **H — Bus pollen** (drifting motes around active stops/buses) | **DON'T** | — | Decorative motion with no data meaning = noise + distraction; violates "calm." The bus *speed-keyed flow* already shipped and is the real version of this. |
| **Ferry / vessel photo card** (WSF fleet image on tap) | **DO** | **P1** | Pure focus-state payoff, zero ambient cost; mirrors the aircraft photo card that already exists. Blocked only on curated assets. |
| **NOVEL — Featured-plane comet persistence** | **DO** | **P1** | The single highest-beauty calm move; see N1. |
| **NOVEL — Ferry phosphorescent wake settle** | **DO** | **P2** | Marine-true, calm, night-aware; see N2. |
| **NOVEL — Golden-hour "catch the light" featured bloom** | **DO** | **P2** | Leans on machinery already present (`golden`); see N3. |
| **NOVEL — Approach "breath of the field" (KSEA pulse)** | **CONSIDER** | **P2** | Ties the map to the airport-view headline; see N4. |
| **NOVEL — Constellation lines between same-flight trails** | **DON'T** | — | Adds graph clutter, breaks brightness law; see Avoid §. |

---

## Top picks (what to actually build, in order)

### P1 — Safe wins

#### N1 (NOVEL). Featured-plane comet persistence — *the headline calm move*
**What.** The auto-spotlighted / tapped aircraft (the `featuredHex` now plumbed via
`SpotlightLayer.onFeature` → `FrameContext`) earns a slightly **longer, slightly brighter, and
gently *persistent*** comet trail than ambient traffic — a soft luminous ribbon that lingers a beat
longer behind *the one plane you're attending to*, then fades to the normal taper. Everyone else
keeps today's calm flow-crest trail unchanged.

**Exact treatment.**
- In `TrailLayer.draw`, when `a.hex === f.featuredHex || a.hex === f.selectedHex`: lift the trail's
  head-node alpha floor from `0.5 + 0.4*boost` to ~`0.62 + 0.35*boost`, and raise the flow-crest
  contribution (`0.6 + 0.7*crest` → `0.6 + 0.9*crest`) so the crest reads as a brighter travelling
  highlight on that one trail only.
- **Persistence (the soul of it):** extend only the featured trail's effective span by retaining ~30%
  more history points for it (a per-hex small ring buffer the layer already has access to via
  `a.trail`), so the comet tail is visibly longer for the attended plane. No new history for ambient
  planes — keeps the 40-trail budget intact.
- **Geometry/motion:** unchanged grammar (smoothstep taper, `flowRate` speed channel). The only deltas
  are alpha floor + crest gain + length, all on a single trail.

**Color.** Reuse the altitude ramp / climb colors exactly — no new hue. The featured plane is
distinguished by *more of the same light*, not a different color (consistent with the gimbal/strobe
"warmth, not new color" focus language).

**Night.** Multiply the featured lift by `nightF()` so the persistence is a touch *shorter and
dimmer* at night (the room is dark; the plane already blooms). Never let the persistent tail's
brightest segment exceed the aircraft's own position-light bloom — brightness law holds.

**Why it enhances.** It makes the ambient-vs-focus model *legible in the trails*, not just the
reticle. The plane the kiosk is already ringing now also leaves the prettiest streak — the
"signature" the ghost-trail idea (C) was reaching for, but applied to *one* plane so it's a reward,
not swarm flair. This is the calmest possible version of "ghost-trail."

**Perf.** One extra small ring buffer for ≤1 plane; the per-segment work is already capped. The
featured trail is by definition near home (largest on screen) so its extra length is a handful of
segments. Negligible. Honors the `f.interacting` gesture gate (trails already skip).

**Calm guardrail.** Applies to **at most one** aircraft at a time (featured XOR selected). If neither
is set, *nothing changes* — the default sky is exactly today's. Burn-in safe: trails move across the
screen; nothing fixed.

---

#### C (FLOATED) → reframed as N1. Ghost-trail signature — **DO, but only as N1 above**
**Verdict: DO the calm subset (N1), DON'T the literal version.** The literal "ghost-trail" idea —
give *every* airframe a persistent personality streak — fails the brightness/calm test: dozens of
lingering bright tails over the city is exactly the "scanner room" the design docs fight. The flow-crest
speed channel in `TrailLayer` (`flowRate`, the moving highlight band) *already* gives every plane a
living, individual trail — that half shipped and is good. The remaining beauty in the idea is
"persistence on the plane I care about," which is N1. **Ship N1; consider C otherwise closed.**

---

#### E (FLOATED). Headway breathing — **DO, gently, on the line — never as dashes**
**What.** Encode transit *cadence* (how often a train/bus is due — its headway) as a slow ambient
**brightness breath of the route line itself**, so a corridor in its frequent daytime service period
breathes a touch more present than the same corridor in sparse late-night service. The line softly
"inhales" as a vehicle is due and "exhales" between — the schedule made into calm rhythm.

**Exact treatment.**
- **Rail (`RailLayer` / the baked `RailLineLayer`):** do **NOT** animate the baked ribbon's pixels
  (burn-in + the bake is static by design — see Rule 3). Instead apply the breath as a **single
  global alpha multiplier on the *blit* of the static line buffer** when it's composited — the whole
  ribbon dims/lifts together as one field, no per-pixel pattern, no moving edge. Rate: tie the breath
  *phase* to the next-train ETA if known (from `trains.ts` `dayparts` headway shape), else a fixed
  ~8 s house breath. Amplitude tiny: `0.88 + 0.12*breath` on the line alpha. This is legal because a
  uniform field-dim of an already-static buffer creates no *moving high-contrast edge* — it's the same
  class of operation as the atmosphere wash.
- **Bus:** buses have no persistent ambient line (only the on-tap reveal), so headway-breathing for
  buses lives **only** in the already-shipped on-tap `BusRouteLayer` speed-keyed flow — no new ambient
  bus art. (The BUS-ROUTE doc already frames the speed-keyed dash flow as extending "the flow / headway
  breathing data-art thread"; that's the bus chapter, done.)

**Color/night.** No new hue. Multiply amplitude by `coreDim()`/`nightF()` so the breath is barely
perceptible at night (a sleeping city's transit is quiet). At full night, headway-breath amplitude →
near zero.

**Why it enhances.** It's the one move that makes the *transit network itself* feel like a living
circulatory system at a glance, with real schedule meaning — without adding a single moving ornament.
It rewards the long look (you slowly notice the rhythm) which is exactly the right register for an
ambient panel.

**Perf.** One multiplier on an existing blit per frame. Free.

**Calm guardrail.** Amplitude must stay ≤~12% and rate ≥ house breath (≥5 s). If it ever reads as
"flashing," it's wrong — it should be subliminal, the kind of thing you only catch on a long stare.
**Hard rule: it modulates the *blit alpha of a static buffer*, never animates ribbon pixels.**

---

#### Ferry / vessel photo card — **DO (focus-state, zero ambient cost)**
**What.** When a ferry is tapped, show a curated WSF fleet photo of that vessel in its tap card,
exactly mirroring the aircraft photo card the spotlight placard already builds
(`SpotlightLayer.drawPlacard` → `getPhoto(a.hex, a.registration)`, the `photos.ts` cache).

**Exact treatment.** Reuse the existing photo-card layout (240×135 image block, dark tone-down
overlay `rgba(8,12,18,0.35)`, rounded clip, text below). Key the lookup by vessel **name** (WSF
publishes vessel name in the ferry feed) into a curated name→image map (WSF fleet images, hand-curated;
no free photo-by-vessel API — noted in V4-PLAN Batch 8).

**Why it enhances.** It's a pure *focus* payoff — appears only on deliberate tap, never ambient, never
on the kiosk's passive loop. It makes the ferry the equal of the aircraft in the "tell me about this
thing" moment, which today it isn't. Highest function-per-pixel of any move here.

**Perf/night/calm.** Identical envelope to the existing aircraft photo card — already proven calm and
night-correct (the card suspends the night wash via `selectedHex`, see `AtmosphereLayer` line 31).
**Only blocker: curated assets** (a handful of WSF vessel photos), not code.

---

### P2 — Safe-ish wins / polish

#### N2 (NOVEL). Ferry phosphorescent wake "settle"
**What.** Give the ferry wake a faint, slow, **cool-green phosphorescence that lingers and settles**
behind the hull at night — the bioluminescent-wake look real Sound vessels leave — instead of a wake
that simply tracks the hull. Calm, marine-true, and it gives the slowest vehicle on the map a reason
to be looked at.

**Exact treatment.** In the ferry wake draw, at night (`nightF() > 0.4`) add a second, very-low-alpha
(`~0.10*nf`), slightly green-shifted (`[150,210,200]`-ish, *cooler/greener* than the steel hull so it
reads as water-glow not hull) wake segment that *decays over ~4–6 s* rather than tracking instantly —
a settling tail. Source-over (NOT additive — it's water, not a light). By day, amplitude → 0 (you
can't see phosphorescence in daylight; also keeps the day map calm).

**Why.** Night ferries currently just glide; this gives the marine layer a quiet poetry that's
*physically real* and only appears in the dark, calm register. Pairs with the brightness law (it's dim,
source-over, well below aircraft).

**Perf.** A few extra low-alpha segments per ferry, night-only, ferries are few (a handful on the
Sound). Cheap. **Guardrail:** night-only, source-over, ≤0.12 alpha, ferries already capped/slow.

#### N3 (NOVEL). Golden-hour "catch the light" — featured plane only
**What.** During golden hour (`SpotlightLayer.golden`, already computed), the *featured* aircraft's
glow warms and lifts a touch more than ambient — "the prettiest light to catch a plane in," which the
spotlight code comment already gestures at (it auto-features during golden hour even when the spotlight
is off, line 76–78).

**Exact treatment.** Multiply the featured plane's altitude-glow alpha by `1 + 0.18*golden` and lerp
its glow hue a few percent toward the warm gold the gimbal already uses (`RING_GOLD`). Featured-only;
ambient traffic keeps its normal glow. Fades out with `golden` (which fades by ~8° sun altitude).

**Why.** It makes the golden-hour auto-feature *visibly* the magic moment the code already treats it
as — a daily, transient, free reward. Self-limiting (only ~40 min twice a day), never persistent
(no burn-in), one plane only.

**Perf/calm.** One multiplier on one plane during two short daily windows. Trivial. Guardrail: gated by
`golden > 0` (so it literally cannot fire at night) and `featuredHex` (one plane).

#### F (FLOATED). System vitality — **DO as ONE quiet glyph, opt-in**
**What.** A single small ambient indicator that the *system is alive and seeing* — one corner-anchored
glyph whose slow breath rate reflects overall activity (more contacts + transit in motion → a slightly
livelier breath; a dead-quiet 3am sky → a slow, near-still ember).

**Exact treatment.** A small (~10 px) glyph in a non-competing corner (bottom-right is free; spotlight
card is top-right, transit cards bottom-left, winds top-left). House breath rate, amplitude scaled by a
normalized "vitality" scalar = a smoothed function of (aircraft count + moving-transit count + recent
notable events), clamped. NOT a number, NOT a chart — a *breath*. Warm-neutral, low alpha, well below
the brightness law ceiling.

**Why.** It's the most genuinely *generative* idea on the list — the panel acquires a heartbeat. It
answers, pre-attentively, "is this thing live / is the sky busy right now" without any text.

**Risk + guardrail.** This is the easiest idea to make gimmicky. Therefore: **opt-in (config flag,
default off)**, fixed location (so make it *small* and *low-contrast* to respect burn-in — a fixed-spot
breathing pixel is the one place this plan flirts with the burn-in rule, so it must be dim, small, and
ideally drift ±1 px on a very slow cycle to avoid a hard fixed footprint). If it can't be made calm and
burn-in-safe, **cut it** — it's the most optional thing here.

#### N4 (NOVEL, CONSIDER). "Breath of the field" — KSEA presence pulse
**What.** A single, very slow, very faint breath of the KSEA airport-field glow that lifts subtly when
an arrival is on short final to SEA (data we already have: `ApproachLayer` / `arrivalField`). The home
airport "inhales" as traffic arrives — tying the main map to the v6 airport-view headline.

**Verdict: CONSIDER, P2.** Lovely and on-theme, but it's a *fixed-location* brightness change over the
field — burn-in-sensitive. Only ship if amplitude stays tiny (≤8%), rate ≥8 s, and it rides an
*existing* field-glow element (no new fixed-bright geometry). If it needs a new always-on bright mark
at a fixed spot, **don't**.

---

## What to AVOID (these break the rules — do not build)

- **G — Bidirectional ribbons as ambient rail animation. AVOID.** Already adjudicated in
  `RAIL-DIRECTION-DESIGN.md`: (1) Link is bidirectional, so any baked dash-flow/chevron set on the
  track *lies for half the trains*; (2) animating the 4,900-vertex baked ribbon is the worst-case
  burn-in stressor (fixed pixels, repeating pattern). The moving train beads already carry direction
  truthfully. **Permitted only:** an on-tap, per-train, short-slice flow (bus-style), never ambient,
  never on the baked line.
- **H — Bus pollen (drifting decorative motes). AVOID.** Decorative particle motion with *no data
  meaning* is the definition of noise on a calm panel — it adds motion the eye must dismiss. The real,
  *meaningful* version of "bus liveliness" already shipped: the on-tap speed-keyed dash flow in
  `BusRouteLayer` (a bus stuck in traffic visibly crawls — a live congestion read). Pollen would
  compete with that and with the aircraft layer for nothing. **Closed.**
- **Literal ghost-trail on all traffic (full C). AVOID** (see N1) — dozens of persistent bright tails =
  scanner-room. Featured-only persistence (N1) is the calm subset.
- **Constellation / graph lines between related trails (novel, rejected).** Drawing connector lines
  between (say) two legs of the same flight or formation traffic adds a *graph* of bright lines over
  the map — clutter, and the lines would be bright fixed-ish geometry competing with the planes.
  Violates brightness law and calm. **Don't.**
- **Any new additive glow, strobe, or near-white core on a transit/ground layer. AVOID** — these are
  reserved for aircraft by the brightness law (verified: all transit layers use `source-over`).
- **Animated dashes/flow on ANY baked static buffer (rail line, highway flow ribbon). AVOID** — burn-in.
  Headway-breathing (E) is legal *only* as a uniform alpha multiplier on the *blit*, never per-pixel.
- **Raising the `coreDim()` floor or brightening transit cores for "pop." AVOID** — it took two audits
  to get that floor down to `0.45`; the brightness law depends on it.

---

## Sequencing

1. **P1 — Ferry/vessel photo card** (unblock by curating ~10 WSF vessel images; code is a clone of the
   existing aircraft photo card).
2. **P1 — N1 featured-plane comet persistence** (one trail, the headline beauty move; leans on the
   `featuredHex` plumbing already landed in v6).
3. **P1 — E headway breathing on the rail line** (blit-alpha breath only; tiny amplitude; verify on
   the panel it reads as subliminal, not flashing).
4. **P2 — N2 ferry phosphorescent wake**, **N3 golden-hour featured bloom** (both small, both lean on
   existing machinery).
5. **P2 — F system vitality glyph** (opt-in, default off; cut if it can't be made calm + burn-in-safe).
6. **P2 — N4 KSEA field breath** (consider; only if it rides existing field glow at tiny amplitude).

Net: every shipped move is **featured-/focus-scoped or subliminal**, introduces **no new hue**, threads
`nightF()`/`coreDim()` so it settles with the room, and either *moves across the screen* or modulates a
*static buffer's blit alpha* — so nothing new ever paints a fixed bright repeating pattern. The default
ambient sky stays exactly as calm as today; the beauty accrues to the *one plane you're watching*, the
*network's quiet rhythm*, and the *deliberate tap*.
