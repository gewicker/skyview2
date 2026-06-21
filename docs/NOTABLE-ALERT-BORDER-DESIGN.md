# Notable-Aircraft Alert Borders — Design Consult

> Consult requested by George (2026-06-21): when a *notable* aircraft "comes across" (enters
> range) he wants a **themed border alert**. His reference for the military case is a
> certificate/stationery frame — a wide **camouflage** border (mottled olive / dark-green /
> tan-khaki) with a thin **gold/bronze keyline** just inside it, framing a blank cream/parchment
> center panel. He wants that themed-border ALERT FORMAT adopted for military, and the *same*
> format adapted with a distinct theme for every other specialty craft we alert on.
>
> No code was modified. Every value below is grounded in current source (`notable.ts`,
> `NotableLayer.ts`, `SpotlightLayer.ts`, and the existing color / strobe / v6 design docs); the
> bash mount serves stale copies of edited files, so the Read tool was authoritative.

---

## Verdict

**Adopt the certificate-frame *intent*, not its literal artwork.** A wide mottled camo border with
a gold keyline and a parchment panel is a beautiful idea on stationery, and a hostile one on an
**always-on bedside panel over a dark calm satellite map**. Pasted camo clip-art would be a bright,
busy, opaque rectangle that (a) fights the entire dark-vector idiom, (b) is a burn-in liability
sitting persistently around the frame, and (c) breaks the load-bearing house rule already written
into `notable.ts` lines 20–22 and honored throughout `NotableLayer.ts`: *only a true EMERGENCY earns
the screen-edge border — "this lives by a bed; routine military/medical/police traffic must not
strobe the frame."* A military C-17 transiting north of Boeing Field is routine traffic, not an
emergency.

So translate the **intent** — *a category-themed decorative border + a thin metallic keyline + a
content panel carrying the aircraft's identity* — into SkyView's clean dark-vector language, and
deliver it as a **transient ACQUISITION alert**, not a persistent frame:

1. **The alert is a framed ACQUISITION CARD that eases in once, holds briefly, then settles.** When
   a notable craft crosses into range it gets a one-time announcement: a compact framed identity
   card (the "certificate") slides/fades in at a fixed corner, themed per category — a **vector
   border treatment** (the camo-analogue), a **thin metallic keyline**, and a **dark content panel**
   (the dark-UI analogue of the cream parchment) carrying callsign / type / category / distance. It
   holds ~6 s, then **eases out**, handing off to the *existing* persistent on-target language — the
   emblem + colour-glow designator (`NotableLayer.designator`) and, if featured, the gimbal reticle.
   The "certificate" is the *arrival ceremony*; the calm on-target emblem is the *steady state*.

2. **A brief themed EDGE-FRAME breath accompanies the card, but only as an ease-in flourish — and
   for emergency only does it persist.** The full screen-edge frame remains reserved for EMERGENCY
   (the existing `border: true` / breathing edge in `NotableLayer.edgeBorder`). Every other category
   may *ease a faint themed edge-frame in and back out once* over ~2.5 s as the card arrives (a
   one-shot "the room acknowledges you"), then leave the frame clean. Routine categories never hold
   a lit frame and never strobe it — the bedside rule is preserved by construction.

This gives George his themed-border family (a coherent per-category certificate + keyline + panel),
honors the reference's structure, and never turns the bedroom frame into a light show for a passing
medevac.

---

## The family concept: "field certificate" in dark vector

Every category gets the same three structural parts, themed by its existing `CatStyle.color`. The
camo reference decomposes cleanly into these three roles, and each maps to a dark-vector treatment:

| Reference part | Role | Dark-vector translation |
|---|---|---|
| Wide mottled **camo border** | category identity, decorative | a ~14 px **themed border band** — a low-alpha vector *motif* in the category hue (not photo texture): hatching, mottle-noise dots, scale-pattern, etc., drawn at 8–16% alpha over the dark panel edge |
| Thin **gold/bronze keyline** | the "official seal" detail | a 1 px **metallic keyline** just inside the band — a subtle vertical gradient stroke (a brighter top edge, dimmer bottom) so it reads as a struck-metal rule, not a flat line. Gold/bronze for military/heavy/rare; the *category hue brightened* for the service trades (see table) |
| Cream **parchment panel** | the content surface | the **dark content panel** `rgba(8,12,18,0.82)` (same fill the spotlight placard already uses, `SpotlightLayer.drawPlacard`) — the dark-UI inversion of parchment: the page is dark, the ink (type) is light |

