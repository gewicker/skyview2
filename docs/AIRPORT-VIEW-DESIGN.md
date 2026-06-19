# Airport View — Design Consult (v6 headline)

*Scope is locked in `docs/V6-BACKLOG.md`: KSEA first; a detailed top-down view plus out-the-window
**3D perspective** from the **runway**, **taxi area**, and **tower**, with **live ADS-B traffic placed
in-scene**; **client-rendered** (Pi hosts over HTTP(S), a PC/mobile client does the GPU work — NOT the
kiosk). This consult settles the engine/stack, the Pi→client data contract, the KSEA vantage geometry,
and how aircraft map into each camera.*

---

## 1. Where this lives — a separate client surface, not a kiosk layer

The whole rest of SkyView is built to run *on* the Pi kiosk under a tight GPU budget. The Airport View
inverts that: it is a **standalone web route** (`/airport`) served by the same Go binary, opened from a
**capable PC or phone browser**, never loaded by the kiosk. Consequences that shape every decision
below:

- **The client GPU is the budget.** WebGL is fully on the table. The Pi only serves bytes + a live
  data stream; it does no scene rendering.
- It can be its **own bundle** (a second Vite entry) so the kiosk's `display` bundle stays lean and the
  airport bundle can pull in a 3D stack without bloating the always-on path.
- It is **opt-in and occasional** — so it can be richer and heavier than the ambient map, and it
  doesn't have to obey the kiosk's always-on / burn-in / lights-out rules.

## 2. Engine / stack

**Recommendation: Three.js (WebGL) for the perspective scenes; reuse the existing 2D canvas approach
for the top-down.**

- **Top-down KSEA** is fundamentally what `AirportDiagramLayer` already does (project static world
  geometry, cache, stroke/fill) — just at full fidelity and on its own page with its own camera. Build
  it first in 2D canvas; it proves the **data pipeline** Pi→client with almost no new rendering risk.
- **Perspective (runway/taxi/tower)** wants a real camera, depth, a horizon, and ground-plane
  foreshortening. Hand-rolling a projection is possible but Three.js gives us the perspective camera,
  depth sorting, and lighting for free, and the client GPU can afford it. Keep the scene deliberately
  **stylized-minimal** (flat-shaded pavement, line geometry, sprite/billboard aircraft) — SkyView's
  aesthetic is clean vector, not photoreal, so we get immersion without an asset pipeline.
- **Aircraft as billboards/simple meshes**, not detailed models: a type-scaled silhouette sprite that
  always faces the camera (airborne) or a low-poly shape on the ground. Matches the map's glyph
  language and keeps the asset cost near zero.

*Alternative considered:* raw WebGL / a custom canvas projection — rejected as needless work now that
the Pi GPU constraint is gone. *react-three-fiber* is a fine wrapper if we want the scenes declarative
and React-managed; defer that call to build time.

## 3. The Pi → client data contract

The Pi serves two things; design the seam cleanly so the top-down and all three perspectives consume
**one** shared state.

**(a) Static field assets — fetch once, cache hard.**
- Runway thresholds + idents + width from `AIRPORTS` (`KSEA`): three parallel runways, exact
  `le`/`he` lat-lon already in the repo.
- The OSM diagram geometry (`AIRPORT_DIAGRAM`, ~5.6k pts: taxiway centerlines `k=0`, apron `k=1`,
  building `k=2`, boundary `k=3`).
- Field elevation 433 ft MSL; runway-light metadata already in `airports.ts`.
- Serve as a single static JSON (`/api/airport/ksea`) or bundle it into the airport build. It never
  changes → far-future cache headers.

**(b) Live traffic — stream the set the kiosk already computes.**
- The Pi's feed proxies (readsb/ADS-B) already produce the per-aircraft fields the map uses: lat, lon,
  baro alt, track, ground speed, vertical rate, `onGround`, type/registration, callsign.
