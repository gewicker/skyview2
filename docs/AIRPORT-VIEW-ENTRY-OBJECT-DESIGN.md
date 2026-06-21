# Airport-View Entry — In-World Object Design

> **Verdict:** A small **control-tower glyph** — a tower mast + cab + sweeping beacon, drawn as
> a real object on the field at the **KSEA tower position** (NE apron edge, well off all three
> runways) — that appears only at/near **max zoom on KSEA**, on **web/mobile only**. Click → opens
> `/airport`. It **replaces** the floating doorway pill at max zoom (the pill stays as the
> mid-zoom hover/touch affordance; see Coexistence).

This is the planning/memorialization spec for the **v6 fork**. No code here — an implementable
spec. It builds on `docs/AIRPORT-ENTRY-DESIGN.md` (the existing pill) and
`docs/AIRPORT-VIEW-DESIGN.md` (the client-rendered fork the object opens).

---

## Why a control tower (not a pill, badge, or pad)

The tower is the **one structure on a real field that means "the place from which you watch the
airport."** It is literally the vantage the airport view offers (the tower camera is the
establishing shot — `AIRPORT-VIEW-DESIGN.md` §4). So the object isn't a button bolted onto the
field; it *is* the field's own watch-point, and clicking it reads as "go look from here." That's
the on-design win the product owner asked for: a **tangible in-world object** that says *enter the
airport experience*, distinct from the floating glass pill.

Rejected alternatives:
- **"Enter" medallion / badge** — generic chrome with a coordinate; says nothing about *what*. The
  pill already is this. Rejected.
- **Labeled pad / marker pin** — pins read as "a point of interest was tapped" (same grammar as
  navaids/helipads in `HelipadLayer`), inviting confusion with the live tap-card. Rejected.
- **Stylized terminal** — too large a footprint; the terminal sits over the central apron and would
  crowd ground traffic and the `AIRPORT_DIAGRAM` building fills (`k=2`). Rejected.

The tower is small, has an unmistakable silhouette, and naturally lives at the *edge* of the
movement area — exactly where "out of the way" wants it.

---

## Geometry (the glyph)

