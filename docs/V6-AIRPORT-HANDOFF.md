# SkyView v6 — Airport View FORK / Handoff

Continuation doc for the **Airport View**, now split off as its own fork so the main v6 release can
focus on bugs / performance / usability / art. Repo: `C:\skydeck\skyview2`. The airport view is a
**client-rendered** surface (web/mobile); the Pi only **hosts** it — the kiosk never renders it.
Deploy = Pi build-on-device (`make pi`). This doc is the single self-contained pickup point.

---

## What this is

A dedicated **airport experience for KSEA** (extensible to other fields later): a detailed top-down
field plus immersive **out-the-window 3D perspectives** from the **tower**, **runway**, and **taxi**
vantages, with **live ADS-B traffic placed into the scene**. Graphically heavy → it runs on a capable
**PC/mobile GPU**, served by the Pi over HTTP(S), NOT on the 1280×800 kiosk panel.

Design rationale + decisions: `docs/AIRPORT-VIEW-DESIGN.md`. Entry affordances:
`docs/AIRPORT-ENTRY-DESIGN.md` (the doorway pill) + `docs/AIRPORT-VIEW-ENTRY-OBJECT-DESIGN.md` (the
new max-zoom tower glyph).

---

## Where it stands (shipped, live on `main`)

**Phase 1 is built and deployed:**
- A **separate Vite entry** `web/airport.html` → `web/src/airport/{main,Airport}.tsx`, built as its
  own bundle (rollup splits shared chunks). Served at **`/airport`** (Go route in `internal/httpd/
  httpd.go`; file server also serves `airport.html`).
- `Airport.tsx` renders a **detailed top-down KSEA** view: reuses the existing `Renderer` + an
  airport-focused layer subset (MapLayer/AirportDiagram/Airports/NightLights/Approach/Trail/Leader/
  Aircraft/Atmosphere), locked to a KSEA frame at field scale (`FIELD_ZOOM = 6`), satellite basemap,
  ground traffic forced on, full client resolution. Consumes the same live aircraft WS stream as the
  kiosk (`useStream("display")`). This proves the Pi→client data pipeline end to end.
- **Entry from the map (the "doorway"):** a discreet pill over KSEA — desktop hover-reveal, touch
  zoom-gated chip (`FIELD_ENTRY_ZOOM = 3`), `!isKiosk`, opens `/airport` in a new tab. In
  `Display.tsx` (`SEA_C`, `Renderer.projectLL`, `airportEntry`, `entryHideTimer` debounce).

---

## The new entry the owner asked for — max-zoom tower glyph  *(designed, NOT built)*

Per `docs/AIRPORT-VIEW-ENTRY-OBJECT-DESIGN.md`:
- **Object:** a small vector **control-tower glyph** (mast + cab + slow-breathing beacon) — it *is*
  the field's watch-point and literally the airport view's establishing camera, so clicking it reads
  as "go look from here," not "a button on a field." (Rejected: medallion/badge, pin, terminal.)
- **Placement:** at the **KSEA ATCT position**, NE apron edge — east/north of the runways, off all
  finals, never over runways or central-apron traffic.
- **Gates:** appears only at/near **max zoom** on KSEA (tie to full field-diagram visibility,
  `pxPerMile ≥ ~SHOW_PXMI`), **web/mobile only** (`!isKiosk`), KSEA only. Purely additive — never
  touches tap/pan/zoom. Hit-test the ~20×22px silhouette only (NOT the pill's 42px radius, which
  would swallow taxi-traffic taps at max zoom).
- **Read/animate:** ~250ms opacity fade-in; only motion is a very slow beacon breath (reduced-motion
  safe); hover-brighten + press-scale; neutral light-on-dark; night-dimmed; below tap-card z-order.
- **Coexistence (recommended):** keep both, split by zoom band — pill = mid-zoom approach hint,
  tower glyph = max-zoom "arrived" entry; suppress the pill in the glyph's band so only one door
  shows.
- **Hard blocker:** the **KSEA ATCT lat/lon is not in the repo** (`airports.ts` has only runway
  thresholds). Pin one FAA-authoritative coord (~`47.4445, -122.3013`) before building; reuse it for
  both the glyph AND the tower camera (phase 2). Interim fallback: offset NE from `SEA_C`.

---

## Remaining build — phases 2–4 (WebGL perspectives)

Engine: **Three.js / WebGL on the client** (client GPU is the budget; Pi GPU no longer the gate).
Keep scenes stylized-minimal (flat pavement, line geometry, billboard/sprite aircraft) to match the
clean-vector aesthetic — no photoreal asset pipeline.

