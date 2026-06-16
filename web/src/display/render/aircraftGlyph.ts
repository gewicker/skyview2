// Type-aware aircraft glyphs drawn as recognizable top-view silhouettes: tapered
// fuselages, swept/tapered wings, separate tailplanes + engine nacelles, spinning
// props/rotors. Classified from the ICAO type code with emitter-category fallbacks.
// Ported from v1. NO shadowBlur (brutal in software rendering on the Pi); the halo
// is the caller's job. Each component fills separately so overlaps union cleanly.
import type { Aircraft } from "@shared/types";

export type GlyphKind =
  | "light" | "turboprop" | "bizjet" | "airliner"
  | "widebody" | "quadjet" | "fighter" | "helicopter";

export const GLYPH_SCALE: Record<GlyphKind, number> = {
  light: 0.62, turboprop: 0.86, bizjet: 0.8, airliner: 1.0,
  widebody: 1.3, quadjet: 1.46, fighter: 0.72, helicopter: 0.82,
};

const HELI = new Set([
  "EC20", "EC25", "EC30", "EC35", "EC45", "EC55", "AS50", "AS55", "AS65", "AS32",
  "A109", "A119", "A139", "A169", "A189", "B06", "B06T", "B407", "B412", "B427",
  "B429", "B430", "B505", "S76", "S92", "S61", "S64", "H60", "H500", "MD52",
  "MD60", "R22", "R44", "R66", "EXEC", "EXPL", "GAZL", "LYNX", "NH90", "PUMA",
  "SCAV", "UH1", "B105", "B212", "B214", "B222", "AC", "H47", "H64",
]);
const QUAD = new Set([
  "B741", "B742", "B743", "B744", "B748", "B74S", "B74R", "B74D", "A388", "A342",
  "A343", "A345", "A346", "A124", "C5M", "A225", "IL96", "B52", "A140",
]);
const WIDE = new Set([
  "A306", "A30B", "A310", "A332", "A333", "A338", "A339", "A359", "A35K", "B762",
  "B763", "B764", "B772", "B77L", "B773", "B77W", "B778", "B779", "B788", "B789",
  "B78X", "MD11", "IL86", "DC10", "L101", "A337", "B767", "B777", "B787",
]);
const TPROP = new Set([
  "DH8A", "DH8B", "DH8C", "DH8D", "AT43", "AT44", "AT45", "AT46", "AT72", "AT73",
  "AT75", "AT76", "SF34", "SB20", "SW3", "SW4", "E110", "E120", "C208", "C212",
  "C408", "PC12", "B190", "BE20", "B350", "B300", "JS31", "JS32", "JS41", "D228",
  "D328", "F50", "F27", "ATP", "TBM7", "TBM8", "TBM9", "TBM0", "PC6", "C441",
  "C425", "DHC6", "DHC7", "C130", "AN12", "AN26", "AN32", "SH36", "CVLT", "SAAB",
]);
const LIGHT = new Set([
  "C150", "C152", "C162", "C172", "C72R", "C175", "C177", "C180", "C182", "C185",
  "C188", "C206", "C207", "C210", "C310", "C337", "SR20", "SR22", "S22T", "PA18",
  "PA24", "PA28", "P28A", "P28B", "P28R", "PA32", "P32R", "PA34", "PA38", "PA44",
  "PA46", "DA20", "DA40", "DA42", "DA62", "BE33", "BE35", "BE36", "BE58", "BE76",
  "BE19", "BE23", "BE24", "M20P", "M20T", "AA1", "AA5", "GLAS", "COL4", "RV4",
  "RV6", "RV7", "RV8", "RV9", "RV10", "RV14", "GA8", "G115", "BL8", "CH7", "SF50",
]);
const FIGHTER = new Set([
  "F16", "F18", "FA18", "F15", "F22", "F35", "F14", "F4", "F5", "A10", "AV8B",
  "EUFI", "TYPH", "RFAL", "JAS39", "GRIP", "GR4", "TOR", "TORN", "M2000", "MIR2",
  "SU27", "SU30", "SU33", "SU34", "SU35", "SU57", "MG29", "MG31", "MG21", "J10",
  "J11", "J20", "T38", "T50", "L39", "L159", "HAWK", "YK130", "JF17", "KFIR",
]);
const BIZJET = new Set([
  "LJ31", "LJ35", "LJ40", "LJ45", "LJ55", "LJ60", "LJ70", "LJ75", "LJ85",
  "C25A", "C25B", "C25C", "C25M", "C500", "C501", "C510", "C525", "C526", "C550",
  "C551", "C555", "C560", "C56X", "C650", "C680", "C68A", "C700", "C750",
  "CL30", "CL35", "CL60", "GLF3", "GLF4", "GLF5", "GLF6", "GLEX", "G150", "G280",
  "GALX", "F2TH", "FA50", "F900", "FA7X", "FA8X", "E50P", "E55P", "PHEN", "H25B",
  "HDJT", "BE40", "PRM1", "HA4T", "EA50",
]);

