// Shared arc-length engine for the rail lines (V4 Batch 2a). Pure geometry — no rendering, no
// mutable module state. Both the live-train pacer (livetrains.ts) and the timetable simulator
// (trains.ts) reason in ARC-LENGTH `s` (meters from a line's first vertex) instead of raw lat/lon,
// because arc-length is the only position that stays meaningful when GPS drops in a tunnel. This is
// the substrate the underground-rail fix rides on. See docs/UNDERGROUND-RAIL-DESIGN.md.

// One vertex of an ordered, continuous, terminus→terminus rail polyline. `tunnel` marks a vertex
// that is underground; a SEGMENT (between vertex i and i+1) is "in tunnel" iff both ends are.
export interface RailVertex { lat: number; lon: number; tunnel: boolean; }

export interface RailLine {
  id: string;            // "1" | "2" — matches livetrains line + LINE_RGB in TrainLayer
  name: string;          // "1 Line"
  path: RailVertex[];    // one ordered, continuous polyline terminus→terminus
  stationIdx: number[];  // indices into `path` where stations sit (ascending)
  segSec?: number[];     // optional scheduled seconds for station-pair k→k+1 (len = stationIdx.length-1)
}

const DEG = Math.PI / 180;
const R_M = 6371000; // mean earth radius, meters

function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dp = (bLat - aLat) * DEG, dl = (bLon - aLon) * DEG;
  const p1 = aLat * DEG, p2 = bLat * DEG;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_M * Math.asin(Math.min(1, Math.sqrt(x)));
}

// Cumulative arc-length (meters) at each vertex: cumLen[i] = distance path[0]→path[i]. Memoized
// per line object (the line array is generated once and never mutated).
const _cum = new WeakMap<RailLine, number[]>();
export function cumLen(line: RailLine): number[] {
  let c = _cum.get(line);
  if (c) return c;
  const p = line.path;
  c = new Array(p.length);
  c[0] = 0;
  for (let i = 1; i < p.length; i++) c[i] = c[i - 1] + haversine(p[i - 1].lat, p[i - 1].lon, p[i].lat, p[i].lon);
  _cum.set(line, c);
  return c;
}

export function lineLength(line: RailLine): number {
  const c = cumLen(line);
  return c.length ? c[c.length - 1] : 0;
}

// Local equirectangular meters-per-degree around a latitude — cheap and exact enough for the short
// hops between adjacent vertices / a fix and its nearest segment.
function mpd(lat: number): { x: number; y: number } {
  return { x: 111320 * Math.cos(lat * DEG), y: 110540 };
}

// Project a fix onto the polyline: nearest point, returning arc-length `s` (m), the segment index,
// and the perpendicular distance (m). The distance is the confidence gate — a fix far off the line
// is spurious and should not yank the train sideways.
export function project(line: RailLine, lat: number, lon: number): { s: number; segIdx: number; dist: number } {
  const p = line.path, c = cumLen(line);
  const m = mpd(lat);
  const px = lon * m.x, py = lat * m.y;
  let best = { s: 0, segIdx: 0, dist: Infinity };
  for (let i = 0; i < p.length - 1; i++) {
    const ax = p[i].lon * m.x, ay = p[i].lat * m.y;
    const bx = p[i + 1].lon * m.x, by = p[i + 1].lat * m.y;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best.dist) best = { s: c[i] + t * (c[i + 1] - c[i]), segIdx: i, dist: d };
  }
  return best;
}

