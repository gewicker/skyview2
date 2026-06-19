# SkyView 2 — v4 (2026-06-18)

The transit & civic-data release. v4 turns the map from "aircraft over a basemap" into a living
picture of how the region moves: Link light rail (including the underground segments), live Metro /
Sound Transit buses, real Washington State Ferries crossing the Sound, and a live Fire/EMS 911
dispatch layer — all held to the same calm, always-on, aircraft-first vocabulary through a run of
expert design reviews. It also lands an aircraft route-accuracy overhaul and a top-to-bottom color
and motion polish.

## Headline features
- **Link light rail.** GPS/OSM line + stations in a distinct jade, with live train positions from the
  OneBusAway feed and a timetable simulation fallback per line when live is empty (scheduled trains
  stand down the moment a line lights up live).
- **Underground rail that actually works.** The line is stitched into one ordered, tunnel-aware
  polyline; trains are tracked in **arc-length** along it, so when GPS drops in a tunnel (DSTT, Beacon
  Hill, U-District→Northgate) a train keeps gliding on a dimmed "submerged" ghost over a dashed
  subsurface track instead of freezing at the portal, and underground stations bloom correctly.
- **Live buses (OBA).** Metro + Sound Transit vehicles within the home radius as small oriented
  chips, radius-filtered and capped so a busy day never swarms the map.
- **Real WA State Ferries (WSF).** Live vessels drawn as oriented boat hulls with a speed-scaled,
  animated V-wake; GPS-accurate terminals (WSF Terminals API) with dock anchors; tap a ferry to plot
  its departing→arriving crossing lane. The old synthetic vessel layer is retired.
- **Live Fire/EMS 911 layer.** Seattle Fire real-time dispatch (keyless public feed) as subordinate
  ground markers — severity-categorized (fire / medical-aid / vehicle / alarm), drawn under all
  traffic with no glow or white core so an aircraft always wins the eye, auto-expiring, with a gentle
  daytime arrival ripple and tap cards.
- **Transit tap-cards.** Trains, buses, stations, ferries, and incidents are all tappable → a compact
  detail card in the bottom-left "ground context" corner (aircraft keep the privileged top-right).
- **Aircraft route accuracy overhaul.** adsbdb/hexdb baseline + a geometry verifier (swap reversed
  legs, flag uncertain) + a keyed, quota-budgeted AeroDataBox upgrade for nearby commercial flights,
  with provenance marks (confirmed / scheduled / unverified) on the card. Server is the sole
  direction authority.

## Motion & prediction
- **Predictive, smooth transit motion.** Trains estimate their speed from successive fixes and glide
  forward continuously between the ~20 s polls (above ground and through tunnels), corrected gently on
  each poll — no more ease-and-stall. Ferries get the marine version: underway vessels dead-reckon
  along the crossing lane at their reported speed between WSF polls. Both keep a safe fallback to the
  original easing when geometry isn't available.
- A shared arc-length engine (`path.ts`) underpins all of it (unit-tested: round-trips, tunnel flags,
  schedule-paced dead-reckoning).

## Design sweep (expert-driven)
Five design consults shaped this release (docs/ STROBE-INTENSITY, COLOR-PALETTE, UNDERGROUND-RAIL,
FIRE-EMS-DESIGN, FIRE-EMS-VISIBILITY):
- **Calmer aircraft strobe.** The white wingtip strobe is now night-aware (it no longer fires
  full-brightness in a dark room), eased into a soft pulse instead of a hard flash, and density-gated
  to the featured/close aircraft — a busy sky stops crackling, and it stays under the 3-flash/s
  accessibility cap.
- **Color system pass.** Ferry hull gets a dark keyline so it lifts off the teal water; congestion
  "slow" pulled off the home-beacon gold toward orange; climb/descend trails split by lightness (not
  hue alone) for color-blind legibility; the live 1 Line bead brightened above its track; near-white
  transit cores now dim with the room at night; station halo floor lifted.
- **Transit glyphs.** Per-mode silhouettes oriented to heading — Link railcars with a lit window band
  and a calm along-track shimmer, bus chips — replacing plain beads.
- **Fire/EMS as civic texture, not a scanner.** Muted category hues, presence via a solid disc + bold
  dark keyline rather than alarm-red, severity-graded so routine aid calls recede to a soft haze.

## Fixes
- **Card deconfliction.** The transit tap-card no longer stacks on the aircraft card — transit moved
  to bottom-left and the canvas overhead placard is suppressed whenever a DOM card is open.
- **Rail line stitching.** Replaced trusting the OSM relation member order (which drew phantom
  straight chords across the map) with greedy nearest-endpoint chaining + a gap guard; stray
  crossover/siding ways are dropped, not chorded.
- **Fire/EMS empty map.** The public SODA dataset lags real-time 30–60 min, so incidents arrived
  already older than their display lifetime; lifetime is now measured from first sighting and the
  server window widened, so the metro populates.

## Known / deferred
- **Bus route/headsign in the tap card** — needs the OBA `tripId` plumbed through `buses.go` (parsed
  today, then dropped). Queued.
- **Schedule-accurate underground rail** — motion is smooth and tunnel-correct, but paced at a nominal
  speed; a real per-segment Link timetable table (`RailLine.segSec`) would make it schedule-*true*.
- **AIS for all Sound vessels** — the real replacement for the retired synthetic vessel layer
  (aisstream.io websocket, needs a free key).
- **Fresher Fire/EMS feed** — the live `web.seattle.gov` scanner page lags far less than the SODA
  mirror, at the cost of scraping; deferred.
- **FIS-B off-air weather** — needs a 978 MHz UAT receiver (hardware); not implementable in software.
