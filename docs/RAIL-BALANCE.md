# Rail Balance — Train vs. Track/Station Hierarchy

Owner feedback (2026-06-18): *"the light rail light is too prominent, and you cannot even see
the rail car well."* Two coupled problems, one root cause.

All values below were read from source with the Read tool (the bash mount serves stale copies of
edited files). This document is prose + exact recommended values only — no code was modified.

## Diagnosis: the hierarchy is inverted

The product's stated brightness law (DESIGN-AUDIT-v5, COLOR-PALETTE-DESIGN) is that a *live,
measured* thing should out-read *static infrastructure*. The rail stack violates it today, for one
concrete reason:

**The station core and the train window band are the same near-white tone at nearly the same
alpha — and the station then adds a ring AND a blooming halo on top.** A station is currently:

- a near-white core `rgba(232,255,244, 0.98*coreDim())` at r `2.4*sr` (RailLayer line 122-123),
- *plus* a stroked jade ring `rgba(40,225,170,0.95)` at r `5*sr`, width 1.6 (line 116-119),
- *plus* a jade halo bloom `0.22 + 0.25*prox` at r up to `7*sr*1.6` (line 112-114).

The live train's brightest pixel is its window band `rgba(232,246,255, 0.9*a*cm)` (TrainLayer
line 137) — essentially the *same* near-white at a *lower* alpha (0.9 vs 0.98) and a *smaller*
footprint (a 1.8px-tall band inside a 13×5.4 capsule) than the station core's filled disc. So a
stationary stop, with three stacked elements, out-reads a moving railcar that has only a thin band,
a `0.95*a` jade body, and a faint `0.22*a` glow with no crisp edge. The eye lands on the brightest,
largest, most-structured mark — which is the station, exactly backwards.

On top of that, the **line itself is loud**: a `0.22`-alpha glow at a fat `9*wm` width plus a
`0.95` body plus a *bright* `rgba(150,240,200,0.9)` hairline. The hairline in particular is a
near-continuous bright line competing with the train for "the brightest rail thing."

The fix is a three-way separation, applied with the system's own levers (alpha/width/radius, the
existing `coreDim()` night-awareness, no new hues, no additive blend — rail stays `source-over`):

1. **Reserve near-white for the moving train.** Drop the *station core* off near-white to a dim
   jade-white; keep the *train* window band near-white and make it brighter and crisper.
2. **Recede the line.** Lower the glow alpha + width and dim/desaturate the hairline so the ribbon
   reads as quiet lit infrastructure, not a headline.
3. **Shrink + dim the station, give the train a keyline + more size.** Make the railcar the
   largest, sharpest, brightest rail element; keep the station legible as a "stop" but supporting.

Resulting hierarchy (brightest/most-legible first): **live train → static line → stations →
arrival ring / approach bloom.** The approach bloom still lifts a hub on arrival, but it now tops
out *below* the train rather than swamping it.

---

## RailLayer.ts — recommended values

### Line constants (top of file, lines 31-35)

| Constant | Current | Recommended | Why |
|---|---|---|---|
| `LINE_HAIR` | `rgba(150,240,200,0.9)` | `rgba(120,215,180,0.55)` | Dimmer + slightly less saturated so the centerline reads as a quiet coax core, not a bright line that rivals the train. |
| `STATION_RING` | `rgba(40,225,170,0.95)` | `rgba(40,225,170,0.65)` | The ring is the station's identity; keep the hue, pull the alpha so the ring outlines the stop without glowing. |
| `LINE` | `rgba(40,225,170,` | *unchanged* | The jade hue is correct and distinctive; only its *application* alphas/widths change below. |

### Subsurface (tunnel) dashed track (lines 74-77)

Already recessive; leave as-is, but if the line read still feels heavy after the surface changes,
drop the tunnel alpha from `0.3` to `0.24`. Optional, low priority.

### Surface line strokes (lines 84-92)

| Element | Current | Recommended |
|---|---|---|
| Glow under-stroke alpha | `LINE + "0.22)"` | `LINE + "0.14)"` |
| Glow under-stroke width | `9 * wm` | `7 * wm` |
| Body alpha | `LINE + "0.95)"` | `LINE + "0.72)"` |
| Body width | `2.6 * wm` | `2.4 * wm` |
| Hairline | `LINE_HAIR` (now 0.55) | *(use new dimmer LINE_HAIR; keep width `1 * wm`)* |

The line stays clearly a *lit* jade ribbon (glow + body + hair are all retained) but it settles a
rung. The narrower, dimmer glow also stops the halo of low-alpha jade from smudging over teal water
(a risk the palette doc flagged for the station halo).

### Station markers (lines 112-124)

| Element | Current | Recommended | Why |
|---|---|---|---|
| Halo radius | `7*sr*(1 + 0.6*prox)` | `6*sr*(1 + 0.55*prox)` | Slightly smaller resting footprint; approach bloom still swells, but tops out lower. |
| Halo alpha | `(0.22 + 0.25*prox)` | `(0.14 + 0.22*prox)` | Lower resting floor so a quiet station is genuinely quiet; the approach lift (`+0.22*prox`) still reads as a hub breathing, but its peak (~0.36) now sits below the train, not above it. |
| Ring radius | `5 * sr` | `4.6 * sr` | A touch smaller so the stop is a marker, not a target. |
| Ring width | `1.6` | `1.4` | Pairs with the lower-alpha STATION_RING. |
| Core radius | `2.4 * sr` | `2.0 * sr` | Shrink the core so it stops competing with the train bead/band. |
| **Core color** | `rgba(232,255,244, 0.98*coreDim())` | `rgba(150,235,200, 0.62*coreDim())` | **The key change.** Drop the station core *off near-white* to a dim jade-white and cut its alpha. Near-white is now reserved for the moving train. The station still has a bright-ish jade center, but it no longer reads as a "presence light." |

