// Shared current night factor (0 day → 1 full night), published once per frame by the AircraftLayer
// (which already derives it from sun altitude + lightsMode) so the transit layers can dim their
// near-white "presence" cores with the room — the brightest pixels at night shouldn't be the
// transit dots. Read lags the writer by at most one frame, which is imperceptible for a value that
// changes over minutes. See docs/COLOR-PALETTE-DESIGN.md (night section).
let _nf = 0;
export function setNightF(v: number): void { _nf = v; }
export function nightF(): number { return _nf; }

/** Multiplier for a near-white core alpha: full by day, ~0.5 at night so the transit "presence"
 *  cores settle into the dark room and never out-read a distant aircraft (design audit v5). */
export function coreDim(): number { return 0.5 + 0.5 * (1 - _nf); }
