# Fire / EMS Incident Icons — Symbol-Led Redesign

George's note on the current Fire/EMS markers: *"the icons are a bit too large; use SYMBOLS to
provide context versus just color."* This document is the design answer. It (1) **shrinks** the
footprint and (2) **promotes the symbol to the primary read** — the colored disc demotes to a small
backing dot so the *shape* tells you what the incident is at a glance and color becomes CVD
reinforcement, not the carrier. Every constraint from `FIRE-EMS-DESIGN.md` and
`FIRE-EMS-VISIBILITY.md` is preserved: source-over only (no additive glow), no near-white core,
drawn under all traffic, `coreDim()` night dimming, the gentle keyline-not-brightness contrast trick,
severity-graded presence (major slightly larger/clearer), and the one-time arrival ripple. All values
read from source via the Read tool (the bash mount serves stale copies).

## The reframe: backing dot + bold symbol, not disc + tiny notch

Today the marker is a *disc with a tiny inner mark* — the disc is the read and the mark is a vestige
(a 5 px notch lost inside an 8 px fill). That is exactly backwards for "symbols over color." The new
marker inverts the hierarchy:

- The **colored disc shrinks to a small backing dot / ring** — just enough hue mass to (a) carry the
  category color for CVD redundancy and (b) give the symbol a dark-keylined backing so it survives the
  teal water. It is no longer the thing you read; it is the *plate* the symbol sits on.
- A **bold category symbol** drawn on top is now the primary mark — a flame, a medical cross, an
  impact mark, a bell — sized and weighted to read across the room, calibrated to NotableLayer's
  ~16 px emblems but drawn smaller and in the restrained earth family (no white, no additive).

This is strictly *smaller overall* than today (outer halo drops from r 10–12 to r 8–10, backing dot
from disc 6–8 to ~4.5–5.5) yet *more legible*, because a hard-edged symbol on a small keylined plate
reads as "a located thing that is X" far better than a big faded disc reads as "a located thing."

## 1. Sizing — smaller footprint

Pull everything in. The backing dot becomes a small plate; the outer halo shrinks with it; the symbol
is the dominant element and extends just past the dot so the shape, not the fill, defines the
silhouette. Recommended overall footprint **~13 px for routine, ~15 px for major** (symbol bounding
box), versus today's ~22–24 px halo diameter.

New CAT table — `dot` replaces `disc` (the small backing radius), `r` (outer halo) becomes `dot + 4`,
`sym` is the symbol scale in px (half-height of the symbol bounding box). Hue family unchanged (it is
well-chosen and clear of every semantic hue):

    const CAT = {
      major:   { rgb: "226,120,78",  core: 0.50, ring: 0.92, dot: 5.5, r: 9.5, sym: 7.0, sev: 3000 }, // ember — the only category granted extra presence
      vehicle: { rgb: "212,168,104", core: 0.42, ring: 0.82, dot: 5.0, r: 9.0, sym: 6.0, sev: 200  }, // amber-tan
      medical: { rgb: "166,154,200", core: 0.38, ring: 0.78, dot: 5.0, r: 9.0, sym: 6.0, sev: 20   }, // mauve-grey (NOT red)
      alarm:   { rgb: "142,156,174", core: 0.30, ring: 0.60, dot: 4.5, r: 8.5, sym: 5.5, sev: 5    }, // grey-blue, dimmest
    };

Notes: `core` drops slightly from today (0.62→0.50 etc.) because the dot is now a *small backing
plate*, not the main mass — it shouldn't compete with its own symbol. `sym` is calibrated so the
symbol overhangs the dot by ~1.5 px, making the shape the silhouette. Major keeps its modest extra
presence: bigger dot (5.5 vs 5.0), bigger symbol (7.0 vs 6.0), brighter ring, and the slow breath.
Everything still sits well below aircraft/transit (near-white cores at 0.9–0.99) and below transit
beads — the brightest pixel of an incident is still a muted earth tone, never white.

## 2. Per-category symbol recipes (drawable canvas paths)

All symbols are drawn centered on `(x, y)` with `s = c.sym` as the scale, after the backing dot and
keyline. Shape is the carrier; hue is reinforcement. Match NotableLayer's craft (quadratic flame,
clean filled cross, simple primitives) but smaller, source-over, and no white. Symbol alpha
`as = min(0.98, c.ring * dim + 0.14)`; a dark under-stroke (described in §3) gives every symbol its
own keyline so it reads on the dot and the water.

