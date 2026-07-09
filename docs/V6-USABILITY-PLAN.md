# SkyView V6 — Usability & UX Plan

Status: PLANNING. Author: senior UX audit, 2026-06-21.
> **Shipped 2026-07-09 (pending deploy):** P0-1 (mute/settings left cluster never fully hides —
> `autoHidePersist`), P0-3 (floating controls warm-dark-red at night via `ctlBtnStyle(night)`; TapCard
> photo + TransitCard dimmed at night), P0-5 (deselect pill stays while a card is open; TapCard ✕
> 26→38px, TransitCard ✕ → 34px padded + aria-label). All in `Display.tsx`. Remaining: P0-2 (first-run
> hint), P0-4 (unify the night predicate across Display/Control), and the P1 drawer re-org / Fire-EMS
> rows / slider ergonomics.
Scope: usability of the live display + settings drawer across the bedside touch
kiosk (1280×800) AND web/mobile viewers. Calm-first: nothing here should add
chrome to the glanceable resting view.

Grounding (all citations are real symbols read for this audit):
- `web/src/display/Display.tsx` — `Display()`, the pointer/tap pipeline
  (`onDown`/`onMove`/`onUp` ~L279–355), the auto-hide control cluster
  (`pokeUi`, `autoHide`, `CtlBtn`, `btnBase` L494–503), the settings drawer
  (`showSettings` block L456–489), the airport "doorway" (`airportEntry`,
  `FIELD_ENTRY_ZOOM` L52, L416–432), kiosk/web split (`isKiosk` L74,
  `localCfg`/`effective` L81–85, `pushToDisplay` L97), `TapCard` L507,
  `TransitCard` L701.
- `web/src/control/Control.tsx` — the full settings panel (10 `ListSection`s).
- `web/src/control/ui.tsx` — `ListRow` (minHeight 48), `Switch` (51×31),
  `Segmented`, `Slider` (width 160).
- `web/src/shared/types.ts` — `Config` (~70 fields).

---

## 1. Executive summary

SkyView's *resting* glance is excellent and should not be touched. The problems
are all in **discoverability and ergonomics of the interactions layered on top of
that calm view** — and they fall hardest on the two audiences who can't read the
source:

1. **Nothing tells a viewer the map is interactive.** Tap-to-select aircraft,
   tap-to-open transit cards, the airport doorway, and even the settings gear are
   all either invisible at rest or auto-hidden after 14 s. There is **zero
   first-run affordance** (confirmed: no onboarding/tooltip/coachmark code exists
   anywhere in `web/src`). A bedside guest, or George's family, will see a pretty
   map and never learn it does anything.

2. **The control drawer is a 10-section, ~50-control wall.** Every toggle in
   `Config` is exposed flat, ordered by implementation history, not by how often
   anyone touches it. The two things people actually want at a bedside —
   brightness and night/mute — are buried under "Display" and "Display power".

3. **Touch ergonomics are uneven.** The floating round buttons are a good 60 px
   (`btnBase`), but inside the drawer the `Slider` is a native `<input type=range>`
   at `width:160` with a default ~16 px thumb — far below a comfortable touch
   target on a 1280×800 panel operated by a sleepy hand in the dark.

4. **Night legibility gaps.** The drawer recolors to dark-red at night (good),
   but the floating controls, the `TapCard`, and the `TransitCard` keep their
   cool-blue/white glassmorphism and bright photos regardless of `monitorMode` —
   so the one moment you reach for the screen in a dark room (to mute or check a
   plane) is the one moment it blasts light.

The fixes below are deliberately small and calm. P0s are the discoverability and
night-safety items; nothing in P0/P1 adds persistent chrome to the resting view.

---

## 2. Findings by area

### 2.1 Discoverability of core interactions  — the biggest gap

| Feature | How it's triggered today | Why it's undiscoverable |
|---|---|---|
| Select an aircraft | tap a glyph (`r.pickAt` in `onUp`) | no cursor/ripple/hint; glyph is small (`glyphSizePx` 12–34) |
| Transit card | tap a train/bus/station/ferry/incident (`r.pickTransit`) | same; user has no reason to think beads are tappable |
| Navaid/fix reveal | tap empty-ish map (`r.pickStatic`) | completely hidden; even power users won't find it |
| Airport view | hover (desktop) or zoom-in past `FIELD_ENTRY_ZOOM=3` over KSEA (touch) | the zoom gate means a mobile user almost never sees the doorway; no other entry point exists |
| Settings | the ⚙ button — but it lives in the **auto-hiding** cluster | after 14 s of no pointer activity (`pokeUi` timeout) the gear is gone; a returning user sees no way in |
| Mute / night | 🌙 button — same auto-hiding cluster | same problem; the single most useful bedside control disappears |

