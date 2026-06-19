# Airport-View Entry — Design Consult

*How a client reaches the v6 airport view. Principle: **the existing map is the doorway, not the
room.** The kiosk/display app stays exactly what it is; it gains one discreet, spatially-anchored way
in. The Pi never renders the airport view — it only hosts it for web/mobile clients.*

---

## 1. Principle — the field is the door

The entry should feel *inevitable and invisible*: the airport view is about KSEA, so the way in is
**KSEA itself on the map**. No global nav bar, no settings entry, no persistent chrome — those would
clutter the glanceable map and imply the feature lives *inside* this app. Instead, the field becomes
quietly interactive: approach it and a small door appears; leave and it's gone. This keeps the map
pristine and makes the relationship obvious — *that place has a deeper view.*

Three hard constraints shape it:

- **Non-regressive.** It must not touch the existing tap-to-select, pan, or zoom behavior. It's a
  purely additive overlay; if it broke, the map would be unchanged.
- **Never on the kiosk.** The Pi's IPS panel never runs the airport view, so it never shows the entry.
  Gated on `!isKiosk`.
- **Web/mobile only, opens away.** Clicking opens `/airport` in a **new tab/window** so the current
  map session is untouched — the door leads to another room, it doesn't redecorate this one.

## 2. The affordance, by input type

**Desktop (hover-capable pointer) — hover-reveal.** When the cursor comes over the KSEA field, a
small pill fades in just above it: *"KSEA airport view ↗"*. Move away and it fades out. This is the
most discreet possible treatment — zero footprint until the user shows interest by hovering the field.
(Matches the request: "a discreet button… near the airport when hovering over it.")

**Touch (no hover) — proximity + zoom gate.** Phones/tablets can't hover, so the same pill appears
when KSEA is **on-screen *and* the map is zoomed in on it** (a zoom threshold), and hides otherwise.
That keeps it contextual — it never appears on the wide ambient view, only once you've pulled in toward
SeaTac, which is itself a statement of intent. No change to the tap handler (so tapping the field still
does whatever it does today).

Detection branch: `matchMedia("(hover: hover) and (pointer: fine)")` → hover model, else touch model.

## 3. Visual treatment

- A single **glass pill**: blurred dark background (`rgba(12,16,22,0.72)`), hairline light border, 12px
  600-weight label, a trailing `↗` to signal "opens elsewhere." Anchored centered ~40px above the
  field point so it never sits on the runways.
- **Subordinate to everything live** — it's chrome, not data. It must never compete with aircraft,
  and it carries no color from the traffic palette (neutral light-on-dark only).
- Fades in/out (opacity) so its appearance/disappearance is calm, matching the existing auto-hide
  control idiom.
- Below the tap-card z-order, above the canvas.

## 4. Why not the alternatives

- *A persistent button in a corner* — always-on chrome on a glanceable map; also spatially divorced
  from what it opens. Rejected.
- *Putting the view behind the airport tap* — overloads the existing tap (which selects
  navaids/finals) and risks regressing it; also invisible (no discoverability). Rejected.
- *Auto-opening / embedding the 3D view in the display* — violates the whole architecture (Pi would
  have to render it). Rejected.

## 5. Generalization

Anchored to the field, the same affordance trivially extends when other airports get views: reveal the
pill over whichever field has a published view. For now it is gated to **KSEA only** (the only field
with a phase-1 view) so hovering BFI/RNT/PAE shows nothing.

**The shape of it:** *the map gains one quiet door, exactly where you'd expect it — over the field —
and only when you reach for it.*