- Reuse the **existing WS/SSE** the display uses (don't invent a second path); the airport client
  subscribes to the same aircraft stream and filters to a KSEA-area bbox. Interpolation/smoothing is
  done **client-side** (port the `TrackStore` sampler) so motion is smooth at the client's framerate
  independent of poll cadence.
- Optional enrichment we already have: `arrivalField`/`ApproachLayer` physics tells us *which runway*
  an arrival is using and where it is on the glidepath — gold for placing a contact on short final to
  16C vs 16R.

## 4. KSEA vantage geometry

All three perspective cameras are eye-points in the same world frame as the geometry, looking along a
defined heading. KSEA runs **N–S (16/34)**, so the natural axes are along/across that.

- **Tower vantage.** Eye at the KSEA tower position, ~200 ft AGL, free-look or slow auto-pan across the
  three-runway field. The "establishing" shot. (Source the tower lat-lon/height once — FAA/airport
  data; pin it in the airport asset JSON.)
- **Runway vantage.** Eye near a threshold (e.g. 16L touchdown zone) ~15 ft AGL, looking down the
  centerline — arrivals grow from a dot on final to a flare over the numbers; departures accelerate
  away. Pick the **active runway** from wind (`WindsLayer` data) or from where live arrivals are
  actually going (the approach physics), so the camera faces the live action.
- **Taxi vantage.** Eye ~10 ft AGL on a taxiway near the apron, looking across the movement area —
  ground traffic (`onGround` contacts) holding short, crossing, lining up. Foreground = taxiway/ramp
  geometry from the OSM set.

Eye-points + look-headings live in the airport asset JSON so they're data, not code, and tunable.

## 5. Mapping aircraft into a camera

Per contact, per frame:

1. **World position.** lat/lon → local ENU meters about a KSEA origin (the field reference point);
   altitude = `baroAlt`−`elevFt` for height above field (clamp ground contacts to 0). This same ENU
   frame positions the static geometry, so traffic and pavement register by construction.
2. **Orient** by `track`; pitch from `verticalRate`/`gs` for a touch of climb/descent attitude
   (cosmetic).
3. **Project** through the active perspective camera (Three.js handles it). Billboard the silhouette
   for airborne, low shape for ground.
4. **Cull/scale** by distance; fade contacts beyond the field's visual range so the scene stays calm.
5. **State cues** reuse the map's grammar: arrival vs departure, on-ground vs airborne, recent
   takeoff/landing flourish (we already track `transitGround`/`transitAge`).

Ground vs airborne is the one real branch: `onGround` contacts sit on the pavement (snap altitude to
field elevation, place on nearest taxiway/runway), airborne contacts float at true height.

## 6. Atmosphere (reuses data we hold)

`sun.ts` gives sky color + sun position for time-of-day; `WindsLayer`/weather for a wind sock + which
runway is active; `NightLightsLayer` metadata for runway/approach lighting at night. The perspective
sky is a gradient + sun/moon; nightfall lights the runway edge/centerline strings. No new feeds.

## 7. Phasing (all on the `/airport` client surface)

1. **Top-down KSEA**, 2D canvas, full-fidelity field + live surface/pattern traffic. *Proves the
   Pi→client data contract end-to-end with minimal render risk.*
2. **WebGL perspective scaffold** — Three.js scene, ground plane + runway/taxiway line geometry, the
   **tower** camera, static (no traffic).
3. **Live traffic into perspective** + the **runway** and **taxi** cameras + active-runway selection.
4. **Atmosphere + polish** — sky/sun/night lighting, wind sock, vantage auto-cycling, camera controls.

## 8. Open items to decide at build start

- TLS/cert path for PC/mobile LAN clients (self-signed / mkcert / Tailscale / reverse proxy).
- Second Vite entry (separate `airport` bundle) vs. a lazy route in the existing app.
- Tower eye-point coords + the two ground eye-points — source and pin in the asset JSON.
- react-three-fiber vs. imperative Three.js.
- Whether the client should also be controllable from the kiosk control drawer, or is fully
  self-contained.

**The shape of it:** *the Pi stays the quiet host it already is; a real GPU on a real screen turns the
data we already have into a window onto SeaTac.*
