# SkyView 2 — V6 Architecture / Modularity Plan

A read-only architecture plan for the next release. **No code was changed here — this is the
plan.** The product goal (from the owner): the **airport view is now a fork** that will grow
significantly (top-down today; WebGL out-the-window tower/runway/taxi perspectives next — see
`docs/V6-AIRPORT-HANDOFF.md`). He wants modularity so he can *"improve upon the airport fork
independent of the other project without creating defects as features are advanced."*

Two concrete objectives drive every recommendation below:

1. **The airport fork can evolve — including swapping in a WebGL/Three.js engine — without
   touching or regressing the always-on kiosk display.**
2. **Shared code is a stable, well-bounded contract** so a change for one surface doesn't ripple
   across the others.

Everything below is grounded in the current source (file · symbol · approx line). It is
**prioritized, incremental, and low-risk-first** — the shipping kiosk must not be destabilized.

---

## 0. The coupling as it stands today (the problem, grounded)

- **`Renderer` is a shared singleton that statically depends on transit features.**
  `web/src/display/render/Renderer.ts` lines 7–11 import `liveTrains`, `liveBuses`, `liveFerries`,
  `fireIncidents`, and `RAIL_STATIONS` at module top, purely to implement the hit-test helpers
  `pickTransit()` (lines ~186–211) and `onScreenTransit()` (~228–242). `Renderer` is imported by
  **both** surfaces — `web/src/display/Display.tsx` line 4 and `web/src/airport/Airport.tsx`
  line 9 — so the airport bundle drags in `rail.ts`/`highways.ts`/all the live-transit stores it
  never draws (the 672 KB shared chunk; `docs/V6-OPTIMIZATION-PLAN.md` P0-1).

- **The two surfaces are two hand-wired layer stacks over the same `Renderer`.**
  `Display.tsx` registers ~30 layers (lines 130–163); `Airport.tsx` registers 9 (lines 55–63),
  reusing the *display's* layer classes by reaching into `../display/render/*` and synthesizing an
  airport-locked `Config` (lines 40–49). There is no package boundary — the fork is a folder that
  imports up into the kiosk's folder.

- **The `Layer` / `FrameContext` contract is the de-facto coupling surface.**
  `web/src/display/render/types.ts` — `Layer` (lines 70–73) is clean and GL-ready by design
  (a comment even says so). But `FrameContext` (lines 29–66) has grown feature-specific fields:
  `selectedFerryId`, `selectedBusId`, `selectedNavId`, `spotDismissAt`, `featuredHex`, `cardOpen`.
  Every new interactive feature widens this one struct, and it is `import`ed by every layer — so
  the contract ripples.

- **No regression net beyond the single Pi build gate.** `web/package.json` has only
  `dev`/`build`/`preview`/`typecheck` — **no test runner, no test files, no eslint config**
  (confirmed: zero `*.test.*`, no `eslintrc`/`eslint.config.*`). The only gate is
  `tsc -b && vite build` on the Pi. The pure cores worth protecting are untested:
  `mercator.ts` (`llToWorld`/`worldToLL`/`Camera.project`/`unproject`), `path.ts`
  (`cumLen`/`lineLength`/`project`/`posAt`/`advance`), `TrackStore.ts` (the sampler), and
  `notable.ts` (`classifyNotable`, line 60).

- **The data contract is implicit.** `web/src/shared/types.ts` is a hand-written mirror of the Go
  structs (its own header says `make types` will *eventually* generate it). The airport fork's
  Pi→client contract (static field assets + the live WS stream + vantage eye-points,
  per `V6-AIRPORT-HANDOFF.md`) is **described in prose, not encoded as a versioned interface.**

- **The build has no chunk strategy.** `web/vite.config.ts` declares the two MPA entries
  (`display`, `airport`) but sets **no `manualChunks`** and lazy-loads nothing.

---

## 1. Target module map

The aim is a **dependency-inverted** layout: a small, stable **CORE** that knows nothing about any
feature, **FEATURE plugins** that depend only on the core, and two thin **SURFACE** apps that
compose features. Features never import each other; the core never imports a feature; the airport
surface never imports the kiosk surface (and vice versa).