The **border band is the only category-variable decorative element** — that is what carries "this is
a *military* certificate vs. a *medical* one" at a glance, exactly as the camo does on the
reference. Everything else (panel fill, type ramp, corner radius, drop) stays constant so the family
reads as one system. Think regimental stationery: same paper, same layout, **different border
device** per corps.

### Where it lives

- **Card position:** a fixed corner, chosen to *not* collide with the existing furniture. The
  spotlight CPA placard owns **top-right** (`SpotlightLayer.drawPlacard`, `x = f.w - w - 18, y =
  18`); the aircraft tap-card is top-right (DOM); the transit tap-card is bottom-left. **Put the
  acquisition card top-left** — the one quiet corner — and suppress it while a DOM card is open
  (reuse the existing `f.cardOpen` guard that already makes the placard yield).
- **Size:** compact, ~300×96 px. Big enough for callsign + type + one identity line; small enough to
  be a discreet announcement, not a takeover. Burn-in-safe because it is transient (see guardrails).

---

## Per-category spec

Colours are the existing `NOTABLE_STYLE[cat].color` (read from `notable.ts`). The **border motif**
is the per-category decorative device; the **keyline** is the metallic rule inside it; **panel** is
constant; **type** is the title-line treatment. All alphas are *day* values — every one is scaled by
the night factor (see guardrails).

| Cat | Hue (RGB) | Border motif (the "camo" analogue) | Keyline | Edge-frame on arrival | Notes |
|---|---|---|---|---|---|
| **military** | olive `124,140,80` | **vector camo:** 3-tone mottle of soft blobs in olive `124,140,80`, deep-green `70,86,52`, khaki `150,150,108`, each at 10–14% alpha, organic (Worley/blob noise), clipped to the 14 px band. Reads unmistakably as camouflage **without** a single pixel of photo texture. | **bronze** `176,141,87`, 1 px metallic gradient stroke | faint olive frame eases in→out once, ~2.5 s, peak 0.18α | The headline case. Chevron emblem (`NotableLayer`) stays as the on-target steady mark. |
| **medical** | white `236,238,242` | **clean cross-field:** a sparse grid of faint red `214,30,30` crosses at 8% alpha on the white-tinted band — clinical, sterile, "field hospital" stationery. White band, red device. | **white** `236,238,242`, 1 px, slightly brighter top | faint white frame, peak 0.16α | Cross emblem steady-state. Keep red as the *device*, white as the *field* — never a red flood (calm rule). |
| **fire** | amber `255,138,38` | **ember hatch:** diagonal hatching that thins top→bottom in amber→deep-orange `198,84,30`, with a few brighter ember flecks `255,200,120` at 12% — embers rising, not flames licking. | **amber** `255,170,90`, 1 px | faint amber frame, peak 0.18α | Flame emblem steady-state. No flicker on the band (calm); embers are static, the *card entrance* animates. |
| **police** | blue `70,132,255` | **duty stripe:** a recessed band of blue/black "barred" segments (think a subdued patrol-stripe), 10% alpha, plus a faint single white star `255,255,255` watermark in one corner. | **steel** `150,180,255`, 1 px | faint blue frame, peak 0.16α | Shield emblem steady-state. Keep blue lighter than the basemap's blue wedge so it never camouflages (see color doc). |
| **emergency** | red `235,70,58` | **alert chevrons:** a hazard-chevron border (alternating red `235,70,58` / dark, 45° chevrons) at 14% — the only category whose border device implies *urgency* rather than *identity*. | **red** `235,90,78`, 1.2 px (slightly heavier) | **PERSISTENT** breathing edge frame (existing behavior) | The *only* category that keeps a lit frame: the existing `edgeBorder` ~0.2 Hz breath in `NotableLayer.ts`, fully suppressed in the night/mute window (`this.muted(f)`). The card is the *acquisition*; the frame is the *ongoing* alert. |
| **heavy** | pale blue `120,180,255` | **fuselage rule:** a minimal double-rule border (two thin parallel lines) with faint window-dot ticks — restrained, "wide-body manifest," no busy fill. Heavy is *notable-by-size*, not *by-service*; its border is the quietest. | **pale-steel** `170,205,255`, 0.8 px | faint frame, peak 0.12α (lowest) | No emblem today (`emblem: "none"`) — the card *is* heavy's only flourish; keep it understated. |
| **rare** | violet `185,150,255` | **collector's seal:** a fine guilloché/engraving motif (thin interlocking arcs, banknote-style) in violet `185,150,255` at 9% — "this is a rare specimen" certificate energy, the most ornate border in the family. | **bronze** `176,141,87` (warm metal pairs beautifully with violet) | faint violet frame, peak 0.16α | No emblem today; like heavy, the card carries it. Violet is the system's lone non-warm/cool spoke (see color doc) — keep it clear of the rail jade / aircraft cyan, which it already is. |