export function classifyGlyph(ac: Aircraft): GlyphKind {
  const code = (ac.typeCode || "").toUpperCase();
  const cat = ac.category;
  if (cat === "A7" || HELI.has(code)) return "helicopter";
  if (FIGHTER.has(code)) return "fighter";
  if (QUAD.has(code)) return "quadjet";
  if (WIDE.has(code) || cat === "A5") return "widebody";
  if (BIZJET.has(code)) return "bizjet";
  if (TPROP.has(code)) return "turboprop";
  if (LIGHT.has(code) || cat === "A1") return "light";
  return "airliner";
}

type RGB = [number, number, number];
const col = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

interface JetParams {
  nose: number; tail: number; halfW: number; wingY: number; wingSpan: number;
  wingSweep: number; rootChord: number; tipChord: number; stabY: number;
  stabSpan: number; stabSweep: number; stabChord: number;
}
const JET_AIRLINER: JetParams = { nose: -1.05, tail: 1.08, halfW: 0.1, wingY: -0.04, wingSpan: 1.0, wingSweep: 0.42, rootChord: 0.34, tipChord: 0.1, stabY: 0.84, stabSpan: 0.42, stabSweep: 0.16, stabChord: 0.12 };
const JET_WIDE: JetParams = { nose: -1.2, tail: 1.14, halfW: 0.13, wingY: -0.04, wingSpan: 1.22, wingSweep: 0.5, rootChord: 0.46, tipChord: 0.12, stabY: 0.86, stabSpan: 0.52, stabSweep: 0.2, stabChord: 0.15 };
const JET_QUAD: JetParams = { nose: -1.24, tail: 1.16, halfW: 0.13, wingY: -0.04, wingSpan: 1.26, wingSweep: 0.54, rootChord: 0.48, tipChord: 0.12, stabY: 0.88, stabSpan: 0.54, stabSweep: 0.22, stabChord: 0.15 };
const JET_TPROP: JetParams = { nose: -1.0, tail: 0.98, halfW: 0.11, wingY: -0.06, wingSpan: 1.04, wingSweep: 0.1, rootChord: 0.3, tipChord: 0.17, stabY: 0.78, stabSpan: 0.44, stabSweep: 0.05, stabChord: 0.14 };
const JET_BIZJET: JetParams = { nose: -1.0, tail: 0.96, halfW: 0.085, wingY: 0.12, wingSpan: 0.8, wingSweep: 0.28, rootChord: 0.2, tipChord: 0.07, stabY: 0.8, stabSpan: 0.48, stabSweep: 0.08, stabChord: 0.1 };

