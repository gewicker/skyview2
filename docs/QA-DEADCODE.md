# SkyView 2 — Dead Code & Pruning Audit

QA pass on `C:\skydeck\skyview2`, focused on orphaned files, unused exports/config
fields, dead branches left by the ferry/rail rewrites, and duplicated helpers. File
contents were read with the Read tool (authoritative); references were verified by
grepping the whole tree. READ-ONLY — no code was modified.

Bottom line: there is **one clean, fully self-contained dead feature** (the synthetic
`VesselLayer`) spanning two source files plus three config fields and one stale UI
write. Everything else is either legitimately in use or low-value cleanup. Findings are
ranked safest-first.

---

## 1. Clearly-safe deletes (synthetic vessel layer — fully orphaned)

The synthetic marine-vessel traffic layer was superseded when the **live WA State
Ferries (WSF)** feed shipped (`FerryLayer`). `Display.tsx:127` literally documents it:
`// live WA State Ferries (WSF) — real boats (deprecated the synthetic VesselLayer)`.
The whole feature is now dead.

| Symbol / file | Evidence it's unused | Recommendation |
|---|---|---|
| `web/src/display/render/VesselLayer.ts` | `VesselLayer` class is **never imported** anywhere. Grep for `VesselLayer` across `web/` returns only its own definition + the deprecation comment in `Display.tsx`. It is not in the `r.use(...)` registry in `Display.tsx` (lines 111–141). | **Delete the file.** |
| `web/src/display/render/vessels.ts` | Exports `LANES`, `lanePeriod`, `laneAt`, `Lane`. Its **only importer is the dead `VesselLayer.ts`** (`import { LANES, lanePeriod, laneAt, type Lane } from "./vessels"`). Once VesselLayer is gone, this has zero importers. | **Delete the file.** |

Both files are internally consistent and import nothing else of value (only `types`,
`aircraftGlyph.shade/softContactShadow`, `colors.RGB`), so deleting them cannot break
another layer. Note: `MarineLayer.ts` is a **different** thing — it's the coastal *fog*
overlay, still registered at `Display.tsx:123` and reading `showMarineLayer` /
`marineLayerIntensity`. **Leave MarineLayer alone** (the audit candidate list grouped it
with vessels, but it is live).

## 2. Dead config fields tied to the vessel layer

With both files above gone, these fields become orphaned (nothing live reads them):

| Field | Where it lives | Who reads it | Recommendation |
|---|---|---|---|
| `showVessels` (Go: `ShowVessels`) | `internal/config/config.go:154`, `shared/types.ts:48` | Only `VesselLayer.draw()` (`f.cfg.showVessels`) — dead once VesselLayer is deleted. | **Delete the field** from `config.go` and `types.ts`. |
| `vesselIntensity` (Go: `VesselIntensity`) | `config.go:155`, default at `config.go:228` (`VesselIntensity: 0.7`), `types.ts:48` | Only `VesselLayer` (`f.cfg.vesselIntensity ?? 0.7`). | **Delete the field + the default line.** |

Safety note: `config.go` structs generate the TS types via `tools/tygo.yaml`, so the Go
struct is the source of truth — drop the two Go fields and regenerate (or hand-match
`types.ts`). Removing persisted config keys is backward-safe here: `migrate.go` unmarshals
onto `Default()` and silently ignores unknown keys (see its comment about dropped keys),
so old `config.json` files carrying `showVessels`/`vesselIntensity` will simply be ignored.

## 3. Stale UI write (vessel preset leftover)

`web/src/control/Control.tsx:135` — the **"Ambient Night preset"** button writes
`showVessels: true, vesselIntensity: 0.6` into the config:

```
showVessels: true, vesselIntensity: 0.6,
```