2. **Tower camera scaffold** — Three.js scene, ground plane + runway/taxiway line geometry, the
   **tower** eye-point, static (no traffic yet).
3. **Live traffic into perspective** — map each contact lat/lon/alt → local ENU about a KSEA origin
   (alt = baroAlt − fieldElev, clamp ground to 0; same frame as the geometry so they register),
   orient by `track`, billboard silhouettes; add the **runway** + **taxi** vantages; pick the active
   runway from winds / where arrivals actually go (`arrivalField`/`ApproachLayer`).
4. **Atmosphere + polish** — sky/sun/night via `sun.ts`, wind sock, runway lighting via
   `NightLightsLayer` metadata, vantage auto-cycling + camera controls.

### Data contract (Pi → client)
- **Static field assets (fetch once, cache hard):** runway thresholds + idents + widths from
  `AIRPORTS.KSEA`; the OSM diagram geometry (`AIRPORT_DIAGRAM`, ~5.6k pts: taxiway/apron/building/
  boundary); field elev 433 ft; runway-light metadata. Serve as one static JSON (`/api/airport/ksea`)
  or bundle into the airport build. Far-future cache headers.
- **Live traffic:** reuse the existing WS/SSE aircraft stream (don't invent a second path); filter to
  a KSEA bbox; port the `TrackStore` sampler so motion is smooth client-side.
- **The three vantage eye-points** (tower + a runway-threshold + a taxiway point) live in the asset
  JSON as data, not code — tunable.

---

## Modularity / fork isolation  *(key requirement — see docs/V6-ARCHITECTURE-PLAN.md)*

The fork must be able to advance (incl. swapping in WebGL) **without touching or regressing the
always-on kiosk**, and shared code must be a stable, bounded contract. The architecture plan defines
this; the load-bearing points for whoever takes the fork:
- **Dependency-inverted layout:** `surfaces → features → render/core → @shared/contract`, one
  direction only; the two surfaces (kiosk display, airport) never import each other; **WebGL lives
  only in a lazy `features/airport-3d`** the kiosk never loads.
- **Cut the one illegal edge first:** `Renderer.ts` statically imports the transit stores for
  `pickTransit`/`onScreenTransit`, so the airport bundle drags in rail/highways. Invert it behind an
  injected `HitTestProvider` registry so the core imports no feature (also the 672KB-chunk fix).
- **Stable contracts:** keep per-feature selection state off the core `FrameContext` (namespaced
  slices); a sibling `GLLayer`/`GLFrameContext` shares `mercator.ts` Camera + `TrackStore` `Visible[]`
  so 2D and WebGL traffic register identically; encode the Pi→client data contract as a versioned
  `AirportAssetV1` (with the KSEA ATCT coord as a required field).
- **Regression net BEFORE the cut:** none exists today (only `tsc -b && vite build`). Add Vitest unit
  tests for the pure cores (`mercator`/`path`/`TrackStore`/`notable.classifyNotable`) + ESLint
  import-boundary rules so the fork mechanically cannot import kiosk-only modules. Step 1 of the
  refactor; do it before the `Renderer` inversion.

## Open questions to resolve before/at build start
- **Pin the KSEA ATCT coord** (blocker; FAA-authoritative). Define the runway + taxi eye-points.
- **TLS/cert path** for PC/mobile LAN clients (self-signed / mkcert / Tailscale / reverse proxy) —
  some mobile APIs (fullscreen, device orientation) want a secure context.
- Three.js imperative vs react-three-fiber.
- Whether the client should also be controllable from the kiosk control drawer, or fully
  self-contained.
- How aircraft map into each camera for ground vs airborne (the one real branch).

## Files owned by this fork
`web/airport.html`, `web/src/airport/main.tsx`, `web/src/airport/Airport.tsx`; `Renderer.projectLL`
+ the airport-entry block in `web/src/display/Display.tsx`; the `airport` entry in `web/vite.config.ts`;
the `/airport` route in `internal/httpd/httpd.go`. Designs in `docs/AIRPORT-VIEW-DESIGN.md`,
`docs/AIRPORT-ENTRY-DESIGN.md`, `docs/AIRPORT-VIEW-ENTRY-OBJECT-DESIGN.md`.

**Not in scope for the main v6 release** — the rest of v6 is bugs / performance / usability / art (see
`docs/V6-BUG-PLAN.md`, `docs/V6-OPTIMIZATION-PLAN.md`, `docs/V6-USABILITY-PLAN.md`, `docs/V6-ART-PLAN.md`).