// The static silhouette (everything except spinning props/rotors). This is what gets
// cached into a sprite — see glyphCache.ts.
export function drawGlyphStatic(ctx: CanvasRenderingContext2D, kind: GlyphKind, s: number, color: RGB, alpha: number): void {
  ctx.shadowBlur = 0;
  const fill = col(color, Math.min(1, alpha * 1.08));
  switch (kind) {
    case "widebody":
      jetSilhouette(ctx, s, JET_WIDE, fill);
      engines(ctx, s, fill, JET_WIDE.wingY + 0.3, [0.46]);
      core(ctx, s, alpha, 0.1);
      break;
    case "quadjet":
      jetSilhouette(ctx, s, JET_QUAD, fill);
      engines(ctx, s, fill, JET_QUAD.wingY + 0.32, [0.34, 0.62]);
      core(ctx, s, alpha, 0.1);
      break;
    case "turboprop":
      jetSilhouette(ctx, s, JET_TPROP, fill);
      core(ctx, s, alpha, 0.09);
      break;
    case "bizjet":
      jetSilhouette(ctx, s, JET_BIZJET, fill);
      ctx.beginPath();
      for (const sign of [-1, 1]) {
        ctx.moveTo(sign * 0.17 * s + 0.06 * s, 0.5 * s);
        ctx.ellipse(sign * 0.17 * s, 0.5 * s, 0.06 * s, 0.13 * s, 0, 0, Math.PI * 2);
      }
      ctx.fillStyle = fill;
      ctx.fill();
      core(ctx, s, alpha, 0.08);
      break;
    case "fighter":
      fighterBody(ctx, s, fill);
      core(ctx, s, alpha, 0.08);
      ctx.fillStyle = col([255, 196, 130], 0.55 * alpha);
      ctx.beginPath();
      ctx.arc(0, 1.0 * s, s * 0.11, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "light":
      lightBody(ctx, s, fill);
      break;
    case "helicopter":
      heliBody(ctx, s, fill);
      break;
    case "airliner":
    default:
      jetSilhouette(ctx, s, JET_AIRLINER, fill);
      engines(ctx, s, fill, JET_AIRLINER.wingY + 0.28, [0.4]);
      core(ctx, s, alpha, 0.1);
      break;
  }
}

// The animated parts (props/rotors) — drawn live on top of the cached sprite.
export function drawGlyphSpinners(ctx: CanvasRenderingContext2D, kind: GlyphKind, s: number, color: RGB, alpha: number, t: number, seed: number): void {
  switch (kind) {
    case "turboprop":
      propDisc(ctx, -0.5 * s, (JET_TPROP.wingY + 0.08) * s, 0.26 * s, color, alpha, t * 9 + seed);
      propDisc(ctx, 0.5 * s, (JET_TPROP.wingY + 0.08) * s, 0.26 * s, color, alpha, -t * 9 + seed, true);
      break;
    case "light":
      propDisc(ctx, 0, -0.92 * s, 0.34 * s, color, alpha, t * 11 + seed);
      break;
    case "helicopter":
      propDisc(ctx, 0.04 * s, 1.18 * s, 0.22 * s, color, alpha, t * 16 + seed, false, 2);
      mainRotor(ctx, s, color, alpha, t * 6 + seed);
      break;
  }
}

// Convenience: full glyph (static + spinners) in one call. Used where caching isn't
// worth it; the hot path (AircraftLayer) uses the cached sprite + spinners directly.
export function drawAircraftGlyph(ctx: CanvasRenderingContext2D, kind: GlyphKind, s: number, color: RGB, alpha: number, t: number, seed: number): void {
  drawGlyphStatic(ctx, kind, s, color, alpha);
  drawGlyphSpinners(ctx, kind, s, color, alpha, t, seed);
}

/** True for kinds that have animated rotors/props worth drawing live. */
export function hasSpinners(kind: GlyphKind): boolean {
  return kind === "turboprop" || kind === "light" || kind === "helicopter";
}

function fuselage(ctx: CanvasRenderingContext2D, s: number, p: JetParams): void {
  const L = p.tail - p.nose;
  const w = p.halfW * s, yN = p.nose * s, yT = p.tail * s;
  const y1 = (p.nose + 0.22 * L) * s, y2 = (p.nose + 0.82 * L) * s;
  ctx.beginPath();
  ctx.moveTo(0, yN);
  ctx.quadraticCurveTo(w, yN, w, y1);
  ctx.lineTo(w, y2);
  ctx.quadraticCurveTo(w, yT, w * 0.2, yT);
  ctx.lineTo(-w * 0.2, yT);
  ctx.quadraticCurveTo(-w, yT, -w, y2);
  ctx.lineTo(-w, y1);
  ctx.quadraticCurveTo(-w, yN, 0, yN);
  ctx.closePath();
}

function planform(ctx: CanvasRenderingContext2D, s: number, sign: number, rootY: number, span: number, sweep: number, rootChord: number, tipChord: number, rootX: number): void {
  const x0 = sign * rootX * s, xt = sign * span * s;
  ctx.moveTo(x0, rootY * s);
  ctx.lineTo(xt, (rootY + sweep) * s);
  ctx.lineTo(sign * span * 0.95 * s, (rootY + sweep + tipChord) * s);
  ctx.lineTo(x0, (rootY + rootChord) * s);
  ctx.closePath();
}

function jetSilhouette(ctx: CanvasRenderingContext2D, s: number, p: JetParams, fill: string): void {
  ctx.fillStyle = fill;
  fuselage(ctx, s, p);
  ctx.fill();
  ctx.beginPath();
  for (const sign of [-1, 1]) planform(ctx, s, sign, p.wingY, p.wingSpan, p.wingSweep, p.rootChord, p.tipChord, p.halfW * 0.85);
  for (const sign of [-1, 1]) planform(ctx, s, sign, p.stabY, p.stabSpan, p.stabSweep, p.stabChord, p.stabChord, p.halfW * 0.6);
  ctx.moveTo(-0.045 * s, p.stabY * s);
  ctx.lineTo(0.045 * s, p.stabY * s);
  ctx.lineTo(0, (p.tail + 0.03) * s);
  ctx.closePath();
  ctx.fill();
}

function engines(ctx: CanvasRenderingContext2D, s: number, fill: string, ey: number, xs: number[]): void {
  ctx.beginPath();
  for (const ex of xs) for (const sign of [-1, 1]) {
    ctx.moveTo(sign * ex * s + 0.075 * s, ey * s);
    ctx.ellipse(sign * ex * s, ey * s, 0.075 * s, 0.15 * s, 0, 0, Math.PI * 2);
  }
  ctx.fillStyle = fill;
  ctx.fill();
}

function lightBody(ctx: CanvasRenderingContext2D, s: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(0, -0.92 * s);
  ctx.quadraticCurveTo(0.1 * s, -0.9 * s, 0.1 * s, -0.5 * s);
  ctx.lineTo(0.08 * s, 0.66 * s);
  ctx.quadraticCurveTo(0.07 * s, 0.95 * s, 0, 0.95 * s);
  ctx.quadraticCurveTo(-0.07 * s, 0.95 * s, -0.08 * s, 0.66 * s);
  ctx.lineTo(-0.1 * s, -0.5 * s);
  ctx.quadraticCurveTo(-0.1 * s, -0.9 * s, 0, -0.92 * s);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-0.09 * s, -0.5 * s); ctx.lineTo(-1.05 * s, -0.42 * s); ctx.lineTo(-1.05 * s, -0.26 * s);
  ctx.lineTo(-0.09 * s, -0.2 * s); ctx.lineTo(0.09 * s, -0.2 * s); ctx.lineTo(1.05 * s, -0.26 * s);
  ctx.lineTo(1.05 * s, -0.42 * s); ctx.lineTo(0.09 * s, -0.5 * s); ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-0.07 * s, 0.6 * s); ctx.lineTo(-0.46 * s, 0.76 * s); ctx.lineTo(-0.46 * s, 0.86 * s);
  ctx.lineTo(-0.07 * s, 0.74 * s); ctx.lineTo(0.07 * s, 0.74 * s); ctx.lineTo(0.46 * s, 0.86 * s);
  ctx.lineTo(0.46 * s, 0.76 * s); ctx.lineTo(0.07 * s, 0.6 * s); ctx.closePath();
  ctx.fill();
}