There is **no dedicated vessel toggle/slider** in the control panel (unlike highways at
Control.tsx:123–128) — grep for `vessel` in `web/src/control/` returns only this one
line. So this preset writes a field that no live layer consumes: a dead write into a dead
field. **Remove that line** from the preset object when you prune the config fields,
otherwise the build will fail to type-check (the field won't exist on `Config`).

---

## 4. Verified NOT dead (audit candidates that are actually live)

Checked the rest of the suspected list and cleared them — call these out so they aren't
mistakenly pruned later:

- **`RAIL_SEGMENTS` vs `RAIL_LINES` (rail.ts)** — *not* duplication. Both are imported and
  used together in `RailLayer.ts:7` (`import { RAIL_SEGMENTS, RAIL_STATIONS, RAIL_LINES }`).
  `RAIL_LINES` is the tunnel-aware polyline used for arc-length train tracking
  (`livetrains.ts:14`, `path.ts`); `RAIL_SEGMENTS` is the above-ground spans used for
  *drawing* the visible line (`RailLayer.ts:52–56`). The header comment documents this split
  intentionally. **Leave both.**
- **Underground-rail "eased-lat/lon" fallback** — *not* dead. `livetrains.ts` and
  `liveferries.ts` keep the raw eased-lat/lon glide as the documented fallback for when a
  vehicle isn't confidently on a line's geometry (`livetrains.ts:10,21`,
  `liveferries.ts:6`). This is a live code path, not a superseded one. **Leave.**
- **`trains.ts` (`simTrains`)** — timetable-simulated trains, still imported by
  `TrainLayer.ts:12` as the fallback when the live OBA feed is unavailable. **Leave.**
- All other render modules (`places`, `night`, `traffic`, `highways`, `seaplane`,
  `notable`, `radar`, `airports`, `tiles`, `carGlyph`, `mercator`, `colors`, `path`, etc.)
  have ≥1 importer — verified by grep. No other orphaned files found in `web/src`.

---

## 5. Duplication (consolidation candidates — low priority, leave unless touched)

Several small geometry/color helpers are re-implemented per-layer. None is a *bug* (each
is correct and file-private), but they're consolidation opportunities. Recommendation:
**leave for now / consolidate opportunistically** — these are tiny and inlined for locality.

- **Haversine / great-circle distance** is implemented ~6 times with slightly different
  units and signatures:
  - `Display.tsx:667` `haversine` (statute miles, nullable)
  - `path.ts:22` `haversine` (file-private, used by `cumulative`)
  - `trains.ts:76` `haversine`
  - `RailLayer.ts:158` `distNMrail` (nautical miles)
  - `traffic.ts:59` `distMi` (statute miles)
  - `SpotlightLayer.ts:252` `distMiles` (statute miles)
  Consolidation: a shared `geo.ts` exporting `haversineMi`/`haversineNm` would replace 4–5
  of these. Caveat: they differ in unit and null-handling, so it's a real (small) refactor,
  not a mechanical merge.
- **`clamp(v, lo, hi)`** is redefined in at least 6 files: `AtmosphereLayer.ts:126`,
  `ProcedureLayer.ts:137`, `SpotlightLayer.ts:222`, `Renderer.ts:273`, `TrackStore.ts:309`
  (+ inline forms elsewhere). Trivially consolidatable into `colors.ts` or a `math.ts`
  util. Lowest-risk of the duplications.
- **Desaturation**: `colors.ts:104` exports a shared `desatRGB` (already used by
  `HighwayLayer`), but `TrainLayer.ts:25` defines its own local `desat` on an `RGB3` tuple.
  Could be unified onto `desatRGB`, modulo the tuple-vs-array type. Note `traffic.ts:102`
  `desatAmount()` is a *different* concept (the ambient "modelled-not-live" amount) and is
  correctly shared — not a dup.
- **Per-id seed hashing**: `AircraftLayer.ts:762` `seedFor(hex)` and `TrainLayer.ts:61`
  `seedNum(id)` are near-identical string→float hashes. Minor; consolidate if a `math.ts`
  is created.
- **`smoothstep`** appears inline in several places (`AircraftLayer.ts:705`,
  `TrailLayer.ts:62`, `FireEmsLayer.ts`) as `t*t*(3-2*t)`. Candidate for a shared util.

---

## Suggested prune order

1. Delete `web/src/display/render/VesselLayer.ts` and `web/src/display/render/vessels.ts`.
2. Remove `showVessels`/`vesselIntensity` (`ShowVessels`/`VesselIntensity` + the default)
   from `internal/config/config.go`; remove the matching `shared/types.ts:48` line (or
   regenerate types).
3. Remove the `showVessels: true, vesselIntensity: 0.6,` line from the Ambient Night preset
   in `web/src/control/Control.tsx:135`.
4. (Optional, later) Consolidate `clamp` and the haversine family into a shared util.

Steps 1–3 are a single coherent removal of one dead feature and should be done together so
the TS build stays green. Step 4 is cosmetic and can wait for a rainy day.