### Arrival ring (lines 128-135)

Leave as-is. It is rare (30 s/station cooldown), short (1.2 s), low-alpha (`0.5*(1-age)`), and it
is a *transient confirmation that a live train arrived* — semantically it belongs to the train, so
it is fine for it to be momentarily bright. No change.

---

## TrainLayer.ts — recommended values

Goal: make the railcar the brightest, sharpest, largest rail element. Levers: a crisp dark keyline,
a brighter window band, a slightly larger capsule, and a touch more glow.

### Moving railcar (lines 128-145)

| Element | Current | Recommended | Why |
|---|---|---|---|
| Capsule size | `L = 13, r = 2.7` | `L = 15, r = 3.0` | A touch larger so the car out-sizes the (now-smaller) station core/ring. |
| **Keyline** | *(none)* | After the body `fill()`, stroke the same capsule path: `ctx.strokeStyle = "rgba(6,14,22,0.55)"; ctx.lineWidth = 1; ctx.stroke();` | A dark contour separates the car from the bright jade track and teal water by a hard edge — the same trick `drawGroundMarker`/the ferry hull already use. A keyline survives any background and any CVD type and is the single highest-value legibility fix for the car. |
| Body alpha | `0.95 * a` | `0.98 * a` | Slightly more solid. |
| Window band color/alpha | `rgba(232,246,255, 0.9*a*cm)` | `rgba(236,248,255, 1.0*a*cm)` | Brighter, crisper near-white — now the brightest rail pixel on the panel. Stays night-aware via `cm` (= `coreDim()`), so it dims with the room. |
| Window band height | `fillRect(-hx, -0.9, hx*2, 1.8)` | `fillRect(-hx, -1.0, hx*2, 2.0)` | Scales with the slightly larger car (r went 2.7→3.0). |
| Shimmer | `rgba(255,255,255, 0.5*a*cm)`, r 1.5 | `rgba(255,255,255, 0.6*a*cm)`, r 1.7 | A hair brighter/larger so the along-track glide reads as "alive." Stays `cm`-scaled. |
| Soft glow (line 121-122) | `rgba(base, 0.22*a)`, r 8 | `rgba(base, 0.28*a)`, r 9 | A touch more presence around the car (still `source-over`, no additive). |
| Comet tail (line 110-114) | end alpha `0.55*a`, width 2.8 | end alpha `0.6*a`, width 2.8 | Marginally stronger motion read; width unchanged so it stays a tail, not a stripe. |

### Dwelling bead (lines 146-155)

The platform-dwell bead also carries a near-white core `rgba(232,246,255, 0.98*a*cm)`. Keep it
near-white (a dwelling train is still the live thing at that platform), and bump it to match the
brightened band: `rgba(236,248,255, 1.0*a*cm)`, and grow the jade body from r 4 to r 4.5 and core
from r 2 to r 2.2, so a dwelling train still clearly out-reads the station core it sits on (the
station core is now the dim jade-white `rgba(150,235,200, 0.62*coreDim())`, so this holds easily).

### Submerged ghost (lines 94-106) and simulated beads (lines 161-191)

No change. The submerged ghost is *meant* to be quiet (schedule-paced, hollow, dimmed), and the
simulated beads are already a hollow ~35%-desaturated guess that stands down the moment a live
train lights the line. Both are correctly subordinate.

### Line color constants (lines 17-20)

`LINE_RGB` 1 Line `[70,180,110]` and 2 Line `[0,124,173]` are unchanged — the 1 Line bead was
already lifted off the official olive to a brighter jade-green so the vehicle out-reads its track
(per the palette doc), and these are the right body hues. The work here is *contrast and core*, not
hue.

---

## Night-awareness check

Both the train cores and the station core route through `coreDim()` (`night.ts`,
`0.5 + 0.5*(1-nf)`, floor 0.5). After these changes:

- Train window band peak = `1.0 * coreDim()` → 0.5 at full night.
- Station core peak = `0.62 * coreDim()` → 0.31 at full night.

So the train's near-white stays comfortably above the station's dim jade-white at every hour, and
both still settle into the dark room. (DESIGN-AUDIT-v5 separately recommends lowering the global
`coreDim()` floor so transit cores never out-read a night-bloomed aircraft light; that is a
system-wide change tracked there and is out of scope for this rail rebalance — these values hold
the *rail-internal* hierarchy regardless of where that floor lands.)

---

## Resulting hierarchy

1. **Live train** — brightest near-white window band (`236,248,255` @ `1.0*cm`), crisp dark
   keyline, largest capsule (15×6), strongest glow. Unmistakably the live thing.
2. **Static line** — a quiet lit jade ribbon (glow `0.14`/w7, body `0.72`/w2.4, dim hair `0.55`).
   Clearly present, clearly infrastructure.
3. **Stations** — a dim jade-white core (`150,235,200` @ `0.62*cm`), a `0.65`-alpha jade ring, a
   low resting halo that *breathes up* on a real train's approach (peak ~0.36) but tops out below
   the train. Legible as a "stop," never the headline.
4. **Arrival ring** — a rare, brief, transient "drop in water" confirming a live arrival; belongs
   to the train, fine to flash momentarily.

The railcar is now the brightest and most legible rail element; the line and stations recede to
supporting infrastructure without disappearing. Calm, ambient, night-aware, no new hues, no
additive blending.