// Inverse: arc-length `s` → lat/lon, the tunnel flag of the surrounding segment, and the local
// tangent heading (deg, 0=N clockwise) for orienting the railcar glyph. Clamps `s` to the line.
export function posAt(line: RailLine, s: number): { lat: number; lon: number; tunnel: boolean; heading: number } {
  const p = line.path, c = cumLen(line);
  const total = lineLength(line);
  if (p.length === 0) return { lat: 0, lon: 0, tunnel: false, heading: 0 };
  if (s <= 0) return { lat: p[0].lat, lon: p[0].lon, tunnel: p[0].tunnel, heading: headingAt(p, 0) };
  if (s >= total) { const n = p.length - 1; return { lat: p[n].lat, lon: p[n].lon, tunnel: p[n].tunnel, heading: headingAt(p, n - 1) }; }
  let lo = 0, hi = p.length - 1;            // binary search for the segment containing s
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid] <= s) lo = mid; else hi = mid; }
  const t = (s - c[lo]) / ((c[hi] - c[lo]) || 1);
  return {
    lat: p[lo].lat + (p[hi].lat - p[lo].lat) * t,
    lon: p[lo].lon + (p[hi].lon - p[lo].lon) * t,
    tunnel: p[lo].tunnel && p[hi].tunnel,
    heading: headingAt(p, lo),
  };
}

function headingAt(p: RailVertex[], seg: number): number {
  const a = p[seg], b = p[Math.min(seg + 1, p.length - 1)];
  const y = Math.sin((b.lon - a.lon) * DEG) * Math.cos(b.lat * DEG);
  const x = Math.cos(a.lat * DEG) * Math.sin(b.lat * DEG) - Math.sin(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.cos((b.lon - a.lon) * DEG);
  return ((Math.atan2(y, x) / DEG) % 360 + 360) % 360;
}

// The two stations bracketing arc-length `s` (with their arc-lengths) — the unit the timetable pacer
// works in.
export function stationWindow(line: RailLine, s: number): { prevIdx: number; nextIdx: number; sPrev: number; sNext: number } {
  const c = cumLen(line), idx = line.stationIdx;
  if (idx.length === 0) return { prevIdx: 0, nextIdx: line.path.length - 1, sPrev: 0, sNext: lineLength(line) };
  let prev = idx[0], next = idx[idx.length - 1];
  for (let k = 0; k < idx.length; k++) {
    if (c[idx[k]] <= s) prev = idx[k];
    if (c[idx[k]] >= s) { next = idx[k]; break; }
  }
  return { prevIdx: prev, nextIdx: next, sPrev: c[prev], sNext: c[next] };
}

// The timetable pace (m/s) the schedule implies for the station segment containing `s`: the
// station-pair distance over its scheduled duration. Falls back to a nominal average speed until a
// real per-segment table (line.segSec) exists — smooth, just not yet schedule-true.
const NOMINAL_MS = 15; // ~34 mph incl. dwell — placeholder pace
export function paceVel(line: RailLine, s: number): number {
  const win = stationWindow(line, s);
  const dist = win.sNext - win.sPrev;
  if (dist <= 0) return NOMINAL_MS;
  if (line.segSec && line.stationIdx.length > 1) {
    const k = line.stationIdx.indexOf(win.prevIdx);
    const sec = k >= 0 && k < line.segSec.length ? line.segSec[k] : 0;
    if (sec > 0) return dist / sec;
  }
  return NOMINAL_MS;
}

// Per-vehicle arc-length state, advanced each tick. `dir` is travel direction along the path
// (+1 toward the high-index terminus). `advance` dead-reckons at timetable pace, then — when a
// trustworthy fix arc-length is supplied — eases `s` toward it (the same exponential smoothing the
// old lat/lon store used, lifted to arc-length). Termini clamp; livetrains owns direction flips.
export interface ArcState { s: number; dir: 1 | -1; }
export function advance(line: RailLine, st: ArcState, dt: number, fixS: number | null, corrTau = 1.5): void {
  const total = lineLength(line);
  st.s += st.dir * paceVel(line, st.s) * Math.max(0, dt); // timetable pace (dead-reckon)
  if (st.s < 0) st.s = 0;
  else if (st.s > total) st.s = total;
  if (fixS != null) st.s += (fixS - st.s) * (1 - Math.exp(-Math.max(0, dt) / corrTau)); // position correction
}