function fighterBody(ctx: CanvasRenderingContext2D, s: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(0, -1.15 * s); ctx.lineTo(0.09 * s, -0.55 * s); ctx.lineTo(0.16 * s, -0.12 * s);
  ctx.lineTo(0.95 * s, 0.46 * s); ctx.lineTo(0.9 * s, 0.6 * s); ctx.lineTo(0.2 * s, 0.6 * s);
  ctx.lineTo(0.3 * s, 1.0 * s); ctx.lineTo(0.08 * s, 1.0 * s); ctx.lineTo(0.06 * s, 0.64 * s);
  ctx.lineTo(-0.06 * s, 0.64 * s); ctx.lineTo(-0.08 * s, 1.0 * s); ctx.lineTo(-0.3 * s, 1.0 * s);
  ctx.lineTo(-0.2 * s, 0.6 * s); ctx.lineTo(-0.9 * s, 0.6 * s); ctx.lineTo(-0.95 * s, 0.46 * s);
  ctx.lineTo(-0.16 * s, -0.12 * s); ctx.lineTo(-0.09 * s, -0.55 * s); ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0.07 * s, 0.66 * s); ctx.lineTo(0.27 * s, 0.92 * s); ctx.lineTo(0.33 * s, 0.88 * s); ctx.lineTo(0.11 * s, 0.62 * s); ctx.closePath();
  ctx.moveTo(-0.07 * s, 0.66 * s); ctx.lineTo(-0.27 * s, 0.92 * s); ctx.lineTo(-0.33 * s, 0.88 * s); ctx.lineTo(-0.11 * s, 0.62 * s); ctx.closePath();
  ctx.fill();
}

