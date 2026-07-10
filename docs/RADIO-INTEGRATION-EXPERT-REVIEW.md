# Radio Integration — Six-Lens Expert Review (2026-07-09)

Parallel reviews of the dual-SDR / 978 UAT / FIS-B off-air weather integration by six lenses:
RF engineer, artist, scientist, professor, mathematician, computer engineer. Grounded in the actual
code + FIS-B facts. This memorializes findings and a prioritized plan before execution.

State at review: 1090 works great. 978 tunes 978 MHz cleanly on the native `rtl_sdr | dump978 | uat2json`
chain but decodes **zero** UAT frames (proven across both dongles + both software paths; `PLL not locked`
confirmed benign). Off-air NEXRAD pipeline built + dormant-safe. The reception "test" so far: ~25 s, indoors.

---

## The one thing everyone agrees on

**The 978 silence is almost certainly line-of-sight / antenna placement, not hardware or software.**
FIS-B ground-station uplink is a *continuous* broadcast — if any station is within radio LOS you hear
frames within seconds. Zero uplink in a short **indoor** test is expected and proves nothing. FAA guidance:
FIS-B "will usually not be available until airborne." So judge 978 reception on **FIS-B uplink frames**,
never on aircraft count (UAT air traffic near a 1090-dominant Class B is genuinely sparse).

Decisive, free tests before spending another dollar or hour:
1. **Positive control** — run `dump1090` on the *978 dongle + its antenna + its coax* at 1090 MHz. If it
   hears planes, the entire RF chain (dongle/cable/connector/antenna/USB) is proven good, and the problem
   is placement/coverage, not hardware.
2. **Outdoor / elevated listen, 2–3+ min** — same `rtl_sdr … | dump978 | uat2text`, antenna outside with
   sky view toward the horizon. Frames outdoors but not indoors ⇒ LOS was the answer.

**No-go criterion (avoid sunk cost):** if the positive control passes AND an elevated/outdoor antenna
(gain + PPM swept) yields **zero uplink across a full 30-min daytime window on two days** AND the GBT tower
database shows no station within ~40 nm LOS → 978 FIS-B isn't receivable here; stop investing and repurpose
the second dongle.

---

## RF engineer

- Software chain is textbook-correct (canonical mutability invocation, right sample rate). This is a
  signal-presence problem. 978 is inherently **low-yield at a fixed low/indoor location, ~zero indoors**.
- Ranked causes: (1) no LOS to a FIS-B ground station / airborne UAT; (2) sparse UAT traffic; (3) antenna
  placement/band (a 1090 antenna at 978 is only ~1 dB off — minor); (4) gain too high → urban overload;
  (5) cable/connector loss; (6) PPM/sample-rate — ruled out.
- Fixes ranked by cost/impact: **free diagnostics** (`rtl_power` sweep + outdoor listen + gain sweep
  `49.6/48/44.5/40.2/33.8/29.7`) → **placement outdoors/attic** (biggest win) → **tuned 978 antenna**
  (¼-wave ≈ **73–75 mm** radiator + four 75 mm radials) → **978 SAW/FM-trap filter** (only if overload) →
  **mast LNA + bias-tee** (outdoor runs only).
- **Best alternative use of the 2nd dongle if 978 stays low-yield: local MLAT** via an ADS-B feeder +
  `mlat-client` — returns positions for non-ADS-B (Mode-S-only) aircraft into a local `aircraft.json` you
  merge exactly like the :8081 UAT feed. Directly makes the map busier — the highest-value "alive" upgrade.
  Runners-up: 2nd 1090 antenna for coverage infill; ACARS (VHF ~131 MHz) as a calm text ticker.
- Keep as-is: the native chain, serial binding, additive/fail-safe service design, FIS-B-as-reception-proof.

## Scientist

- The 25 s / indoor / single-gain / no-control test is uninterpretable (no positive control). Provided a
  falsifiable design: H1 dead chain, H2 no LOS, H3 gain/overload, H4 no traffic — each with the exact
  measurement that confirms/refutes it.
- Concrete Pi procedures: positive control (dump1090 on the 978 chain), `rtl_power` floor/interference
  sweep (NOT a reliable FIS-B detector — bursty TDMA averages out), a **10-min timed uplink-frame count**
  as the definitive presence test, gain+PPM sweeps, per-minute longitudinal logging.
