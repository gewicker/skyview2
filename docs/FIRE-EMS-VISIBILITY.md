# Fire / EMS Incident Visibility — Design Consult

George's note on the shipped Fire/EMS layer: "incidents should be more apparent on the map." This
document is the design answer. It accepts the brief — make incidents clearly glanceable — while
holding the original subordination contract from `FIRE-EMS-DESIGN.md` intact: source-over only (no
additive glow), no near-white core (reserved for aircraft and live transit), drawn under all
traffic, and an alpha/brightness ceiling that keeps the brightest pixel on the panel a plane or a
transit core. Every value below was read from source (the Read tool, not the stale bash mount).

## The diagnosis: the lever you already pulled is the wrong one

The CAT bump you already applied (fill ~0.36–0.72, ring ~0.66–0.98, radii 8–11) is a reasonable
instinct, but it is pushing on alpha, and alpha is not what is making incidents disappear. Look at
what the marker actually *is* right now: a radial gradient that fades to fully transparent at its
own edge, a 1 px dark keyline set *inside* at `rr − 1`, and a single thin 1 px hue ring at
`rr = 0.62·r`. There is no solid mass anywhere in the marker — every pixel is either a fading
gradient or a one-pixel hairline. On the dark teal basemap a gradient-to-transparent pool behaves
exactly like the failure the palette doc names for low-alpha fills over teal: it desaturates toward
the water and reads as a soft smudge rather than a located thing. Cranking the gradient's peak alpha
to 0.72 makes the smudge slightly hotter in the middle; it does not give it an *edge*, and an edge
is what the eye uses to say "that is an object at a point" versus "that is a haze."

Now look at how the things that *are* glanceable on this map earn their presence. A ferry is a
13 px halo at only 0.22 alpha, then a **crisp solid hull polygon at 0.98**, then a **1 px dark
keyline at 0.55**, then a tiny bright core. A live train is an 8 px glow at 0.22, then a **solid
capsule at 0.95**, then a window band. In both cases the presence comes from a *hard-edged solid
mass separated from the water by a dark keyline* — not from alpha on a soft cloud. The palette doc
states this as a law: "legibility on the dark teal basemap comes from contrast/keyline, not just
alpha," and the single highest-value fix it recommends for the at-risk ferry was exactly a dark
contour, not a brighter fill. The Fire/EMS marker is the only ambient mark in the product that has
no solid body and no real keyline, which is precisely why it is the one that vanishes.

So the move is to give the incident marker an *edge and a small solid core of color* — borrowing the
ferry/train presence recipe — while deliberately substituting a **dim hue core** for their bright
near-white core. That keeps incidents clearly located and glanceable yet structurally quieter than
any live contact, because the brightest point of an incident is a muted earth tone, never white.

## What to build: a keylined disc with a solid hue center, not a hollow gradient

Restructure the per-incident mark into four concentric elements drawn in this order, all source-over:

A soft outer **contrast halo** at large radius and low alpha (depth, the ferry's 0.22 halo idea),
gradient to transparent — this stays, it is fine, it is the only soft element. Then a **solid filled
hue disc** at a smaller radius drawn at a real, flat alpha (this is the new mass — the equivalent of
the ferry hull). Then a **bold dark keyline stroked around that solid disc's outer edge** at
1.5 px — not inset at `rr − 1` as today, but right on the disc edge, so the colored mass is bitten
out of the teal water by a dark rim exactly the way the ferry hull is. Then the **hue ring just
outside the keyline** at high alpha to give the rim a colored lip. The inner category mark stays,
drawn on top of the solid disc at full hue alpha so its shape reads against the filled center rather
than floating in a void.

The key structural changes from today: (1) the middle disc is a *flat solid fill*, not a
gradient-to-zero, so it has a hard edge; (2) the keyline becomes 1.5 px and moves to the disc edge
and gets brighter, becoming the primary contrast device; (3) radii shrink slightly because a *solid*
disc reads far larger than a faded one — an 8 px solid disc is more present than today's 11 px
gradient. Smaller-but-solid is more apparent and *less* alarming than big-and-hazy, which directly
serves "more apparent without turning the map into a scanner."

## Exact values to apply

CAT table — keep the hue family (it is well-chosen and clear of every semantic hue), but split fill
into a flat **core** alpha for the new solid disc and keep **ring** for the colored lip, and pull the
radii in. `disc` is the solid-fill radius; `r` (outer halo) becomes `disc + 4`:

    major:   { rgb: "226,120,78",  core: 0.62, ring: 0.95, disc: 8.0, r: 12, sev: 3000 }
    vehicle: { rgb: "212,168,104", core: 0.50, ring: 0.85, disc: 7.0, r: 11, sev: 200  }
    medical: { rgb: "166,154,200", core: 0.42, ring: 0.78, disc: 7.0, r: 11, sev: 20   }
    alarm:   { rgb: "142,156,174", core: 0.32, ring: 0.62, disc: 6.0, r: 10, sev: 5    }

Outer halo: gradient from `rgba(rgb, 0.18·core·a)` at center to `rgba(rgb,0)` at `r` (low — it is
only depth). Solid disc: flat `rgba(rgb, core·a·breath)` filled to `disc`. **Dark keyline (the new
workhorse): `rgba(6,12,20, 0.7·a)` stroked at `lineWidth = 1.5` on the circle of radius `disc`** —
note this is darker (alpha 0.7 vs the old 0.5) and wider (1.5 vs 1.0) than today and sits on the
edge, not inset. Hue lip ring: `rgba(rgb, ring·a·breath)` stroked at `lineWidth = 1` on radius
`disc + 1.5` (just outside the keyline). Inner mark: keep the existing shapes, draw at
`min(0.98, ring·a + 0.12)`, and bump the mark `lineWidth` from 1.2 to 1.4 and the geometry ~20 %
larger so it survives the smaller disc (e.g. medical plus arms ±2.6, vehicle slash ±2.6, flame notch
height ~3.2). The arrival ripple, age fade, severity dimming, cap, and 45-min lifetime all stay
exactly as they are.

The net effect at default day brightness: a routine aid call is a 7 px solid mauve-grey disc with a
clean dark rim — unmistakably a *located spot*, readable across the room, but low-chroma and
coreless so it reads as civic texture; a structure fire is an 8 px solid ember disc with a brighter
lip and a flame notch, clearly the hottest incident on the map. Both are obviously *there* in a way
the current smudges are not, and neither has a bright center.

## Why the eye still goes to planes first

This is the reconciliation that makes "more apparent" safe. The incident now has presence, but the
*kind* of presence is deliberately the lower rung of the brightness law the palette doc enforces.
Three things keep a plane winning the eye: (1) **no near-white core** — the incident's brightest
pixel is a `core·a` muted earth tone (max ~0.62 alpha on a desaturated orange), while every aircraft
light, strobe, and transit deckhouse/window core is a near-white `[238–255,…]` at 0.9–0.99; white at
high alpha is pre-attentively brighter than any saturated mid-tone, so the sky always has the hottest
points. (2) **no additive blend and no motion** — incidents are source-over and static (only the
single worst fire breathes, day only), whereas aircraft strobe and move; motion and bloom both win
attention over a steady disc. (3) **draw order** — incidents still paint in the ground tier under
vessels, transit, and aircraft, so a plane physically composites on top. What changed is only that
an incident now reads as a *firm dot* instead of a *faint cloud*; it climbed from "invisible" to
"clearly the quiet ground layer," not into the contact tier. The dark keyline is the elegant part
here: it adds contrast (apparency) without adding *brightness*, so it makes incidents pop off the
water while spending none of the brightness budget that aircraft own.

## Day vs night

Leave the existing `coreDim()` multiply on the whole-incident alpha (`a` already includes `cm`), so
the solid disc, keyline, ring, and mark all settle with the room overnight — `coreDim()` is
`0.7 + 0.3·(1 − nf)`, so at full night the marker drops to ~0.7 of its day presence, matching how the
transit cores and aircraft lights settle. One refinement: because the dark keyline is a *dark*
element, it does not need to dim as much as the bright elements — at night a dark rim on a dark
basemap is what keeps the now-dimmer disc from dissolving. Apply `coreDim()` to the hue disc, ring,
and mark as today, but hold the keyline at a gentler night floor, e.g. multiply its alpha by
`0.85 + 0.15·(1 − nf)` instead of full `coreDim()`, so overnight the incident becomes a quiet
dark-rimmed dim disc rather than a vanishing haze. The arrival ripple and the major-fire breath
remain fully night-suppressed via the existing `muted` predicate, so the bedside hours stay
motion-free. This keeps incidents glanceable around the clock without ever being the thing that
brightens a dark room.
