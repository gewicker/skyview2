# SkyView v6 — Release Notes

v6 theme: after the airport-view kickoff, the release split into a **forked Airport View** (its own
handoff) and a **main line focused on bugs, performance, usability, and art**. This file tracks what
has shipped; the planning docs (below) track what's queued.

---

## Shipped (live on the kiosk)

**Transit**
- Transit / incident tap-cards now **auto-despawn** when the element leaves range, is panned
  off-screen, or its feed is toggled off (matches the aircraft card).
- **Bus route reveal redesign** — tapping a bus draws the road *ahead* only: a gradient taper bright
  at the bus → dim at the destination, dashes that **flow at the bus's live speed** (a free congestion
  read), a corridor underglow, and a destination ring labeled with the headsign.
- **Ferries glide smoothly** — velocity-predicted between the ~15 s polls instead of easing-to-fix and
  stalling (the start/stop stutter), staying on the water.

**Map**
- **Harborview Medical Center helipad** (FAA WA53) — the real "H"-in-circle heliport symbol with a
  medical-cross badge, zoom-revealed under traffic, so the recurring Airlift NW medevac reads as
  parked at its base.

**Aircraft lights (design review pass)**
- The **auto-spotlighted** plane now earns the authentic strobe **double-flash + landing beam** (was
  manual-tap only); beacon **decorrelated** from the strobe (true ~40/min); ±8% per-plane strobe
  **twinkle**; day xenon-bloom restricted to the featured plane; position-light radius capped below the
  strobe; `coreDim()` night floor lowered so a distant ambient plane always out-reads a transit core at
  night.

**Airport View — phase 1**
- A separate client bundle at **`/airport`** renders a detailed **top-down KSEA** (reuses the field
  geometry + live aircraft stream). The map is the **doorway**: a discreet entry over KSEA (desktop
  hover / touch zoom-gated), web/mobile only, never the kiosk. *Now forked — see the handoff.*

**This cycle — bug scrub · pruning · tooling**
- Bug fixes: a Link train acquired **mid-tunnel** no longer dead-reckons the wrong way (holds until
  direction is known); a shared **`fieldCenter()`** guards against a divide-by-zero NaN map center;
  Fire/EMS cards guard a missing/garbage timestamp ("29000000 min ago").
- Pruning: removed dead exports (`busShapePath`, `NOTABLE_COLOR`).
- **Regression net (new):** Vitest + unit tests for the pure cores (`mercator`, `path`,
  `notable.classifyNotable`) and an `npm run check` (typecheck + test). Tests are excluded from the
  kiosk build, so they never gate a deploy. Vite now splits the static geometry + airport app into
  named, cache-friendly chunks.

---

## Forked / planned (not in the shipped kiosk)

- **Airport View** (WebGL out-the-window tower/runway/taxi perspectives + the max-zoom control-tower
  entry glyph) → `docs/V6-AIRPORT-HANDOFF.md` (+ `docs/AIRPORT-VIEW-DESIGN.md`,
  `docs/AIRPORT-ENTRY-DESIGN.md`, `docs/AIRPORT-VIEW-ENTRY-OBJECT-DESIGN.md`).
- **Modularity / fork isolation** → `docs/V6-ARCHITECTURE-PLAN.md` (the regression net above is step 1;
  next gated step is the `Renderer` hit-test inversion that lets the airport bundle drop rail/highways).
- **Themed notable-aircraft alert borders** (camo → vector "acquisition card") → `docs/NOTABLE-ALERT-BORDER-DESIGN.md`.
- **Aircraft-label "pop" fix** (held membership + fade) → `docs/AIRCRAFT-LABEL-DESIGN.md`.
- Release plans: `docs/V6-BUG-PLAN.md`, `docs/V6-OPTIMIZATION-PLAN.md`, `docs/V6-USABILITY-PLAN.md`,
  `docs/V6-ART-PLAN.md`.

Tag `v6` once the chosen subset of the above lands.