### major — FLAME (fill)
A compact teardrop flame, the NotableLayer flame scaled to `s` and grounded a touch lower so it sits
on the dot. Filled, with a faint warmer inner tongue (NOT white — a lifted hue) for a little life.

    // s = 7.0
    ctx.beginPath();
    ctx.moveTo(x, y - s);                                   // tip
    ctx.quadraticCurveTo(x + s*0.78, y - s*0.18, x + s*0.52, y + s*0.5);
    ctx.quadraticCurveTo(x + s*0.40, y + s*0.95, x, y + s*0.95);
    ctx.quadraticCurveTo(x - s*0.40, y + s*0.95, x - s*0.52, y + s*0.40);
    ctx.quadraticCurveTo(x - s*0.52, y, x - s*0.13, y - s*0.36);
    ctx.quadraticCurveTo(x, y, x, y - s);
    ctx.closePath();
    ctx.fillStyle = `rgba(${rgb},${as})`; ctx.fill();
    // inner tongue — a lifted (not white) ember hue, small
    ctx.beginPath(); ctx.arc(x, y + s*0.34, s*0.30, 0, Math.PI*2);
    ctx.fillStyle = `rgba(255,196,128,${(as*0.55).toFixed(3)})`; ctx.fill();

### medical — CROSS / PLUS (fill, rounded)
A bold equal-arm plus, filled (not a 1 px stroke), so it reads at 12 px far better than today's
hairline. Two overlapping rounded rects; arm half-length `s*0.85`, arm half-width `s*0.30`.

    // s = 6.0  -> arm length ±5.1, arm width 3.6 thick
    const al = s*0.85, aw = s*0.30;
    ctx.fillStyle = `rgba(${rgb},${as})`;
    roundRect(ctx, x - aw, y - al, aw*2, al*2, aw*0.6); ctx.fill(); // vertical bar
    roundRect(ctx, x - al, y - aw, al*2, aw*2, aw*0.6); ctx.fill(); // horizontal bar

(`roundRect` is the helper already in NotableLayer.) A plus reads as "medical/aid" universally and is
the single most legible symbol at small size — good for the highest-volume category.

### vehicle — IMPACT / COLLISION ANGLE (stroke)
Not a literal car (too detailed at 12 px). Use a **collision angle-impact mark**: two short bold
strokes meeting at an apex with a small burst tick, reading as "two things hit." This is more
glanceable than a car silhouette and distinct from the medical plus and the flame.

    // s = 6.0  — a bent "impact" chevron with a spark tick
    ctx.lineWidth = 1.8; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = `rgba(${rgb},${as})`;
    ctx.beginPath();
    ctx.moveTo(x - s*0.9, y + s*0.5);   // lower-left arm
    ctx.lineTo(x,         y - s*0.2);   // apex (point of impact)
    ctx.lineTo(x + s*0.9, y + s*0.5);   // lower-right arm
    ctx.stroke();
    // impact spark above the apex — three short rays
    ctx.beginPath();
    ctx.moveTo(x,          y - s*0.45); ctx.lineTo(x,          y - s*0.95);
    ctx.moveTo(x - s*0.4,  y - s*0.45); ctx.lineTo(x - s*0.62, y - s*0.85);
    ctx.moveTo(x + s*0.4,  y - s*0.45); ctx.lineTo(x + s*0.62, y - s*0.85);
    ctx.stroke();

If a vehicle silhouette is later preferred over the abstract impact mark, a minimal filled car
(rounded body bar `x±s*0.95 × y±s*0.22`, a small cabin hump, and two `s*0.22` wheel dots) also works
at `s = 6.5`; the angle-impact mark is recommended because collisions, not parked cars, are the event.

### alarm / other — BELL (fill) — replaces today's "no mark"
Today alarm draws *nothing* inside the dot, which is the one category that fails "symbols over color"
entirely. Give it a small, simple **bell** (or, if a bell is too fussy at this size, a concentric
double-ring "alert" — recipe below). The bell is a rounded dome + flared lip + clapper dot.

    // s = 5.5 — small bell
    ctx.fillStyle = `rgba(${rgb},${as})`;
    ctx.beginPath();
    ctx.moveTo(x - s*0.62, y + s*0.45);                      // lip left
    ctx.quadraticCurveTo(x - s*0.62, y - s*0.5, x, y - s*0.7); // up to crown left
    ctx.quadraticCurveTo(x + s*0.62, y - s*0.5, x + s*0.62, y + s*0.45); // crown to lip right
    ctx.lineTo(x - s*0.62, y + s*0.45);                      // lip base
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y + s*0.72, s*0.22, 0, Math.PI*2); ctx.fill(); // clapper