The auto-hide is the right instinct for a glanceable device, but it currently
hides the *only* entry points to settings and mute with no residual hint. On a
**touch** device there is also no hover state, so the controls are invisible
until the user taps the screen — and a first tap that lands on a glyph opens a
card instead, which is confusing.

### 2.2 The control drawer (`Control.tsx`)

- **Volume:** 10 `ListSection`s — Display, Overlays, Navigation, Trails, Labels,
  Traffic & alerts, Filters, Motion & performance, Display power, (web) Advanced,
  Scenes, (touch) System. ~50 interactive rows. This is a power-user console, not
  a bedside remote. There is no search, no "Basics" grouping, no collapse.
- **Ordering is historical, not task-based.** "Brightness" (`brightness`) and
  "Aircraft size" sit in *Display*; the night theme + mute live in *Display
  power* near the very bottom. The most-touched bedside controls require the most
  scrolling.
- **`showFireEms` / `fireEmsArrivalCue` exist in `Config` but have no row in
  `Control.tsx`** — they can only be changed by editing config or a scene. A
  whole live layer is unreachable from the UI (verify: grep `Control.tsx` for
  `showFireEms` returns nothing).
- **Jargon without explanation:** "Notable", "Leader lines", "Trigger ring NM",
  "Render scale", "Sky time offset", "Chart underlay" — no helper text. Fine for
  George; opaque for anyone else and for George six months from now.
- **The web vs touch model is good** (the blue "You're editing this web view…"
  card + Push/Discard is genuinely clear) — keep it. But the *kiosk* drawer has
  no equivalent one-line orientation.
- **Consistency bug:** the night theme is computed **twice and differently**.
  `Control.tsx` `night` = `monitorMode` red/lightsout/night. `Display.tsx`
  `ctlNight` additionally includes `muted`. So when you "Mute now," the drawer
  *frame* (built in Display) goes dark-red but the drawer *body* (Control) stays
  light — a visible seam. They must share one predicate.

### 2.3 Touch targets & ergonomics (1280×800)

- Floating buttons: 60 px circles (`btnBase`) — good, exceeds the 44 px min.
- `ListRow` minHeight 48, `Switch` 51×31 — good.
- **`Slider` is the weak point:** native range input, `width:160`, default thin
  track + small thumb. There are ~18 sliders (brightness, glyph size, rotate,
  trail length, min/max alt, FPS, etc.). On a touch panel these are fiddly and
  have no current value shown *on the control* (the value is only in the row
  label, e.g. "Rotate 120°"). Sleepy-hand miss rate will be high.
- **`TapCard` close & `Deselect`:** the card's ✕ is a 26 px circle (`TapCard`
  close button) — under 44 px. There's a redundant large "✕ Deselect" pill at
  bottom-center, but it's in the auto-hiding cluster, so after 14 s the only way
  to dismiss a card is the tiny corner ✕.
- **`TransitCard`** ✕ is a bare text glyph with no padding — even smaller hit area.
- **Segmented controls** with 4 options (e.g. Label Density, Monitor Mode) at
  `padding:7px 14px` get tight near the drawer's 440 px edge.

### 2.4 First-run / onboarding

None exists. For an always-on appliance this is defensible for the *owner*, but:
- A guest at the bedside has no path to "what is this / how do I dim it."
- The airport view, navaid taps, and transit taps are effectively secret features.
- Recommendation is **not** a modal tour (that would violate calm-first). A single,
  dismissible, once-ever "tap a plane • ⚙ settings" hint and a persistent low-key
  affordance are enough (see P0-1, P0-2).

### 2.5 Night-mode usability at a bedside

- Drawer recolors correctly via `themeVars` in `Control.tsx`. Good.
- **But the live overlays don't:** `btnBase` (floating controls), `TapCard`
  (cool palette `C` + full-color photo), and `TransitCard` (`rgba(8,12,20…)`,
  bright line dots) ignore `monitorMode`/`muted`. Reaching for the screen at
  night to mute or to glance at a plane throws bright/blue light.
- The 🌙→☀ toggle is the right idea, but its discoverability problem (2.1) means
  the bedside dim action is hidden exactly when wanted.