- Statistics: for continuous uplink, **2 min of zero ⇒ no in-range GBT** (10 min removes all doubt); for
  sparse downlink use the rule-of-three and don't judge reception on it.
- Radio horizon math: indoor ~15 ft antenna ≈ 17 mi *theoretical* horizon before walls/hills gut it at
  978 MHz; rooftop clears near-field obstructions. Cross-check nearest GBT via towers.stratux.me.
- Replace `install-978.sh`'s built-in 25 s verify step with the positive-control + timed-uplink test; and
  measure PPM once (wrapper defaults `UAT_PPM=0`, never measured).

## Artist

- **Biggest issue: two color languages.** The decoder bakes a warm NWS rainbow (green→yellow→orange→red→
  magenta) at full alpha; the online radar uses cool "Universal Blue." Every reception gap flips the whole
  palette family, and warm saturated precip fights "aircraft are brightest" + breaks red/lightsout modes.
- **Fix (architectural): decoder emits an intensity-INDEXED raster; client applies the palette per night
  mode** (day/night/red/lightsout) at draw time. Recommended cool, calm ramp reserving warmth only for the
  heaviest cells; `radarOpacity` 0.45 night / 0.55 day; red mode = red-luminance only; lightsout = suppress
  or ghost ≥ level 5 only.
- **Make blocky data look intentional:** Gaussian-blur (~1.5 px on a 2× supersample) in the decoder +
  `imageSmoothingQuality="high"` client-side. **No dither/grain** (shimmer on a dark panel).
- **Off-air path currently hard-cuts** (frame swap + source switch) — calm-critical gap. Add crossfades
  (~1.2 s new frame, ~1.5–2 s source switch), **stale-dim** the last off-air frame as it ages before
  falling back, and **hysteresis** (adopt/abandon over ≥2 polls) so it can't flap near the 600 s threshold.
- Off-air vs online signature: one **dim static status word** (`off-air · 3 min` / `online` / `stale`) plus
  a soft feathered coverage-edge on the off-air box. No badges, no blinking, no warmth-as-signal.

## Professor

