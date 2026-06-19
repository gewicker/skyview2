# SkyView v6 — Backlog

Kickoff backlog for v6 (opened 2026-06-19). Repo `C:\skydeck\skyview2`; deploy via Pi build-on-device.

---

## 1. Airport View — KSEA, headline feature  *(scope locked 2026-06-19)*

A dedicated **airport view** for **KSEA first** (richest diagram data we hold), built to extend to
other fields later. Four coordinated vantages:

- **Top-down, very detailed** — the full field: runways, taxiways, aprons, terminals/buildings,
  hold-short lines, with live aircraft on the surface and in the pattern.
- **Out-the-window 3D perspective** from three vantages — **runway**, **taxi area**, and **tower** —
  i.e. a horizon + foreshortened pavement rendered in perspective, **with live ADS-B traffic placed
  into the scene** (on the runway, taxiing, on approach, in the pattern).

**Decisions locked:** KSEA only to start · out-the-window 3D perspective (not 2.5D/schematic) · real
aircraft from the feed positioned in-scene · this is captured for build later (no code yet).

### Delivery / runtime architecture  *(locked 2026-06-19)*
This experience is **graphically heavy** and will **NOT render on the Pi's IPS kiosk panel**. Instead:

- The **Pi is the host/server only** — it serves the airport-view content (geometry, assets, live
  data feeds) over **HTTP(S)** to a separate **PC or mobile client**, which does all the rendering and
  is where the experience is consumed.
- The rendering/GPU load lives on the **client device**, so the Pi's GPU and the kiosk's render budget
  are **no longer the gate** — this is the opposite of the rest of SkyView (which is built to run
  *on* the Pi kiosk). The airport view is a separate, opt-in client surface, not part of the kiosk
  display loop.
- Practically: it's a distinct **route/page** in the web app (e.g. `/airport`) the kiosk never loads.
  The Pi keeps doing what it already does well — host the SPA + proxy the live feeds (ADS-B, weather,
  etc.). Because the client renders, **WebGL is fully on the table** (the earlier "minimal 2D-canvas
  projection to fit the Pi" worry is moot — design for a capable client GPU instead).
- **HTTP(S):** serving to PC/mobile over the LAN may want a secure context (TLS) — relevant for some
  mobile browser APIs (fullscreen, device orientation, etc.). Decide the cert path (self-signed /
  mkcert / Tailscale / reverse proxy) when we scope the build.

### "All the data we have today" to draw on
- **Field geometry:** `AirportDiagramLayer` (taxiways / aprons / buildings) + `AIRPORTS` runway
  endpoints (`le`/`he` lat-lon) → exact runway/threshold geometry for KSEA.
- **Live traffic:** the `Visible` aircraft set — lat/lon, baro alt, track, ground speed, `onGround`,
  vertical rate, type/registration — already interpolated each frame. Enough to place a contact on a
  runway, on a taxiway, or on final.
- **Approach/physics:** `ApproachLayer` + `arrivalField` (glidepath + alignment) and `ProcedureLayer`
  final-approach vectors → which runway an arrival is using, and where it is on the glide.
- **Lighting/atmosphere:** `NightLightsLayer` (runway/approach lights), `sun.ts` (sky color,
  day/night, sun position), `WindsLayer` + weather/radar → a believable sky + active-runway lighting
  for the perspective scenes.
- **Night/red modes + brightness law + palette** carry over unchanged.

### Open design questions (resolve in a design consult before build)
- Standalone **client route/page** (`/airport`) — confirmed separate from the kiosk loop; what's the
  entry/launch UX from a PC/mobile?
- The perspective engine: **WebGL** (Three.js or raw) on the client — pick the stack and asset
  pipeline. (Client GPU does the work; Pi only serves — see Delivery above.)
- What the **Pi must serve**: static field geometry/assets once + the live ADS-B/weather feeds it
  already proxies, streamed to the client (existing WS/SSE vs. a polled endpoint).
- The HTTP(S)/TLS path for PC/mobile clients on the LAN (cert strategy).
- Vantage placement: tower coords (KSEA tower), a runway-threshold eye point, a taxiway eye point —
  source/define these.
- How aircraft map from lat/lon/alt into each perspective camera (ground vs. airborne handling).
- Camera control / auto-cycling between the three vantages on the client.

### Suggested phasing
*(All on the new client `/airport` surface — reuses SkyView's geometry data + feeds, not the kiosk's
2D layers.)*
1. Detailed **top-down KSEA** on the client (full-fidelity field from the diagram geometry + live
   surface/pattern traffic) — proves the data pipeline Pi→client.
2. A **WebGL perspective camera** prototype (one vantage — tower) with static geometry.
3. **Live traffic into perspective** + the runway and taxi vantages.
4. Sky/lighting/weather polish + vantage cycling.

---

## Carried over from the v5 backlog (still open)
- East Link station gap (#1, owner-run `get-rail-osm.ps1`).
- Schedule-accurate underground rail (#2, needs Link timetable data).
- AIS for all Sound vessels (#4, `aisstream.io` key).
- Fresher Fire/EMS + Eastside coverage (#5, scrape / agency partnership).
- Remaining optimization (#6, low value for an always-on kiosk).
- Data-art batch (#8) + tag v5 / v6 release assets (#9, install `gh`).
- ~~**Bus route reveal redesign**~~ — **DONE 2026-06-19** (pending deploy): rewrote `BusRouteLayer`
  to draw the road ahead only (tapered, speed-keyed dash flow, corridor underglow, headsign
  destination ring) + new `busAhead()` in livebuses. Design in `docs/BUS-ROUTE-DESIGN.md`. Phase-2
  (next-stop beads, GTFS `route_color`) still needs an OBA stops proxy.

**Hardware-blocked:** FIS-B off-air weather (needs a 978 MHz UAT SDR).