**Metallic keyline construction (shared).** Don't draw a flat line. Build the "struck metal" read
with a 1 px stroke whose colour is a short vertical `createLinearGradient` over the card height:
brighter at the top stop, ~60% at the bottom, of the keyline RGB. That single gradient is the whole
"gold/bronze foil" effect translated to vector — cheap, calm, and unmistakably a *seal* rather than
a UI divider. Reserve true **gold** (`255,200,70`, the home-beacon colour) — per `notable.ts` line
30, gold is the HOME colour and must not be reused; that is exactly why military/heavy/rare use
**bronze** `176,141,87` (a distinct warm metal) instead.

**Type / panel (shared, constant across the family).**
- Panel fill `rgba(8,12,18,0.82)`, 8 px corner radius (matches `SpotlightLayer` placard).
- Title line (callsign): `600 13px system-ui`, near-white `rgba(238,243,250,0.98)`.
- Category label: the `CatStyle.label` ("MILITARY", "MEDICAL", …) in the **category hue** at 0.92α,
  `600 10px` — the one place the hue appears as text, tying the band to the word.
- Sub line: type + distance, `12px`, `rgba(196,205,219,0.85)` — same secondary ink as the placard.
- The whole card carries the existing soft drop the placard implies; no hard outer shadow.

---

## Trigger + lifecycle

**Trigger.** The card fires on the **range-enter transition** of a notable aircraft — the first
frame `classifyNotable(a)` returns a category for a hex that did **not** have one last frame (a new
notable, or a known aircraft that just got reclassified, e.g. squawked 7700). This is a *new
arrival*, which is precisely what "comes across" means. It does **not** re-fire while the craft
loiters in range, and it does **not** fire for a craft that was already notable before it entered
the spotlight (debounce on hex, not on screen position).

**Lifecycle (per arrival):**

| Phase | Duration | Behavior |
|---|---|---|
| **ease-in** | ~0.6 s | card slides up ~12 px + fades 0→1 with a smoothstep (`t²(3−2t)`), the house easing already used in `pulseEnv`. The themed **edge-frame** breathes in over the same window. |
| **hold** | ~6 s (`HOLD_MS`, matching the spotlight hold) | card fully present, static. No animation on the band (calm). |
| **settle** | ~0.8 s | card eases out (fade + slight downward drift); the edge-frame eases back to 0 (except emergency, which *stays* on its breathing frame). On-target emblem + designator glow are already running underneath and simply remain. |

Total ~7.4 s of announcement, then the craft lives as a calm emblem + glow until it leaves range —
identical to today's steady state. The "certificate" is a *greeting*, not a *fixture*.

**Priority when several are present.** Reuse the existing `CatStyle.priority` (emergency 6 → heavy/
rare 1). **One acquisition card at a time** — if two notables enter within the same hold window,
show the higher-priority one's card and queue the lower (or, if the lower already arrived, let it
finish; the higher one's card *replaces* it with a quick cross-fade and its frame takes the edge).
This mirrors the existing edge-border logic in `NotableLayer.draw` (lines 36, 42–46), which already
picks the single highest-priority category for the frame — extend that same `topPri` selection to
own the acquisition card. Never stack two framed cards; the corner holds one certificate.

**Interaction with tap card / spotlight placard.**
- The acquisition card lives **top-left**; the spotlight CPA placard lives **top-right**; they don't
  collide. Both yield to an open DOM card via the existing `f.cardOpen` guard.
- If the user **taps** the notable while its card is up, the acquisition card eases out early
  (its job is done — the user is now driving) and the rich DOM tap-card + gimbal reticle take over.
- The acquisition card is **read-only ambient** — it is not tappable furniture; it announces and
  retires. The *persistent* details remain the spotlight placard and the tap card, unchanged.

---

## Calm / night / burn-in guardrails

This is an always-on panel, often bedside or ceiling. The whole point of the transient-card design
is that nothing decorative persists — but the guardrails must be explicit so a future edit doesn't
quietly turn the certificate into a fixture.

- **Night dimming (mandatory).** Every alpha in the spec is a *day* value. Multiply all card +
  frame alphas by the same night factor the rest of the system uses (`nf`, via the `coreDim()` /
  brightness-law machinery the color/strobe docs describe). At full night the certificate is a
  quiet, dim card, not a lit billboard.
