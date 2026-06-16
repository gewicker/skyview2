// Bundled aeronautical reference data for the navaid + procedure overlays, built
// from PUBLIC-DOMAIN sources (FAA / OurAirports). Jeppesen plates are proprietary
// and are NOT used; this is our own clean vector rendering of the same public facts.
//
// Navaid positions/frequencies are exact (OurAirports). Final-approach geometry is
// derived from the real runway thresholds in airports.ts (a 3° straight-in final), so
// it registers against the satellite map by construction. Full multi-fix RNAV STAR
// tracks can be layered in later from an FAA CIFP export without touching the layers.
import { AIRPORTS } from "./airports";

export type NavaidType = "vortac" | "vor-dme" | "vor" | "ndb" | "tacan";

export interface Navaid {
  id: string;        // "nav:SEA"
  ident: string;     // "SEA"
  name: string;      // "Seattle VORTAC"
  type: NavaidType;
  lat: number;
  lon: number;
  freqMHz?: number;  // VOR family
  freqKHz?: number;  // NDB
}

export interface Fix {
  id: string;        // "fix:DONDO"
  name: string;      // "DONDO"
  lat: number;
  lon: number;
  note?: string;     // e.g. "ILS 16 FAF"
}

// VOR/VORTAC/VOR-DME within useful range of the display (exact, OurAirports).
export const NAVAIDS: Navaid[] = [
  { id: "nav:SEA", ident: "SEA", name: "Seattle VORTAC", type: "vortac", lat: 47.435398, lon: -122.309998, freqMHz: 116.8 },
  { id: "nav:TCM", ident: "TCM", name: "McChord VORTAC", type: "vortac", lat: 47.147701, lon: -122.474998, freqMHz: 109.6 },
  { id: "nav:PAE", ident: "PAE", name: "Paine VOR-DME", type: "vor-dme", lat: 47.919800, lon: -122.278000, freqMHz: 110.6 },
  { id: "nav:OLM", ident: "OLM", name: "Olympia VORTAC", type: "vortac", lat: 46.971600, lon: -122.902000, freqMHz: 113.4 },
  // Compass-locator NDBs that sit on the local finals — handy named points.
  { id: "nav:ODD", ident: "ODD", name: "Dondo NDB", type: "ndb", lat: 47.364101, lon: -122.308998, freqKHz: 224 },
  { id: "nav:RNT", ident: "RNT", name: "Renton NDB", type: "ndb", lat: 47.495399, lon: -122.214996, freqKHz: 353 },
];

// Named fixes (curated). DONDO is the published locator/fix on the SEA south finals.
export const FIXES: Fix[] = [
  { id: "fix:DONDO", name: "DONDO", lat: 47.364101, lon: -122.308998, note: "SEA south final" },
];

// The VORTAC we hang DME range rings off (the field reference). SEA.
export const DME_CENTER = NAVAIDS[0];
export const DME_RINGS_NM = [10, 20, 30];

// --- geometry ------------------------------------------------------------- //

const DEG = Math.PI / 180;
const NM_PER_DEG_LAT = 60; // ~ exact

/** Destination lat/lon from a start, a bearing (deg true) and distance (NM). */
export function destPoint(lat: number, lon: number, brgDeg: number, distNM: number): [number, number] {
  const dLat = (distNM / NM_PER_DEG_LAT) * Math.cos(brgDeg * DEG);
  const dLon = (distNM / (NM_PER_DEG_LAT * Math.cos(lat * DEG))) * Math.sin(brgDeg * DEG);
  return [lat + dLat, lon + dLon];
}

function bearing(a: [number, number], b: [number, number]): number {
  const p1 = a[0] * DEG, p2 = b[0] * DEG, dl = (b[1] - a[1]) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / DEG) % 360 + 360) % 360;
}

// A straight-in final approach, derived from one runway end's real threshold.
export interface Final {
  id: string;            // "proc:KSEA/16R"
  icao: string;          // "KSEA"
  iata: string;          // "SEA"
  ident: string;         // runway you land on, "16R"
  course: number;        // final approach course (deg true), = landing direction
  thr: [number, number]; // landing threshold
  faf: [number, number]; // ~5 NM final
  gate: [number, number];// ~10 NM gate
  end: [number, number]; // outer end of the drawn final (~13 NM)
  fafNM: number;
  lenNM: number;
}

const FAF_NM = 5;
const GATE_NM = 10;
const FINAL_NM = 13;

// Build both landing directions for every runway at the three local fields.
export const FINALS: Final[] = (() => {
  const out: Final[] = [];
  for (const ap of AIRPORTS) {
    for (const rw of ap.runways) {
      const ends: Array<{ ident: string; thr: [number, number]; other: [number, number] }> = [
        { ident: rw.leIdent, thr: rw.le, other: rw.he },
        { ident: rw.heIdent, thr: rw.he, other: rw.le },
      ];
      for (const e of ends) {
        const course = bearing(e.thr, e.other);   // landing direction
        const appBrg = (course + 180) % 360;       // final extends back along reciprocal
        out.push({
          id: `proc:${ap.icao}/${e.ident}`,
          icao: ap.icao, iata: ap.iata, ident: e.ident, course,
          thr: e.thr,
          faf: destPoint(e.thr[0], e.thr[1], appBrg, FAF_NM),
          gate: destPoint(e.thr[0], e.thr[1], appBrg, GATE_NM),
          end: destPoint(e.thr[0], e.thr[1], appBrg, FINAL_NM),
          fafNM: FAF_NM, lenNM: FINAL_NM,
        });
      }
    }
  }
  return out;
})();

// --- hit-testing (tap-to-reveal) ------------------------------------------ //

export type Project = (lat: number, lon: number) => { x: number; y: number };

/** Nearest selectable static feature (navaid, fix, or final) to a screen point,
 *  honoring the layer toggles. Returns its id or null. Points win over finals. */
export function pickStatic(
  project: Project, px: number, py: number,
  showNavaids: boolean, showProcedures: boolean,
): string | null {
  const PT = 24 * 24; // point tap radius²
  let best: string | null = null;
  let bestD = PT;
  if (showNavaids) {
    for (const n of NAVAIDS) {
      const p = project(n.lat, n.lon);
      const d = (p.x - px) ** 2 + (p.y - py) ** 2;
      if (d < bestD) { bestD = d; best = n.id; }
    }
    for (const fx of FIXES) {
      const p = project(fx.lat, fx.lon);
      const d = (p.x - px) ** 2 + (p.y - py) ** 2;
      if (d < bestD) { bestD = d; best = fx.id; }
    }
  }
  if (best) return best; // a navaid/fix under the finger beats a line
  if (showProcedures) {
    let lineD = 14 * 14; // line tap distance²
    for (const f of FINALS) {
      const a = project(f.thr[0], f.thr[1]);
      const b = project(f.end[0], f.end[1]);
      const d = segDist2(px, py, a.x, a.y, b.x, b.y);
      if (d < lineD) { lineD = d; best = f.id; }
    }
  }
  return best;
}

function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx, cy = ay + t * dy;
  return (px - cx) ** 2 + (py - cy) ** 2;
}

export function findNavaid(id: string): Navaid | undefined { return NAVAIDS.find((n) => n.id === id); }
export function findFix(id: string): Fix | undefined { return FIXES.find((f) => f.id === id); }
export function findFinal(id: string): Final | undefined { return FINALS.find((f) => f.id === id); }
