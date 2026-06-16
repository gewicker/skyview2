# SkyView 2 — Backlog Checklist

A living checklist. Check items off with `[x]`, add your own under **Ideas**.
Last updated: 2026-06-15.

---

## ▶ Open — remaining v1 parity

- [ ] Stars / sun / moon sky layer (ambient skin) — sun math is ready, needs horizon projection
- [ ] Satellites / ISS overhead passes + TLE proxy endpoint (SGP4 on the Go side)
- [ ] Relative bearing leader-lines (heading leaders from each target)
- [ ] Control-panel depth — scenes save/apply UI, notable feed, and the
      calibration / framing / filters / motion / labels / sky / palette / system sections

## ▶ Open — features I'd recommend

- [ ] "Today" recap — daily tally (count, farthest, highest, rarest, heaviest); pairs with a scheduled morning summary

---

## ✓ Shipped (recent)

- [x] Pre-cache photos for nearest aircraft (instant spotlight card)
- [x] Auto-hide on-screen controls after inactivity
- [x] Cursor visible on web, hidden on Pi kiosk (`?kiosk=1`)
- [x] More radio fields on the card: vertical rate, target altitude, squawk/tail/type
- [x] Autopilot intent line (nav modes / selected heading / QNH)
- [x] Airline + full route on the card
- [x] Clamp `renderScale`/DPR on the Pi kiosk
- [x] Decimate trail history (cap + min-distance)
- [x] Comet-style trails (taper + head node)
- [x] Auto day/night dimming + golden-hour wash (real sun angle)
- [x] Label decluttering + density limit
- [x] Approach awareness — flag aircraft on final + tag the runway
- [x] Notable: heavies + rare/special types
- [x] Static enrichment tables (Seattle-heavy) + `/api/diag`
- [x] Oversize basemap raster (fix zoom-out lag)
- [x] Coarse base tile layer (fix tile pop-in while panning)
- [x] Winds-aloft panel (EHS winds by altitude band)
- [x] Glyph sprite caching (static silhouette cached, props drawn live)
- [x] METAR / weather ribbon (KSEA, via /api/metar proxy)
- [x] Holding-pattern detection (HOLD badge from trail geometry)
- [x] Golden-hour spotlight (warm ring + auto-feature when sun is low)
- [x] Tap info card (rich DOM detail card on select)
- [x] Windows SD-card flasher (flash_skyview.ps1)

---

## ＋ Ideas / add your own

- [ ]
- [ ]
- [ ]