- **Mute / lights-out window (mandatory).** Honor `NotableLayer.muted(f)` (lights-out schedule or
  manual mute, sun-below-horizon). In the mute window, **suppress the edge-frame entirely** for
  *every* category including emergency (the existing edge-border is already suppressed there — match
  it), and drop the acquisition card to its calmest form: a small, low-alpha, **static** badge with
  no ease-in motion and no frame breath. A medevac crossing at 3 a.m. must not animate the bedroom
  wall.
- **Burn-in (mandatory for anything that could persist).** The card is transient, so it is
  burn-in-safe by construction *as long as it always retires* — enforce the settle phase; never let
  a card with no further input "stick." The **emergency persistent frame** is the one element that
  can sit lit for a long event; it is already handled by the existing breathing edge (a moving alpha
  envelope, not a static lit rectangle) and is suppressed at night. Do **not** add any *static*
  always-on frame for any category. If a notable loiters for an extended period, the only persistent
  mark is the existing on-target emblem + glow, which **moves with the aircraft** across the panel —
  inherently burn-in-safe (it never paints the same pixels twice).
- **Motion budget.** The only animation is the one-shot ease-in/settle (under 1 s each) and the
  existing ~0.2 Hz emblem/frame breath. **No animation on the border motif itself** — the camo
  mottle, ember hatch, guilloché, etc. are *static* vector fills. The reference is stationery; keep
  it still. This also keeps the per-frame cost near-zero (the band can be rendered once to an
  offscreen canvas per category and blitted, like the cached glyph sprites in `glyphCache.ts`).

---

## What to avoid

- **Don't strobe or persistently light the frame for routine categories.** The bedside rule
  (`notable.ts` 20–22) is the product's spine. Only **emergency** keeps a lit (breathing) frame, and
  only outside the mute window. Everything else gets a *one-shot* ease-in flourish and then a clean
  frame.
- **Don't paste camo (or any photo) clip-art.** The camo, embers, stripes, guilloché are all
  **low-alpha vector motifs** in the category hue, drawn over the dark panel. A bright opaque
  rectangle of jungle camo on a dark satellite map would be the single most off-key element in the
  product.
- **Don't use real insignia / agency logos.** The whole notable system deliberately uses generic
  symbols (cross, flame, shield, chevron — `notable.ts` 1–5) for legal cleanliness and visual
  consistency. The border devices must stay equally generic: a *camo pattern*, not a unit patch; a
  *duty stripe*, not a department badge; a *medical cross-field*, not a hospital's mark.
- **Don't reuse HOME gold.** `255,200,70` (and the gimbal gold `255,184,92`) are SkyView's attention
  gold, reserved for HOME and selection (`notable.ts` 30, color doc). The metallic keyline uses
  **bronze** `176,141,87` for the warm-metal categories so it never collides with the home beacon.
- **Don't break the brightness law or the night machinery.** Card + frame alphas scale with `nf`
  and obey the mute window exactly like every other layer; at night the certificate is dim, still,
  and (in the mute window) frameless. The aircraft lights remain the brightest things on the panel
  (color doc) — the card never out-glows them.
- **Don't make it a second persistent placard.** It announces and retires. The steady state after
  the card is exactly today's calm emblem + glow (+ gimbal if featured) — no new permanent furniture
  on an always-on screen.

---

## One-paragraph build sketch (non-binding)

A `NotableAlertLayer` (or an extension of `NotableLayer`) tracks the set of notable hexes seen last
frame; on a new entry it pushes an acquisition event `{hex, cat, t0}`. Each frame it renders at most
one event (highest `priority`), computing an ease-in/hold/settle envelope from `f.t - t0` with the
existing `pulseEnv`/smoothstep, and draws the themed card top-left + a one-shot edge-frame — both
alpha-scaled by `nf` and gated by `muted(f)`. Per-category border bands are pre-rendered once to
offscreen canvases (cached by cat) and blitted, so the only per-frame work is the envelope math, a
panel fill, the gradient keyline stroke, and three text lines — trivially cheap. Emergency keeps its
existing persistent breathing `edgeBorder`; every other category's frame returns to 0 after settle.
The card yields to `f.cardOpen` and to a manual tap, exactly as the spotlight placard already does.
This reuses the codebase's own vocabulary end-to-end — `CatStyle`, `priority`, the dark placard
fill, the house smoothstep/breath, the `nf` night scaling, the `muted` window, and the cached-sprite
pattern — and adds George's themed-certificate greeting without disturbing the calm the product is
built around.
