// Live WA State Ferries from the backend WSF proxy (/api/ferries). When a vessel is underway and we
// know its departing+arriving terminal coords, it is paced in ARC-LENGTH along the straight crossing
// lane (dep→arr) via path.ts: between the 15 s WSF polls it dead-reckons at the vessel's reported
// speed, and each poll gently corrects its position onto the lane — so it glides smoothly across the
// Sound instead of easing-and-stalling toward each stale fix. Docked or terminal-unknown vessels
// fall back to the original eased-lat/lon glide so nothing regresses. Carries name/route/atDock/speed
// (tap card) + terminal coords (crossing-lane plot).

import { project, posAt, lineLength, type RailLine } from "./path";

interface FerryMsg {
  id: number; name: string; lat: number; lon: number; speed: number; atDock: boolean; route: string;
  depLat?: number; depLon?: number; arrLat?: number; arrLon?: number;
}

export interface FerryTerminal { id: number; name: string; lat: number; lon: number; }

interface Veh {
  name: string; route: string; speed: number; atDock: boolean;
  lat: number; lon: number; alat: number; alon: number; tLat: number; tLon: number;
  depLat: number; depLon: number; arrLat: number; arrLon: number;
  lastSeen: number;
  // arc-length crossing-lane track
  ln: RailLine | null; lnKey: string;
  s: number; sTarget: number; hasFix: boolean; speedMps: number;
}

export interface LiveFerry {
  id: number;
  lat: number; lon: number; alat: number; alon: number;
  fade: number; name: string; route: string; speed: number; atDock: boolean;
  depLat: number; depLon: number; arrLat: number; arrLon: number;
}

const POS_TAU = 2.0;
const ANCHOR_TAU = 3.5;    // raw-fallback wake length
const STALE_S = 120;
const DROP_S = 240;
const KT_MS = 0.514444;    // knots → m/s
const TAIL_M = 160;        // wake anchor walked back along the lane
const FIX_CORR = 0.5;      // per-poll gentle correction of s toward the projected fix

let started = false;
const vessels = new Map<number, Veh>();
let terminals: FerryTerminal[] = [];

/** WSF terminal locations in range (dock anchors + crossing-lane endpoints). */
export function ferryTerminals(): FerryTerminal[] { return terminals; }

// A straight dep→arr crossing lane as a 2-vertex line path.ts can pace along (null if unresolved).
function buildLane(depLat: number, depLon: number, arrLat: number, arrLon: number): RailLine | null {
  if (!depLat || !depLon || !arrLat || !arrLon) return null;
  return {
    id: "ferry", name: "", stationIdx: [0, 1],
    path: [{ lat: depLat, lon: depLon, tunnel: false }, { lat: arrLat, lon: arrLon, tunnel: false }],
  };
}

export function startLiveFerries(): void {
  if (started) return;
  started = true;
  const poll = () => {
    fetch("/api/ferries")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j || !Array.isArray(j.ferries)) return;
        if (Array.isArray(j.terminals)) terminals = j.terminals as FerryTerminal[];
        const now = Date.now();
        for (const m of j.ferries as FerryMsg[]) {
          if (m.lat === 0 && m.lon === 0) continue;
          let v = vessels.get(m.id);
          if (!v) {
            v = {
              name: m.name, route: m.route, speed: m.speed, atDock: m.atDock,
              lat: m.lat, lon: m.lon, alat: m.lat, alon: m.lon, tLat: m.lat, tLon: m.lon,
              depLat: 0, depLon: 0, arrLat: 0, arrLon: 0, lastSeen: now,
              ln: null, lnKey: "", s: 0, sTarget: 0, hasFix: false, speedMps: 0,
            };
            vessels.set(m.id, v);
          }
          v.tLat = m.lat; v.tLon = m.lon; v.speed = m.speed; v.atDock = m.atDock; v.route = m.route; v.lastSeen = now;
          v.depLat = m.depLat ?? 0; v.depLon = m.depLon ?? 0; v.arrLat = m.arrLat ?? 0; v.arrLon = m.arrLon ?? 0;
          v.speedMps = Math.max(0, m.speed) * KT_MS;
          // (Re)build the crossing lane when the terminal pair changes (a new sailing).
          const key = `${v.depLat},${v.depLon},${v.arrLat},${v.arrLon}`;
          if (key !== v.lnKey) { v.ln = buildLane(v.depLat, v.depLon, v.arrLat, v.arrLon); v.lnKey = key; v.hasFix = false; }
          // Underway + on a known lane → track in arc-length; correct s toward the projected fix.
          if (v.ln && !v.atDock) {
            const pr = project(v.ln, m.lat, m.lon);
            if (!v.hasFix) { v.s = pr.s; v.hasFix = true; }
            else v.s += (pr.s - v.s) * FIX_CORR;
            v.sTarget = pr.s;
          }
        }
      })
      .catch(() => {});
  };
  poll();
  setInterval(poll, 15 * 1000);
}

export function tickLiveFerries(dt: number): void {
  const kp = 1 - Math.exp(-Math.max(0, dt) / POS_TAU);
  const ka = 1 - Math.exp(-Math.max(0, dt) / ANCHOR_TAU);
  const now = Date.now();
  for (const [id, v] of vessels) {
    if (now - v.lastSeen > DROP_S * 1000) { vessels.delete(id); continue; }
    // Raw fallback ease (always maintained — used when docked / no lane).
    v.lat += (v.tLat - v.lat) * kp;
    v.lon += (v.tLon - v.lon) * kp;
    v.alat += (v.lat - v.alat) * ka;
    v.alon += (v.lon - v.alon) * ka;
    // Arc-length dead-reckon along the crossing at the vessel's reported speed.
    if (v.ln && v.hasFix && !v.atDock) {
      v.s += v.speedMps * Math.max(0, dt);
      const total = lineLength(v.ln);
      if (v.s < 0) v.s = 0; else if (v.s > total) v.s = total;
    }
  }
}

export function liveFerries(): LiveFerry[] {
  const now = Date.now();
  const out: LiveFerry[] = [];
  for (const [id, v] of vessels) {
    const age = (now - v.lastSeen) / 1000;
    const fade = age <= STALE_S ? 1 : age >= DROP_S ? 0 : 1 - (age - STALE_S) / (DROP_S - STALE_S);
    if (fade <= 0) continue;
    let lat = v.lat, lon = v.lon, alat = v.alat, alon = v.alon;
    if (v.ln && v.hasFix && !v.atDock) {
      const total = lineLength(v.ln);
      const p = posAt(v.ln, v.s);
      lat = p.lat; lon = p.lon;
      const tp = posAt(v.ln, Math.max(0, Math.min(total, v.s - TAIL_M))); // wake anchor behind, along the lane
      alat = tp.lat; alon = tp.lon;
    }
    out.push({ id, lat, lon, alat, alon, fade, name: v.name, route: v.route, speed: v.speed, atDock: v.atDock,
      depLat: v.depLat, depLon: v.depLon, arrLat: v.arrLat, arrLon: v.arrLon });
  }
  return out;
}