- `muted` vs `muteArmed` logic (L106–109) is correct and subtle — but the icon
  is the only feedback; there's no text confirming "Muted until sunrise."

### 2.6 Accessibility

- **Contrast:** `TapCard` tertiary text `#6B7480` on the dark glass is ~3:1 —
  below WCAG AA for the small 10–11 px footer/provenance text. The drawer's
  muted gray `#8a8f98` helper text is similarly low.
- **Target size:** card close buttons (26 px / bare glyph) fail the 44 px
  recommendation; sliders' effective target is small.
- **Labels:** `CtlBtn` has `aria-label` (good). `Switch` has `aria-pressed`
  (good). But `Segmented`, `Slider`, and the card close ✕s have no
  `aria-label`/role; the airport doorway button relies on `title` only.
- **Color-only meaning:** trail/altitude coloring and the transit line dots
  carry meaning by hue alone. Route provenance already solved this with glyphs
  (`✓`/`?` in `routeProvenance`) — extend that discipline.
- No reduced-motion respect for the burn-in glide / strobes (acceptable but note).

### 2.7 Cross-surface consistency

- The same `Control` renders on both surfaces with a `surface` prop — good.
- But the live-view interactions differ in ways the user can't predict: desktop
  reveals the airport doorway on **hover**, touch only past a **zoom gate**;
  controls auto-hide on touch with no hover fallback. The mental model isn't
  portable between George's phone and the bedside panel.
- `pushToDisplay` sends the **full** effective config (WYSIWYG) — good and
  intentional. Keep.

---

## 3. Prioritized recommendations

Each item: the exact change and where. P0 = ship in V6; P1 = strong; P2 = nice.

### P0 — discoverability + night safety (no resting-view chrome)

**P0-1. A persistent, ultra-quiet "settings" affordance that never fully hides.**
*Problem:* ⚙ and 🌙 live in the auto-hiding cluster (`autoHide(uiVisible)`), so
the only entry to settings/mute vanishes after 14 s with no residue.
*Change:* In `Display.tsx`, exempt the **left** cluster (mute + settings) from
full opacity:0. Instead of `autoHide(uiVisible)` returning `opacity:0`, have the
left cluster fade to a resting `opacity:0.12` (still hit-testable) and rise to 1
on `pokeUi`. The zoom/home cluster can still fully hide. Net: the gear is always
faintly present, never clutters, always reachable. ~6-line change to `autoHide`
plus a variant for the persistent cluster.

**P0-2. One-time, dismissible interaction hint (web/touch, never kiosk projector).**
*Problem:* no signal the map is tappable; airport/navaid/transit taps are secret.
*Change:* Add a small bottom-center pill shown only on first session
(localStorage flag, gate on `!isKiosk` is fine — the bedside touch panel benefits
too; only skip `?kiosk=projector`). Copy: "Tap a plane for details · ⚙ for
settings". Auto-dismiss on first successful `pickAt`/`pickTransit`, or on ✕.
Reuse the existing glass pill style from the airport doorway button. ~25 lines in
`Display.tsx`, plus a `loadLocal`/`saveLocal` flag (infra already exists).

**P0-3. Night-theme the floating controls + both cards.**
*Problem:* `btnBase`, `TapCard`, `TransitCard` ignore `monitorMode`/`muted` and
blast cool light at a bedside.
*Change:* Plumb the already-computed `ctlNight` (Display L380) into `btnBase`
(make it a function of a `night` flag → warm dark-red glass, dimmed text) and
into `TapCard`/`TransitCard` (swap palette `C` to a red-shifted variant, and drop
photo brightness via `filter:brightness(.6)` when night). No new state — reuse
`ctlNight`. Medium edit, all in `Display.tsx`.

**P0-4. Unify the night predicate.**
*Problem:* drawer frame (`ctlNight`, includes `muted`) and drawer body (Control
`night`, excludes `muted`) disagree → visible seam on Mute.
*Change:* Export one helper (e.g. `isNightChrome(cfg)` in a shared module) used by
both `Display.ctlNight` and `Control.night`. Pass `muted` into `Control` so its
`night` matches. ~10 lines.

