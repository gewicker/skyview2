// Shared current night factor (0 day → 1 full night), published once per frame by the AircraftLayer
// (which already derives it from sun altitude + lightsMode) so the transit layers can dim their
// near-white "presence" cores with the room — the brightest pixels at night shouldn't be the
// transit dots. Read lags the writer by at most one frame, which is imperceptible for a value that
// changes over minutes. See docs/COLOR-PALETTE-DESIGN.md (night section).
let _nf = 0;
export function setNightF(v: number): void { _nf = v; }
export function nightF(): number { return _nf; }

/** Multiplier for a near-white core alpha: full by day, ~0.45 at full night so the transit
 *  "presence" cores settle into the dark room and never out-read a distant ambient aircraft — whose
 *  strobe is gated off at range, leaving only its steady position lights to carry it (design audit
 *  v5 #1 / design review v6: the floor was 0.5, which let a transit core out-read those lights). */
export function coreDim(): number { return 0.45 + 0.55 * (1 - _nf); }