- 1090-vs-978 model is clean. **The `~` (non-ICAO) drop is correct behavior but the comment mis-frames it:**
  ADS-R targets carry the *real* ICAO hex (dedupe naturally); the `~` records are anonymous TIS-B/ADS-R —
  fine to drop, but TIS-B ≠ "shadow of an airframe you already have." Reframe the comment; note the Pi only
  *overhears* client-keyed uplinks (it's not a TIS-B/ADS-R client).
- **FIS-B carries far more than NEXRAD, all already decoded by `uat2text`.** Ranked for a calm display:
  **(1) nearest-station METAR (KSEA) — highest value/effort**, one glanceable line refreshing ~1 min,
  perfect partner to the radar; (2) TAF; (3) PIREPs (charming but ephemeral → faded map note); (4) SIGMET/
  AIRMET; (5) TFRs as polygons. Skip winds-aloft tables, NOTAMs, SUA status (clutter).
- **The display's unique lesson is the physicality of radio** — "this weather came over the air, no
  internet." Cheapest deepeners: a **"received by radio from ~N mi" provenance line**, the METAR line, and
  the 1090/978 source cue on contacts.
- **Stale docs:** `DUAL-SDR-978.md` still recommends the known-broken `dump978-fa`/SoapySDR path and has a
  serial contradiction (`0000xxxx` vs the real `95371368`/`53037501`); `DUAL-RADIO-BUILD-PLAN.md` Phase 0-1
  is superseded by the native chain. Fix these.

## Mathematician

- Block/bin geometry correct for the Seattle (<60°N) case: arcmin→deg, west 0–360 fold, `height/4`,
  `width/32`, `row=i//32` (north→south), `col=i%32` (west→east).
- **Equirectangular→Mercator affine error:** horizontal is exact; vertical interior rows are linear-in-lat
  vs Mercator's nonlinear ordinate. Over the 3.5°-tall box: peak ≈ **3.3 km ≈ ~7 px** near mid-latitude
  (zero at edges). ~One bin — tolerable for coarse translucent precip, but **grows quadratically**: enabling
  `kinds=conus` or a tall `--bounds` explodes it (~150 km for a 24° band). **Cheap fix: compute the PNG's
  pixel-y from Mercator m(φ) in the adapter** (client affine then becomes exact). Mandatory before CONUS.
- **`product_time_ms` only rolls back, never forward** → a narrow post-midnight window with negative clock
  skew (off-air ⇒ no NTP) can date a fresh product ~24 h stale. Fix: pick nearest of yesterday/today/tomorrow.
- **Verify (needs a live asymmetric block): intra-block bin N/S + E/W ordering** — a symmetric synthetic
  test can't catch a within-block mirror (~5 km). Also confirm `extract_nexrad`'s `width_am` already folds
  the ≥60°N scale (adapter ignores the `scale` field; moot for Seattle).
- Resolution is over-sampled (no detail lost, no aliasing). Bin-fill 0.5 px overlap negligible.

## Computer engineer

- **P0 bug: `tee --output-error=warn` defeats the fail-fast restart.** GNU tee's default exits on a dead
  consumer (→ SIGPIPE → pipeline collapses → `pipefail`+`Restart=always` recover in ~5 s). `warn` overrides
  that: if `uat2json` or the adapter dies, the unit stays `active` while output silently stops — no restart.
  Doubly hidden on the traffic branch (process-sub isn't covered by `pipefail`; its stderr is sent to
  `/dev/null`). **Fix: drop `--output-error=warn` and the `uat2json` stderr suppression** (a 5 s blip on a
  calm box is fine; traffic + weather recover together). Blast radius is only the 978 subsystem (1090 is a
  separate service), so it's P0-for-subsystem / P1-overall.
- P1: wrap the Python **main stdin loop** in try/except (a parse crash stalls the whole pipe); prefer
  **CPUAffinity** pinning the DSP chain (leave cores for chromium/Go) over bare `Nice`; **retire the :8081
  `http.server`** (single-threaded, binds 0.0.0.0) — have Go `os.ReadFile` the tmpfs `aircraft.json` like
  `wxradar.go` already does (or at minimum `--bind 127.0.0.1`); add **StartLimit backoff**; add a
  **pytest** for `parse_line` + bin geometry + `product_time_ms`.
- P2: the `render_and_write` dict is iterated partly outside the lock (self-limiting — writer try/except
  catches the rare `dict changed size`); capture items under the lock. UAT contacts lack `seen_pos` (rely on
  uat2json pruning — watch for phantoms). Serial-vs-index binding works only because the serials exceed the
  device count — worth a comment.
- Keep as-is: the `nexrad.png`/`json` contract seam + `wxradar.go` decoupling, tmpfs for churn files, the
  `readsb.go` legacy-field fallback, the stage-1 traffic-only pipeline, writer-thread try/except.

---

## Unified prioritized plan

**Batch A — safe correctness/robustness fixes (no live signal needed, ship now):**
1. Drop `tee --output-error=warn` + the `uat2json` stderr suppression (P0 restart bug).
2. Guard the adapter's stdin loop; capture render items under the lock; add StartLimit backoff.
3. Mercator pixel-y in the adapter (kills the projection error; unblocks CONUS) + `product_time_ms` nearest.
4. Retire/localhost-bind the :8081 server (prefer Go direct file read).
5. Add a pytest for the adapter (parse + geometry + time).
6. Doc fixes: invert the SoapySDR recommendation, reconcile serials, header the superseded build-plan phases;
   reframe the `~`/TIS-B comment.

**Batch B — reception diagnostics (George at the Pi, free):** replace the 25 s verify with the positive
control + timed uplink count; outdoor/elevated listen; gain+PPM sweep; decide go/no-go by the criterion above.

**Batch C — features (larger, some need live signal to see):** nearest-KSEA **METAR line** (highest-value
FIS-B add) + provenance status; artist weather rework (intensity-indexed raster + per-night-mode palette,
Gaussian softening, off-air crossfade/stale-dim/hysteresis); 1090/978 source cue on contacts.

**Batch D — strategic:** if 978 proves low-yield here, repurpose the 2nd dongle for **local MLAT** (best
"more aircraft" value) — reuses the existing merge architecture.