**P0-5. Make card-dismiss reachable and finger-sized.**
*Problem:* after 14 s the only card-close is a 26 px ✕ (TapCard) / bare glyph
(TransitCard).
*Change:* (a) enlarge `TapCard` close to 36–40 px and `TransitCard` ✕ to a padded
~40 px target; (b) make the bottom-center "✕ Deselect" pill (and a matching one
for transit) **exempt from auto-hide while a card is open** — a card on screen is
an active interaction, so its dismiss control should not disappear.

### P1 — drawer clarity + touch ergonomics

**P1-1. Re-order the drawer around tasks; add a "Basics" group on top.**
*Change:* In `Control.tsx`, introduce a first `ListSection title="Basics"` with
the four most-touched bedside controls: **Brightness**, **Night mode**
(`monitorMode`), **Mute schedule / Lights-out hour**, **Skin (Map/Sky)**. Leave
the deep sections below, ideally collapsed. Moves existing rows; no new config.
This directly fixes "the two things you want at a bedside are buried."

**P1-2. Collapse the deep sections (progressive disclosure).**
*Change:* Add a lightweight collapsible to `ListSection` (`ui.tsx`) — header
becomes a tap target with a chevron; default-collapse everything except Basics +
Overlays. Calm-first: the wall becomes a short menu. ~15 lines in `ui.tsx`,
backward-compatible (default `defaultOpen` true for sections that pass it).

**P1-3. Add the missing Fire/EMS rows.**
*Change:* Add to the "Overlays" section: `Show Fire/EMS` (`showFireEms`) and,
when on, `Arrival cue` (`fireEmsArrivalCue`). A live layer should not be UI-
unreachable. 2 `ListRow`s.

**P1-4. Bigger, value-labeled sliders.**
*Change:* In `ui.tsx` `Slider`, increase track height and thumb via CSS
(`::-webkit-slider-thumb` ~28 px), keep width but show the current numeric value
inline to the right of the track so the user sees the value *on the control*, not
only in the row label. Lifts ~18 sliders to a comfortable bedside target at once.

**P1-5. A persistent, low-key airport-view entry on touch.**
*Problem:* the doorway only appears past `FIELD_ENTRY_ZOOM=3` over KSEA, so mobile
users rarely find the headline V6 feature.
*Change:* Keep the contextual doorway, but also surface a small "Airport" affordance
in the drawer (a `ListRow` with a button that opens `/airport`) so there's a
discoverable, non-spatial path. Calm-first: nothing added to the resting map.

**P1-6. Add aria-labels + raise small-text contrast.**
*Change:* Add `aria-label`/`role="slider"` context to `Slider`, `aria-label` to
`Segmented` group and to both card ✕ buttons. Bump `TapCard` tertiary
`#6B7480`→ ~`#8A93A0` and drawer helper `#8a8f98` lighter, to clear AA on the
10–11 px text.

### P2 — polish

**P2-1. Mute confirmation text.** When `muted`, show a brief auto-fading toast
"Muted until sunrise" so the 🌙→☀ swap isn't the only feedback.

**P2-2. Settings search / filter field** at the top of the drawer once collapsed
sections exist — for power users to jump to any of ~50 controls.

**P2-3. Reduced-motion respect.** Gate the burn-in glide and any strobe/flash on
`prefers-reduced-motion` for web viewers.

**P2-4. Tap feedback ripple.** A 200 ms ring at the tap point on a successful
`pickAt`/`pickTransit` — teaches "that was tappable" without persistent chrome.

**P2-5. Consistent doorway model.** Consider a single rule for the airport
doorway across hover/touch (e.g. always show a faint chip when KSEA is on-screen,
regardless of zoom) so the phone and bedside behave the same.

---

## 4. Calm-first guardrails (what this plan deliberately does NOT do)

- No persistent legend, toolbar, or labels added to the resting map.
- No modal onboarding tour; the only first-run element is one dismissible pill
  that disappears forever after the first interaction.
- The auto-hide stays — we only keep the *settings/mute* entry faintly resident
  (P0-1) and the *active card's* dismiss resident (P0-5).
- Night changes only ever *reduce* light; they never add elements.

---

## 5. Suggested V6 sequencing

1. P0-4 + P0-3 (night unification + night-themed chrome) — small, removes the
   worst bedside light leak. Do first; they share the predicate work.
2. P0-1 + P0-5 (persistent settings/mute + reachable card dismiss).
3. P0-2 (first-run hint).
4. P1-1 + P1-2 + P1-3 (drawer re-org, collapse, missing rows) — one pass.
5. P1-4 + P1-6 (slider ergonomics + a11y).
6. P1-5, then P2s as time allows.