```
                         ┌──────────────────────────────────────────┐
                         │  @shared/contract   (the data contract)   │
                         │  • types.ts (Config, Aircraft, messages)  │  ← generated from Go (`make types`)
                         │  • airport asset schema + version tag     │
                         └──────────────────────────────────────────┘
                                          ▲            ▲
                  (types only, no logic)  │            │
        ┌─────────────────────────────────┴───┐    ┌───┴────────────────────────────────┐
        │  render/core   (NO feature imports)  │    │   surfaces depend down only        │
        │  • mercator.ts  Camera/projection    │    │                                    │
        │  • TrackStore.ts  the sampler        │    │                                    │
        │  • Renderer.ts  loop + interaction   │    │                                    │
        │  • types.ts  Layer + FrameContext    │    │                                    │
        │  • path.ts  arc-length engine        │    │                                    │
        │  • PickRegistry (NEW, injected)      │◄───┤  features register hit-testers     │
        └──────────────────────────────────────┘    │  into the core instead of the      │
            ▲           ▲            ▲               │  core importing the features       │
            │           │            │               └────────────────────────────────────┘
   ┌────────┴───┐ ┌─────┴──────┐ ┌───┴─────────────┐ ┌──────────────────┐ ┌───────────────┐
   │ features/  │ │ features/  │ │ features/transit│ │ features/weather │ │ features/     │
   │ aircraft   │ │ airfield   │ │ rail bus ferry  │ │ radar marine     │ │ airport-3d    │
   │ Aircraft/  │ │ Airports/  │ │ fire + stores + │ │ highway          │ │ (WebGL, fork- │
   │ Trail/     │ │ Approach/  │ │ pick providers  │ │                  │ │  owned, lazy) │
   │ Leader/    │ │ Diagram/   │ │ (rail.ts here)  │ │                  │ │               │
   │ Spotlight/ │ │ NightLights│ │                 │ │                  │ │               │
   │ Notable    │ │ Navaid/Proc│ │                 │ │                  │ │               │
   └────────────┘ └────────────┘ └─────────────────┘ └──────────────────┘ └───────────────┘
            ▲                            ▲                                          ▲
            │                            │                                          │
   ┌────────┴──────────────────┬─────────┴────────────┐         ┌───────────────────┴────────────┐
   │  surfaces/display (KIOSK) │ composes core +       │         │  surfaces/airport (THE FORK)    │
   │  Display.tsx              │ ALL features          │         │  Airport.tsx                    │
   │  (the 30-layer stack)     │                       │         │  composes core + airfield +     │
   └───────────────────────────┴───────────────────────┘         │  aircraft (+ airport-3d, lazy)  │
                                                                  │  NEVER imports transit/weather  │
                                                                  └─────────────────────────────────┘
```

Dependency rule (one direction only): `surfaces → features → render/core → @shared/contract`.
Nothing points back up; no sideways feature↔feature edges; **the two surfaces never import each
other.** The `airport-3d` feature is the only place Three.js is allowed, and it is lazy-loaded so
the kiosk never ships it.

---

## 2. Module boundaries & dependency inversion

### 2.1 Extract a `render/core` that imports no feature
`Renderer.ts`, `mercator.ts`, `TrackStore.ts`, `types.ts`, `path.ts` form the core. The single
illegal edge today is `Renderer.ts` lines 7–11 (transit stores + `RAIL_STATIONS`) used only by
`pickTransit`/`onScreenTransit`. **Invert it** with a registry:

- Add a `HitTestProvider` interface to core `types.ts`:
  ```ts
  export interface HitTestProvider {
    pick(cam: Camera, px: number, py: number, cfg: Config): unknown | null;       // tap → a pick
    stillPresent(cam: Camera, pick: unknown, cfg: Config): boolean;               // for despawn
  }
  ```
- `Renderer` exposes `useHitTester(p: HitTestProvider)` (mirrors the existing `use(layer)` on
  Renderer.ts line 64) and its `pickTransit`/`onScreenTransit` become generic loops over the
  registered providers. The **transit feature** ships a `TransitHitProvider` that closes over
  `liveTrains`/`liveBuses`/`liveFerries`/`fireIncidents`/`RAIL_STATIONS` — so those imports move
  **out of the core and into the feature**. `Display.tsx` registers it; `Airport.tsx` does not.