Pure vector, in the SkyView line idiom (no raster, no asset pipeline — matches
`AirportDiagramLayer`'s stroke/fill vocabulary). Drawn in **screen space** at the projected tower
point, screen-locked size (does not scale with zoom past appearance — it's an affordance, not
geometry):

- **Mast:** a tapered vertical stroke ~18 px tall, 2 px → 1.5 px, hairline.
- **Cab:** a small canted trapezoid (the glass control cab) ~9 px wide at the top of the mast,
  with a thin sill line.
- **Beacon:** a single 1.5 px dot at the cab peak.
- **Base footprint:** an optional 6 px hairline ellipse at the mast foot to seat it on the apron.
- Total footprint ≈ **20 × 22 px** — smaller than the existing pill, deliberately.

**Color:** neutral light-on-dark only — `rgba(232,238,246,0.85)` stroke, same family as the pill
(`AIRPORT-ENTRY-DESIGN.md` §3). **Carries no traffic-palette color**; it is chrome, not data. At
night it dims with the night grade like every other static overlay (subordinate to the runway
light strings `NightLightsLayer` draws).

---

## Placement — the tower position, NE of the field

The owner wants it on/near the field but never over runways or live traffic. The tower position
is the correct anchor and is naturally clear of the movement area.

- **Anchor:** the KSEA ATCT (control tower) lat/lon. **This coord does not exist in the repo yet** —
  `airports.ts` has only runway thresholds, and `AIRPORT-VIEW-DESIGN.md` §8 already lists "tower
  eye-point coords … source and pin in the asset JSON" as an open item. **Pin one FAA-authoritative
  KSEA ATCT coordinate** (≈ `47.4445, -122.3013`, NE of the south cargo/terminal apron — verify
  against FAA airport data at build) and reuse it both for this glyph and the tower camera.
- **Fallback if the tower coord isn't pinned yet:** place at the **34 (north) runway-end apron
  corner** — offset NE of `SEA_C` by a fixed bearing/distance so it sits on apron, never on a
  runway or final. The runway centroid `SEA_C` (Display.tsx:49) is the existing anchor; offset from
  it rather than landing on it.
- **Out-of-the-way guarantee:** the tower/NE-apron point is east of 16L/34R (the east runway) and
  off all three finals, so the glyph never overlaps a runway, a final-approach corridor, or the
  ground-traffic-dense central apron. A live aircraft can only reach the glyph's pixels while
  taxiing the NE ramp — and the **hit-test is the glyph, not a 42 px radius** (see Interaction), so
  it won't swallow taxi traffic taps.

---

## Zoom gate — at/near max zoom only

The glyph is for the *deep* field view, not the mid-zoom approach the pill covers.

- **Gate:** show only when the map is zoomed in **near max on KSEA**. `mapZoom` clamps to **14**
  (`Renderer.ts:135`); the field diagram itself fades in around `SHOW_PXMI = 230` px-per-mile
  (`AirportDiagramLayer.ts:13`). Tie the glyph to **field-diagram visibility**, i.e. appear once
  `pxPerMile ≥ ~SHOW_PXMI + a margin` (full taxiway/apron detail is on screen) **and** the tower
  point is on-screen. A simple `mapZoom` threshold (e.g. `≥ ~8`, distinct from the pill's
  `FIELD_ENTRY_ZOOM = 3`) is an acceptable proxy. The point: it surfaces only when the user has
  pulled all the way in and the field is rendered in full, so the in-world object lands *on a field
  that's actually drawn*.
- **On-screen + inset:** require the projected tower point to be on-screen with a margin (reuse the
  pill's `s.x > 24 … < w-24` inset, Display.tsx:212) so it never clips the edge.
- **KSEA only:** gated to KSEA like the pill — BFI/RNT/PAE show nothing (they have no phase-1 view).

---

## Platform gate — web/mobile only, never the kiosk

Identical to the pill (`AIRPORT-ENTRY-DESIGN.md` §1):

- **`!isKiosk`** (Display.tsx:74). The Pi never renders the airport view, so it never shows the
  entry. The glyph is part of the same non-kiosk overlay branch.
- Works for **both hover and touch** clients — the glyph is zoom-gated, not hover-gated, so it
  doesn't need `canHover`. (Hover just adds the brighten affordance below.)
- **Never affects** tap-to-select, pan, or zoom — purely additive, like the pill. If it broke, the
  map is unchanged (`AIRPORT-ENTRY-DESIGN.md` §1, "non-regressive").

---

## How it reads / animates (calm, invites without shouting)

- **Appear:** fade in over ~250 ms when the gate opens (opacity only — matches the existing
  auto-hide control idiom). No slide, no bounce.
- **Beacon breath:** the single beacon dot does a *very slow* opacity breath (≈ 0.55 → 0.9 over
  ~4 s, like the existing beacon-breath pop move in `skyview-pop-pass`). This is the only motion —
  it reads as "the tower is on / live" and quietly draws the eye without competing with aircraft.
  Honor reduced-motion: hold steady if `prefers-reduced-motion`.
- **Hover (desktop):** stroke brightens to ~`0.95` alpha and a hairline ring seats around the base
  — the press-affordance whisper. Cursor → pointer over the hit area only.
- **Press:** brief scale-down to ~0.94 on `pointerdown`, release on up. Tactile, not loud.
- **Optional label:** on hover/focus only, a tiny `KSEA airport view ↗` caption fades in beside the
  glyph (same glass treatment as the pill). Hidden by default so the object stays a clean
  silhouette — discoverability without persistent text.
- It is **subordinate to everything live**: below the tap-card z-order, above the canvas, no
  traffic-palette color, dims at night. It must never out-shout an aircraft.

---

## Interaction (exact)

1. Gate opens (max zoom + on-screen + KSEA + `!isKiosk`) → glyph fades in at the projected tower
   point.
2. Pointer enters the **glyph hit area** (the ~20×22 px silhouette bounding box, **not** the pill's
   42 px proximity radius) → brighten + pointer cursor.
3. **Click / tap → `window.open("/airport", "_blank", "noopener,noreferrer")`** — opens the
   client-rendered airport view in a **new tab**, leaving this map session untouched (identical to
   the pill, Display.tsx:418). `stopPropagation` so it doesn't fall through to map tap/pan.
4. Keyboard: focusable, Enter/Space activates (the pill is a `<button>`; keep this a button-role
   element for parity and a11y).
5. Gate closes (zoom out, pan off, etc.) → fade out over ~200 ms.

The glyph may be drawn either as a **canvas layer** (a new `AirportEntryLayer`, projecting the
tower point and hit-testing against pointer coords — closest to `AirportDiagramLayer`'s model) or
as a **positioned DOM button** at the projected screen point (closest to the existing pill's
implementation). DOM is simpler for focus/hover/press and z-order; canvas is more "in-world." For
the fork, recommend **DOM button rendered with an inline SVG tower glyph** positioned at
`projectLL(tower)` — it reuses the pill's proven event/positioning path and stays crisp.

---

## Coexistence with the doorway pill — split by zoom (recommended)

Keep **both**, gated to different zoom bands so they never appear together:

| Affordance | Zoom band | Trigger | Reads as |
|---|---|---|---|
| **Glass doorway pill** (existing) | mid zoom — `mapZoom ≥ FIELD_ENTRY_ZOOM (3)` up to the tower gate | hover (desktop) / on-screen+zoomed (touch) | "that place has a deeper view" |
| **Control-tower glyph** (new) | near max zoom — field diagram fully drawn | on-screen at max zoom (both inputs) | "enter the airport from its watch-point, here" |

Rationale: the pill is the discreet *approach* invitation while you're still pulling in (and works
the instant you hover, before full field detail exists); the tower glyph is the *arrived* invitation
once you're deep on the field and an in-world object can sit on actual drawn pavement. **At max
zoom, suppress the pill** (hand off to the glyph) so there's exactly one door at a time and the
in-world object isn't redundant with a floating pill 40 px above it.

If the owner wants only one: **the glyph alone, with its zoom gate dropped to `FIELD_ENTRY_ZOOM`**
so it covers the whole zoomed-in band and the pill is retired. The two-band split is the
recommendation — it keeps the lightweight hover hint for the mid-zoom moment.

---

## What to avoid

- **Don't** place it on a runway, a final-approach corridor, or the central terminal/cargo apron —
  it must never cover live traffic or the runways. NE tower/apron edge only.
- **Don't** give it a 42 px proximity hit radius like the pill — at max zoom that area can hold taxi
  traffic. Hit-test the **glyph silhouette** only.
- **Don't** color it with the traffic palette, make it pulse fast, or animate anything but the slow
  beacon breath. It's chrome; aircraft win every contrast contest.
- **Don't** render it on the kiosk or let it touch tap/pan/zoom. `!isKiosk`, additive overlay.
- **Don't** ship it before the **KSEA ATCT coordinate is pinned** (FAA-authoritative) in the airport
  asset JSON — reuse the same coord the tower camera will use (`AIRPORT-VIEW-DESIGN.md` §8). Until
  then, use the 34-end / NE-apron offset from `SEA_C` as the fallback anchor.
- **Don't** let both the pill and the glyph show simultaneously — suppress the pill at the glyph's
  zoom band.
- **Don't** show it for BFI/RNT/PAE — KSEA only, like the pill.
