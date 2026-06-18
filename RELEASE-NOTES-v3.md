# SkyView 2 — v3 (2026-06-17)

A large iteration over v2: live highway congestion, a full design + code-audit sweep driven by
expert reviews, a contact-lost effect, a bedside-focused control overhaul, and a perf pass.

## Headline features
- **Live highway congestion (WSDOT Traffic Flow).** Real per-segment congestion on I-5/90/405/520,
  polled server-side (embedded key), snapped to the road geometry, eased between updates, with a
  graceful fall-back to the time-of-day model (and a subtle desaturation tell when the feed is stale).
- **Congestion ribbon redesign.** One redundant-encoded ribbon — hue + width + glow + dash-density +
  scroll-speed all rise with congestion; clear road recedes (dim cool), jams pop (hot red-magenta);
  shaded cars only at street zoom.
- **Contact-lost effect.** When a contact drops from the feed it freezes at its last position, then
  dissolves over ~3 s — an expanding radar-blip ring, the glyph desaturating/fading, and a brief
  "CALLSIGN · LOST / type" notation. The track is kept alive underneath so a re-acquired contact resumes.
- **Follow-aircraft.** Tap a plane + toggle "Follow selected" and the map keeps it centered.

## Fixes
- Destination labels now derive from the same approach-physics that produce the on-final tag, so SEA
  arrivals read "→ SEA" not "→ BFI" (and transiting GA no longer get false destinations).
- Zoom rubberband eliminated (release the gesture override when config catches up, not on a timer).
- Highway geometry alignment confirmed; W36 seaplane lane removed; S60/W55 anchors only (lanes dropped —
  bad hand-placed coords); deprecated the "dark" map style (auto-migrates to satellite).
- On-ground detection no longer draws a stationary ramp jet as airborne (BOE123 case).
- Bad-telemetry plausibility filter drops physically-impossible frames (e.g. 400 kt on the surface).

## Design sweep (expert-driven)
- De-cyaned high-altitude traffic (pale ice top) so it stops colliding with the chart cyan; re-tiered
  aeronautical cyan (dim passive chart vs bright "on final" only); gold reserved for HOME, rare→violet.
- Dropped label/tag plates (transparent labels per preference); de-boxed the notable marker (soft glow).
- Night-weighted nav lights, softened the corner vignette, quieter radar, lighter contact shadow.
- Higher-fidelity ground glyphs (silhouettes, consistent); seaplane/heli takeoff-landing effects;
  night dock embers.

## Control & UX (bedside-focused)
- Dark red-shifted theme for the whole control surface + drawer at night (no more white blast at 2 am).
- Bigger touch targets, longer auto-hide, always-available mute, lights-out brightness slider.
- Confirm-guards on discard/delete; Advanced (web) section exposing previously UI-less settings.

## Performance
- Highway points projected into a view-keyed cache (no per-frame projection at rest; flow + cars share it).
- `arrivalField` memoized per frame (one ENDS scan per plane instead of three).
- Colour ramps converted to LUTs (no per-call gamma pow); `hexRGB`/`seedFor` memoized; photo cache capped.
- Dead config pruned from the Go↔TS contract.

## Known / deferred
- **FIS-B off-air weather** — needs a 978 MHz UAT receiver + dump978 (hardware); not implementable in software.
- **Allocation-free `project()` refactor and TrackStore per-frame object reuse** — flagged by the perf
  audit but deliberately deferred: medium-risk core-primitive changes that can't be validated without the
  live display. The highway cache already captured the dominant allocation win.
- **Post-v3 backlog:** real ferry positions (WSF feed) and light rail / transit detail.