Fallback if the bell reads muddy on the Pi — a **concentric alert** (two thin arcs + a center dot,
clearly "something signaling"):

    ctx.strokeStyle = `rgba(${rgb},${as})`; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(x, y, s*0.45, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, s*0.85, -0.9, 0.9); ctx.stroke();           // right alert arc
    ctx.beginPath(); ctx.arc(x, y, s*0.85, Math.PI-0.9, Math.PI+0.9); ctx.stroke(); // left arc
    ctx.beginPath(); ctx.arc(x, y, s*0.16, 0, Math.PI*2); ctx.fillStyle = `rgba(${rgb},${as})`; ctx.fill();

Bell is the recommendation (it's a distinct silhouette from flame/plus/impact); the concentric alert
is the safer fallback if the bell loses its shape at 11 px.

## 3. Legibility — the dark under-stroke makes the symbol survive

The keyline trick that saved the disc now serves the *symbol*. Before drawing each symbol in hue,
draw the **same path once in dark `rgba(6,12,20, 0.65*vis)` with a slightly wider line / a 1 px
shadow-offset-free outline**, so every symbol carries its own dark rim against both the colored dot
and the teal water. For filled symbols (flame, cross, bell) stroke the path at `lineWidth ≈ 1.6`
*before* filling; for stroked symbols (impact, alert) draw the path first at `lineWidth + 1.2` in the
dark color, then again in hue at the nominal width — a cheap two-pass that gives a knockout edge.

This keeps the existing "contrast not brightness" law: the symbol pops via a dark rim, spending none
of the brightness budget aircraft own. Symbols are deliberately blunt — a filled plus, a filled
teardrop, a bent chevron, a bell dome — all of which survive at 11–15 px viewed across a room (the
NotableLayer emblems are the calibration; these are simpler because they have no white inlay to lose).
Color remains as CVD reinforcement: even fully desaturated, flame ≠ plus ≠ impact ≠ bell by shape
alone.

## 4. The rewritten marker draw

Backing dot demoted, symbol promoted, everything else (halo, keyline, hue lip, severity dim, age
fade, `coreDim()` night, gentle keyline night floor, arrival ripple, breath) preserved verbatim.

    // --- per incident, inside the existing loop, replacing the disc/keyline/lip/drawMark block ---
    const c = CAT[inc.cat];
    // ... existing vis / dim / breath computation unchanged ...

    // Soft outer halo (source-over, never additive) — smaller now, just depth.
    const halo = ctx.createRadialGradient(p.x, p.y, c.dot*0.5, p.x, p.y, c.r);
    halo.addColorStop(0, `rgba(${c.rgb},${(0.18*c.core*dim*breath).toFixed(3)})`);
    halo.addColorStop(1, `rgba(${c.rgb},0)`);
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(p.x, p.y, c.r, 0, Math.PI*2); ctx.fill();

    // Small solid backing dot — the plate the symbol sits on (NOT the primary read anymore).
    ctx.fillStyle = `rgba(${c.rgb},${(c.core*dim*breath).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, c.dot, 0, Math.PI*2); ctx.fill();

    // Bold dark keyline on the dot edge — contrast on teal; gentle night floor (not full coreDim).
    ctx.strokeStyle = `rgba(6,12,20,${(0.7*vis*(0.85+0.15*(1-nf))).toFixed(3)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, c.dot, 0, Math.PI*2); ctx.stroke();

    // Thin hue lip just outside the keyline — the crisp colored locus.
    ctx.strokeStyle = `rgba(${c.rgb},${(c.ring*dim*breath).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, c.dot + 1.3, 0, Math.PI*2); ctx.stroke();

    // PRIMARY READ: the category SYMBOL on top of the dot.
    drawSymbol(ctx, p.x, p.y, inc.cat, c.rgb, c.sym, Math.min(0.98, c.ring*dim + 0.14), vis);

    // ... existing arrival ripple unchanged (uses c.r) ...

And the replacement for `drawMark()`, now `drawSymbol()` (dark under-stroke pass + hue pass):

    function drawSymbol(ctx, x, y, cat, rgb, s, as, vis) {
      const dark = `rgba(6,12,20,${(0.6*vis).toFixed(3)})`;
      ctx.save();
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      if (cat === "major") {
        // flame path (see §2) — stroke dark at 1.6 first, then fill hue, then inner tongue
        flamePath(ctx, x, y, s);
        ctx.lineWidth = 1.6; ctx.strokeStyle = dark; ctx.stroke();
        ctx.fillStyle = `rgba(${rgb},${as.toFixed(3)})`; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y + s*0.34, s*0.30, 0, Math.PI*2);
        ctx.fillStyle = `rgba(255,196,128,${(as*0.55).toFixed(3)})`; ctx.fill();
      } else if (cat === "medical") {
        const al = s*0.85, aw = s*0.30;
        // dark under-plate (slightly fatter), then hue
        ctx.fillStyle = dark;
        roundRect(ctx, x-aw-0.8, y-al-0.8, (aw+0.8)*2, (al+0.8)*2, aw*0.6); ctx.fill();
        roundRect(ctx, x-al-0.8, y-aw-0.8, (al+0.8)*2, (aw+0.8)*2, aw*0.6); ctx.fill();
        ctx.fillStyle = `rgba(${rgb},${as.toFixed(3)})`;
        roundRect(ctx, x-aw, y-al, aw*2, al*2, aw*0.6); ctx.fill();
        roundRect(ctx, x-al, y-aw, al*2, aw*2, aw*0.6); ctx.fill();
      } else if (cat === "vehicle") {
        impactPath(ctx, x, y, s);                 // chevron + spark (see §2)
        ctx.lineWidth = 3.0; ctx.strokeStyle = dark; ctx.stroke();   // dark pass (wider)
        impactPath(ctx, x, y, s);
        ctx.lineWidth = 1.8; ctx.strokeStyle = `rgba(${rgb},${as.toFixed(3)})`; ctx.stroke();
      } else { // alarm — bell (see §2)
        bellPath(ctx, x, y, s);
        ctx.lineWidth = 1.6; ctx.strokeStyle = dark; ctx.stroke();
        ctx.fillStyle = `rgba(${rgb},${as.toFixed(3)})`; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y + s*0.72, s*0.22, 0, Math.PI*2);
        ctx.strokeStyle = dark; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.fillStyle = `rgba(${rgb},${as.toFixed(3)})`; ctx.fill();
      }
      ctx.restore();
    }

(Factor the three multi-point shapes into `flamePath`, `impactPath`, `bellPath` helpers that just
`beginPath()` + the path from §2 so both the dark and hue passes share geometry. `roundRect` already
exists in NotableLayer — lift it or import it.)

## Constraints honored (checklist)

- **source-over only** — no `globalCompositeOperation = "lighter"` anywhere; halo, dot, symbol all
  source-over.
- **no near-white core** — the only lifted-light pixel is the flame's inner tongue at
  `rgba(255,196,128, as*0.55)` (a warm ember, not white, and faint); every other element is a muted
  earth hue or dark.
- **drawn under traffic** — layer/draw-order unchanged; this only restyles the per-incident mark.
- **coreDim() night** — `dim` (which already folds `cm = coreDim()`) still multiplies dot, lip, and
  symbol alpha; only the dark keyline holds its gentler `0.85 + 0.15*(1-nf)` night floor (unchanged).
- **severity-graded presence** — major keeps a larger dot/symbol, brighter ring, and the breath; the
  flame is also the boldest filled silhouette, so a structure fire is clearly the hottest mark.
- **arrival ripple** — unchanged; still a single source-over raindrop at `c.r + u*c.r*2.2`, day only,
  fresh-dispatch only.

## Summary

Invert the marker so the **symbol** is the read and the colored disc demotes to a **small backing
dot**. Shrink the footprint: backing dot from disc 6–8 to **dot 4.5–5.5**, outer halo from r 10–12 to
**r 8.5–9.5**, overall symbol box **~13 px routine / ~15 px major** (down from ~22–24 px). Each
category gets a bold, drawable canvas symbol sized `s = 5.5–7.0`: **major = a filled teardrop flame**
(NotableLayer's flame scaled down, faint ember tongue, not white); **medical = a bold filled rounded
plus** (arms ±`s*0.85`, width `s*0.30` — the most legible mark for the highest-volume category);
**vehicle = a bent impact-chevron with a 3-ray spark** rather than a literal car (collisions, not
parked cars, are the event); **alarm = a small bell** (dome + lip + clapper), replacing today's
draw-nothing, with a concentric-alert fallback if the bell muddies at 11 px. Every symbol gets a
**dark under-stroke / under-plate** (`rgba(6,12,20,~0.6)`) so the shape survives the teal water by
contrast, not brightness — the same keyline law that saved the disc, now applied to the glyph. Color
stays as CVD reinforcement (shape distinguishes all four even fully desaturated). All existing
constraints hold verbatim: source-over, no near-white core (flame tongue excepted, and it's a faint
ember), drawn under traffic, `coreDim()` night dimming with the gentler keyline night floor, major's
slight extra presence + breath, and the one-time arrival ripple.