- Net effect: `Renderer.ts` no longer statically imports any feature; the airport bundle tree-shakes
  rail/highways entirely (this is exactly `V6-OPTIMIZATION-PLAN.md` P0-1 part 1, now framed as the
  architectural cut rather than a perf hack — same edit, two payoffs).

The `TransitPick` discriminated union (Renderer.ts lines 16–21) moves to the transit feature too;
the core's pick type is opaque (`unknown`/a generic `Pick` brand), so adding a new pickable feature
(e.g. an airport-3d ground vehicle) needs zero core change.

### 2.2 Make layers self-contained plugins
Each layer already implements the clean `Layer` interface (`types.ts` 70–73). The work is **moving
files** into `features/<name>/` and fixing imports — no behavioral change. Group by feature, not by
the flat `render/` directory of 60+ files (see §6). A layer may depend on core + its own feature's
data module, and nothing else; an eslint boundary rule (§5.3) enforces it.

### 2.3 Surfaces become thin compositors
`Display.tsx` and `Airport.tsx` keep their role: build a `Renderer`, register a chosen set of
features, own the React/DOM chrome and gesture handling. The airport's synthesized config
(`Airport.tsx` 40–49) is fine as a surface concern. The key rule the new structure enforces:
**`surfaces/airport` may import `render/core` + `features/{aircraft,airfield,airport-3d}` and
NOTHING from `surfaces/display`.** Today `Airport.tsx` reaches into `../display/render/*`; after the
move those layers live in `features/*` that both surfaces may import, so the cross-surface edge is
gone.

---

## 3. Evolving the `Layer` / `FrameContext` contract without rippling

`FrameContext` (`types.ts` 29–66) is the struct every layer imports, so growing it is the main
ripple risk. Three complementary moves, cheapest first:

1. **Keep feature-specific selection state OFF the core context; pass it via per-feature context
   slices.** Today `selectedFerryId`/`selectedBusId`/`selectedNavId`/`spotDismissAt`/`featuredHex`
   live on the core `FrameContext`. Replace them with a typed, namespaced bag the core copies
   through verbatim:
   ```ts
   interface FrameContext {
     ctx; cam; cfg; t; dt; w; h; dpr; aircraft; view; interacting?; cardOpen?;  // the stable core
     feature: Readonly<Record<string, unknown>>;  // per-feature slices, core never reads them
   }
   ```
   The transit feature reads `f.feature.transit?.selectedFerryId`; the navaid feature reads
   `f.feature.nav?.selectedId`. Adding a feature's selection state never touches the core struct or
   any other feature. Each feature ships a tiny typed accessor so call sites stay type-safe.

2. **Grow the core via OPTIONAL fields only, never required ones.** Every field a layer might not
   need stays `?:` (the current convention — keep it). A new optional core field can't break an
   existing layer's `draw(f)`. Required additions are forbidden without a contract version bump.

3. **Capability interfaces for engine swaps.** `Layer.draw(f)` is Canvas2D-specific via
   `ctx: CanvasRenderingContext2D`. For the WebGL airport fork, define a sibling capability rather
   than overloading `Layer`:
   ```ts
   interface GLLayer { readonly name: string; draw(g: GLFrameContext): void; }
   ```
   where `GLFrameContext` shares the **camera/projection + the visible-aircraft set + clock**
   (the parts that must register between 2D and 3D) but carries a `gl`/Three.js scene handle instead
   of `ctx`. `mercator.ts` `Camera` and `TrackStore`'s `Visible[]` are the shared substrate both
   contexts expose — so traffic placement is identical in the top-down and out-the-window views (the
   handoff's "same frame as the geometry so they register" requirement, `V6-AIRPORT-HANDOFF.md`
   phase 3). The Canvas2D `Renderer` and a future `GLRenderer` both consume the same core camera;
   the kiosk never imports the GL path.

**Contract-stability test (cheap, high value):** a `types.contract.test-d.ts` type-level test that
asserts the *core* `FrameContext` keys are exactly the stable set, so a stray feature field added to
the core fails CI loudly (see §5.2).

---

## 4. The Pi → client data contract for the airport fork (explicit + versioned)

Today the contract is prose in `V6-AIRPORT-HANDOFF.md`. Encode it so the fork and the server evolve
independently:

- **One versioned static-asset endpoint.** Implement the handoff's `/api/airport/ksea` as a typed,
  versioned payload in `@shared/contract`:
  ```ts
  export interface AirportAssetV1 {
    schema: "airport-asset";
    version: 1;                 // bump on breaking changes; client checks and degrades gracefully
    icao: "KSEA";
    fieldElevFt: number;        // 433
    runways: RunwayThreshold[]; // from AIRPORTS.KSEA
    diagram: DiagramGeometry;   // the ~5.6k-pt OSM taxiway/apron/building/boundary set
    vantages: { tower: LL; runway: LL; taxi: LL };  // eye-points as DATA, not code (handoff)
    runwayLights?: LightMeta[];
  }
  ```
  Served with far-future cache headers (compounds with `V6-OPTIMIZATION-PLAN.md` P0-2). The Go
  handler and the client both reference the one `AirportAssetV1` type; a `version` mismatch is a
  defined, testable condition, not a silent breakage. This also pins the **KSEA ATCT coord** the
  handoff flags as a hard blocker — it becomes a required field of the schema, so the build can't
  ship without it.
- **Reuse the existing live stream — don't fork the transport.** The airport view already consumes
  `useStream("display")` (`Airport.tsx` line 32) — the same WS `ServerMessage` union in
  `shared/types.ts` (76–82). Keep that as the single live path (handoff: "don't invent a second
  path"); the airport fork applies a **client-side KSEA bbox filter** so the contract surface stays
  one stream. The `TrackStore` sampler is core, so the fork gets smooth motion for free.
- **Generate `shared/types.ts` from Go (`make types`).** The file's own header promises this. Doing
  it now turns the server↔client contract from a hand-synced mirror (drift risk every time a Go
  struct changes) into a generated artifact — the single biggest reduction in cross-surface ripple,
  because *both* surfaces and the Go server then share one source of truth.

---

## 5. Regression safety (beyond the single Pi build gate)

The Pi `tsc -b && vite build` proves it *compiles*, not that the cores still *compute correctly* or
that the boundaries hold. Add a fast, local, zero-deploy net. **None of this ships in the binary**
(dev-only deps), so it can't affect the kiosk runtime.

### 5.1 Unit tests for the pure cores (highest value, lowest risk)
Add **Vitest** (`web/package.json` → `"test": "vitest run"`, `"test:watch": "vitest"`). These cores
are pure functions with no DOM and are exactly what regresses silently:
- `mercator.test.ts` — `llToWorld`/`worldToLL` round-trip within tolerance; `Camera.project`→
  `unproject` round-trip; rotation/mirror invariants; the MAX_LAT clamp. (This is the geometry the
  whole product registers against — `MEMORY` notes "projection verified exact"; lock it with tests.)
- `path.test.ts` — `cumLen` monotonic, `lineLength` == last cumLen, `project`/`posAt` inverse along a
  known polyline, `advance` arc-state stability.
- `trackstore.test.ts` — feed a scripted `ingest()` sequence; assert `sample()` interpolates,
  dead-reckons within bounds, prunes history, and honors the sanity gate (`setCenter`).
- `notable.test.ts` — `classifyNotable` (notable.ts:60) over a table of fixtures (emergency squawk,
  category, etc.) so the upcoming themed-alert work can't silently reclassify.
- `airport-asset.test.ts` — validate a sample `AirportAssetV1` against the schema + version guard.

Target: these run in <1s with no browser. Wire them into `build` as a pre-step locally (NOT on the
Pi — keep the Pi gate as-is to avoid slowing on-device deploys; run tests on the PC before pushing).

### 5.2 Type-level contract tests
Add `vitest`'s `expectTypeOf` (or `tsd`) for:
- The **core** `FrameContext` shape (§3) — fails if a feature field leaks into the core struct.
- `AirportAssetV1` round-trips the server JSON shape.
- The `HitTestProvider`/`GLLayer` capability interfaces stay structurally compatible with `Layer`.

### 5.3 Import-boundary lint rules (enforces the whole §1 map mechanically)
Add **ESLint** + `eslint-plugin-import` (or the `boundaries` plugin) — there is none today. The
rules that make the modularity *real* instead of aspirational:
- `render/core/**` → `no-restricted-imports` of `features/**` and `surfaces/**` (the core stays
  feature-free; this is the rule that would have caught the `Renderer.ts` transit edge).
- `surfaces/airport/**` → forbid importing `surfaces/display/**` **and** `features/transit/**` /
  `features/weather/**` / `features/highway/**` (the fork can't accidentally pull the kiosk's heavy,
  irrelevant code — directly protecting objective #1 and the 672 KB chunk).
- `surfaces/display/**` → forbid importing `features/airport-3d/**` (the kiosk never ships WebGL).
- `features/<a>/**` → forbid importing `features/<b>/**` (no sideways feature coupling).
A failing import is a lint error on the PC, long before the Pi build.

### 5.4 A fast local pre-push step
Add `"check": "tsc -b --noEmit && eslint . && vitest run"` to `web/package.json`. One command,
runs on the PC in seconds, gates a push. The Pi build stays exactly `tsc -b && vite build` (deploy
speed unchanged). Per the `command-blocks-include-cd` + PowerShell-no-`&&` memory, document the
PC-side command block as `cd … ; npm run check` (semicolons, not `&&`).

### 5.5 A keep-alive smoke for both surfaces
A tiny Vitest + jsdom render of `Display` and `Airport` that mounts, feeds one config + a few
aircraft, and asserts no throw / a canvas exists. Catches a broken layer registration before deploy
without needing a Pi.

---

## 6. Folder / package structure

**Recommendation: a single Vite project with a `core/ features/ surfaces/` layout — NOT (yet) a
multi-package workspace.** Rationale: the build is already one Vite → one Go binary, deploy is
build-on-device on a Pi, and there is only one consumer of each module. A pnpm/npm workspace adds
install + path-mapping ceremony for no isolation the eslint boundary rules (§5.3) don't already give
you. Revisit a workspace package **only if** the airport-3d engine grows its own heavy dep tree and
release cadence and you want a separate `package.json`/lockfile for it — at that point promote
`features/airport-3d` to `packages/airport-3d`. Design the folders now so that promotion is a move,
not a rewrite.

Proposed layout (rename/move only — same files):
```
web/src/
  shared/contract/        types.ts (generated), airportAsset.ts, messages
  render/core/            mercator.ts  TrackStore.ts  Renderer.ts  types.ts  path.ts  PickRegistry
  features/
    aircraft/             AircraftLayer TrailLayer LeaderLayer SpotlightLayer NotableLayer
                          RouteLayer HoldingLayer + aircraftGlyph notable colors glyphCache
    airfield/             AirportsLayer AirportDiagramLayer ApproachLayer NavaidLayer
                          ProcedureLayer NightLightsLayer SeaplaneLayer + airports airportDiagram navdata
    transit/              Rail/Train/Bus/Ferry/FireEms layers + live*.ts + rail.ts + transitPick.ts
    weather/              RadarLayer MarineLayer + radar weather
    highway/              HighwayLayer + highways carGlyph traffic
    environment/          AtmosphereLayer WindsLayer PlaceLabelsLayer MapLayer StaticOverlayLayer + sun night tiles places
    airport-3d/           (NEW, lazy) GLRenderer, tower/runway/taxi scenes — fork-owned, Three.js
  surfaces/
    display/              Display.tsx  Control/  (the kiosk)
    airport/              Airport.tsx  main.tsx  (the fork)
  lib/                    useStream connection localConfig  (surface-agnostic plumbing)
```
`@shared` alias already exists in `vite.config.ts` (line 13); add `@core`, `@features` aliases the
same way so moves don't produce deep `../../..` chains.

---

## 7. Bundle / build boundaries

- **Add `manualChunks`** to `vite.config.ts` (currently absent, line 18–23). Split the big
  coordinate blobs (`rail`, `highways`, `airportDiagram`) and `react` into their own chunks so they
  never sit in the first-paint shared chunk (`V6-OPTIMIZATION-PLAN.md` P0-1 part 3 — the floor-effort
  interim that also de-risks the §2.1 decouple by making the chunk graph visible).
- **Lazy-load the heavy + fork-only code.** Once §2.1 cuts the `Renderer`→transit edge, the transit
  geometry can `import()` on first `showRail`/`showHighways` true (P0-1 part 2). The **entire
  `features/airport-3d`** is `await import()`-ed inside `surfaces/airport` only — so Three.js and the
  scene code are in a chunk **only `/airport` ever requests**, and the kiosk's `display` bundle never
  references it. This is the build-level guarantee behind objective #1.
- **Keep the two MPA entries** (`display`, `airport`) — they're correct. The work is the chunking,
  not the entry list.
- **Pair with the Go static handler headers** (`V6-OPTIMIZATION-PLAN.md` P0-2: gzip +
  `Cache-Control: immutable` on hashed assets). A code-split + gzipped + cached chunk graph is the
  full first-paint win; do the header change alongside so the new chunks are served well.

---

## 8. Ordered refactor sequence (smallest safe steps first)

Each step is independently shippable and ordered so the **shipping kiosk is never destabilized**.
Risk is per-step.

| # | Step | Why first / safety | Risk |
|---|------|--------------------|------|
| **1** | **Add the regression net before any refactor.** Vitest + tests for `mercator`/`path`/`TrackStore`/`notable` (§5.1), ESLint with the boundary rules as *warnings* first (§5.3), and the `check` script (§5.4). No source moves. | Pure additive, dev-only, ships nothing to the Pi. Gives you the safety net you need to do steps 2+ confidently. Establishes the baseline the rest is measured against. | **Very low** |
| **2** | **Add `manualChunks` + the Go gzip/Cache-Control headers** (`vite.config.ts`; `V6-OPTIMIZATION-PLAN.md` P0-1 part 3 + P0-2). | Build-config + headers only, no app-code change. Makes the chunk graph visible so step 4's payoff is measurable. Independent, immediate first-paint win. | **Low** |
| **3** | **Fold the contract**: encode `AirportAssetV1` in `@shared/contract` and run `make types` to generate `shared/types.ts` from Go (§4). | Types/codegen only; behavior unchanged. Removes the hand-sync drift risk before features start moving. | **Low** |
| **4** | **Dependency-invert the `Renderer` hit-test** (§2.1): introduce `HitTestProvider` + `useHitTester`, move `pickTransit`/`onScreenTransit`/`TransitPick` + the transit-store imports out of `Renderer.ts` into a `transitPick.ts` the display registers. | The one architectural cut + the biggest perf win (P0-1 part 1). Touches the live hit-test path — **gated by step 1's tests + a manual tap-to-reveal pass on trains/buses/ferries/stations/fire** (the optimization plan's explicit caution). Do it as its own well-tested change. | **Medium** |
| **5** | **Move files into `core/ features/ surfaces/`** (§6) and add `@core`/`@features` aliases. Mechanical; fix imports; flip the eslint boundary rules from warn→error. | Now that step 4 removed the illegal core→feature edge, the directory move is import-fixing only. The lint errors become the proof the map holds. Large diff but zero behavioral change — typecheck + tests + smoke (5.5) catch any miswire. | **Medium** (churn, not logic) |
| **6** | **Split `FrameContext` into core + `feature` slices** (§3.1) and add the type-level contract test (§5.2). | Last because it touches every layer's `draw`. Safe once the cores are tested and layers are grouped — change is local per feature. | **Medium** |
| **7** | **Stand up `features/airport-3d` as a lazy, fork-owned module** with the `GLLayer`/`GLFrameContext` capability (§3.3) and `await import()` from `surfaces/airport` only (§7). | The actual fork-growth enabler. By now the boundaries + lint rules guarantee the kiosk can't pull it. Build the Three.js tower scaffold here (handoff phase 2). | **Low-to-medium** (new, isolated code; can't regress the kiosk by construction) |

After step 5 the owner can advance the airport fork (steps 6–7 and beyond) with the eslint boundary
rules + core unit tests guaranteeing the kiosk can't regress — which is exactly the stated goal.

---

## 9. What to leave alone

- **`TrackStore`, `path.ts`, `MapLayer`, `StaticOverlayLayer`, the Go feeds** — well-built and load-
  bearing (`V6-OPTIMIZATION-PLAN.md` "already optimized"). Wrap them in tests (§5.1), don't rewrite.
- **The MPA entry list** in `vite.config.ts` — correct; only add chunking.
- **The projection** (`mercator.ts`) — verified exact (`MEMORY`/geo-accuracy note); lock with tests,
  never "fix."
- **The Pi deploy command** — keep `tsc -b && vite build && go build`; the new `check` step runs on
  the **PC** before push, not on the Pi (deploy speed unchanged).
```