function heliBody(ctx: CanvasRenderingContext2D, s: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(0, -0.15 * s, 0.34 * s, 0.55 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-0.07 * s, 0.3 * s); ctx.lineTo(-0.05 * s, 1.12 * s); ctx.lineTo(0.05 * s, 1.12 * s); ctx.lineTo(0.07 * s, 0.3 * s); ctx.closePath();
  ctx.moveTo(-0.05 * s, 1.0 * s); ctx.lineTo(-0.22 * s, 1.22 * s); ctx.lineTo(-0.05 * s, 1.22 * s); ctx.closePath();
  ctx.fill();
}

function propDisc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: RGB, alpha: number, spin: number, hub = true, blades = 4): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(spin);
  ctx.globalAlpha = 1;
  ctx.fillStyle = col(color, 0.14 * alpha);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = col(color, 0.7 * alpha);
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.lineCap = "round";
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    ctx.stroke();
  }
  if (hub) {
    ctx.fillStyle = col([255, 255, 255], 0.7 * alpha);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function mainRotor(ctx: CanvasRenderingContext2D, s: number, color: RGB, alpha: number, spin: number): void {
  const r = 1.15 * s;
  ctx.save();
  ctx.translate(0, -0.15 * s);
  ctx.rotate(spin);
  ctx.fillStyle = col(color, 0.08 * alpha);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = col(color, 0.55 * alpha);
  ctx.lineWidth = Math.max(1.2, r * 0.06);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.lineTo(r, 0);
  ctx.stroke();
  ctx.fillStyle = col([255, 255, 255], 0.85 * alpha);
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function core(ctx: CanvasRenderingContext2D, s: number, alpha: number, r: number): void {
  ctx.shadowBlur = 0;
  ctx.fillStyle = col([255, 255, 255], 0.75 * alpha);
  ctx.beginPath();
  ctx.arc(0, 0, s * r, 0, Math.PI * 2);
  ctx.fill();
}
