// Live Link trains from the backend OBA proxy (/api/rail), refreshed ~every 20 s. Each vehicle is
// tracked in ARC-LENGTH `s` along its line's tunnel-aware polyline (path.ts / RAIL_LINES) so it
// follows the real alignment and keeps moving through tunnels where GPS drops:
//   • above ground with fresh fixes → ease `s` toward the projected fix (smooth glide along the
//     curve, the old behavior but on the track instead of a chord);
//   • no fresh fix for a while (a tunnel, or a missed poll) → DEAD-RECKON: advance `s` at the
//     timetable pace (path.paceVel) in the travel direction, so the train glides on instead of
//     freezing over a portal, and arrives near the next station on schedule.
// A fix far off the line (dist gate) is ignored for position. If a vehicle can't be matched to a
// line at all, it falls back to the original eased-lat/lon glide so nothing regresses.
//
// Degrades silently: no key on the server ⇒ empty list ⇒ the layer falls back to the timetable sim.

import { RAIL_LINES } from "./rail";
import { project, posAt, lineLength, type RailLine } from "./path";

interface RailTrainMsg { id: string; line: string; lat: number; lon: number; devSec: number; updated: number; }

interface Veh {
  line: string;
  // raw eased fallback (used when the vehicle isn't confidently on a line's geometry)
  lat: number; lon: number;
  alat: number; alon: number;   // lagging anchor (fallback tail origin)
  tLat: number; tLon: number;   // latest raw poll target
  devSec: number;
  lastSeen: number;             // local ms we last saw it in ANY poll
  // arc-length track
  ln: RailLine | null;          // matched line geometry (null = no geometry → raw fallback)
  s: number;                    // arc-length position (m)
  sTarget: number;              // arc-length of the last accepted on-line fix
  dir: 1 | -1;                  // travel direction along the path (+1 toward the high-index terminus)
  sVel: number;                 // estimated speed (m/s) from consecutive fixes — drives prediction
  hasFix: boolean;              // got >=1 accepted on-line fix
  lastFixS: number;             // previous accepted fix s (for speed/direction)
  lastFixAt: number;            // local ms of the last accepted on-line fix
}

export interface LiveTrain {
  id: string;
  line: string;
  lat: number; lon: number;
  alat: number; alon: number;   // tail point (behind, along the track when on-line)
  devSec: number;
  fade: number;                 // 1 fresh … 0 about to drop
  submerged: boolean;           // in a tunnel → render the ghost grammar
}

const POS_TAU = 1.6;       // s — above-ground ease of s toward the latest fix
const ANCHOR_TAU = 3.0;    // s — raw fallback anchor lag
const STALE_S = 90;        // begin fading (above ground only)
const DROP_S = 150;        // remove (above ground only)
const DROP_MAX_S = 600;    // hard cap so a tunnel-silent train can't ghost forever
const GATE_M = 60;         // a fix farther than this off the line is spurious — ignore for position
const FIX_CORR = 0.5;      // per-poll gentle correction of s toward the projected fix
const TAIL_M = 130;        // comet-tail length walked back along the path
const DIR_EPS = 8;         // m of s change needed to (re)set travel direction
const SPD_MAX = 35;        // m/s cap on the estimated speed (~125 km/h)

const LINE_BY_ID = new Map<string, RailLine>(RAIL_LINES.map((l) => [l.id, l]));

let started = false;
let fetchedAt = 0;
const vehicles = new Map<string, Veh>();

/** Begin polling /api/rail (~every 20 s). Idempotent. */
export function startLiveTrains(): void {
  if (started) return;
  started = true;
  const poll = () => {
    fetch("/api/rail")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j || !Array.isArray(j.trains)) return;
        fetchedAt = Date.now();
        const now = Date.now();
        for (const m of j.trains as RailTrainMsg[]) {
          if (!m.id || (m.lat === 0 && m.lon === 0)) continue;
          let v = vehicles.get(m.id);
          if (!v) {
            v = {
              line: m.line, lat: m.lat, lon: m.lon, alat: m.lat, alon: m.lon,
              tLat: m.lat, tLon: m.lon, devSec: m.devSec, lastSeen: now,
              ln: LINE_BY_ID.get(m.line) ?? null, s: 0, sTarget: 0, dir: 1, sVel: 0,
              hasFix: false, lastFixS: 0, lastFixAt: 0,
            };
            vehicles.set(m.id, v);
          }
          v.line = m.line; v.devSec = m.devSec; v.lastSeen = now;
          v.tLat = m.lat; v.tLon = m.lon;            // raw fallback target
          if (!v.ln) v.ln = LINE_BY_ID.get(m.line) ?? null;
          // Arc-length: accept the fix only if it projects onto the line (gate out spurious fixes).
          if (v.ln) {
            const pr = project(v.ln, m.lat, m.lon);
            if (pr.dist < GATE_M) {
              if (!v.hasFix) { v.s = pr.s; v.hasFix = true; }
              else {
                // Estimate speed + direction from the move since the last accepted fix; then gently
                // correct the predicted position onto the fix. Prediction (tick) does the smoothing.
                const dtFix = (now - v.lastFixAt) / 1000;
                if (dtFix > 0.5) {
                  const ds = pr.s - v.lastFixS;
                  if (Math.abs(ds) > DIR_EPS) v.dir = ds >= 0 ? 1 : -1;
                  const est = Math.min(SPD_MAX, Math.abs(ds) / dtFix);
                  v.sVel = v.sVel > 0 ? v.sVel + (est - v.sVel) * 0.5 : est; // smoothed
                }
                v.s += (pr.s - v.s) * FIX_CORR;
              }
              v.sTarget = pr.s;
              v.lastFixS = pr.s;
              v.lastFixAt = now;
            }
          }
        }
      })
      .catch(() => {});
  };
  poll();
  setInterval(poll, 20 * 1000);
}

/** Advance positions once per frame: ease toward fixes above ground, dead-reckon at timetable pace
 *  when fixes go stale (tunnel / missed poll). Drops vehicles that have truly gone quiet. */
export function tickLiveTrains(dt: number): void {
  const kp = 1 - Math.exp(-Math.max(0, dt) / POS_TAU);
  const ka = 1 - Math.exp(-Math.max(0, dt) / ANCHOR_TAU);
  const now = Date.now();
  for (const [id, v] of vehicles) {
    const age = now - v.lastSeen;
    // Raw fallback ease (always maintained, cheap — used when off-line).
    v.lat += (v.tLat - v.lat) * kp;
    v.lon += (v.tLon - v.lon) * kp;
    v.alat += (v.lat - v.alat) * ka;
    v.alon += (v.lon - v.alon) * ka;
    // Arc-length advance.
    let submerged = false;
    if (v.ln && v.hasFix) {
      submerged = posAt(v.ln, v.s).tunnel;
      // Predict forward continuously at the estimated speed — smooth glide between the ~20 s polls,
      // above ground AND in tunnels (where it carries the train at its last known speed). Each poll
      // applies a gentle correction onto the latest fix.
      const total = lineLength(v.ln);
      v.s += v.dir * v.sVel * Math.max(0, dt);
      if (v.s < 0) v.s = 0; else if (v.s > total) v.s = total;
    }
    // Drop: hard cap always; otherwise only when ABOVE ground (a tunnel-silent train is healthy).
    if (age > DROP_MAX_S * 1000 || (!submerged && age > DROP_S * 1000)) vehicles.delete(id);
  }
}

/** Current live trains (position resolved from arc-length when on-line, raw fallback otherwise). */
export function liveTrains(): LiveTrain[] {
  const now = Date.now();
  const out: LiveTrain[] = [];
  for (const [id, v] of vehicles) {
    let lat = v.lat, lon = v.lon, alat = v.alat, alon = v.alon, submerged = false;
    if (v.ln && v.hasFix) {
      const total = lineLength(v.ln);
      const p = posAt(v.ln, v.s);
      lat = p.lat; lon = p.lon; submerged = p.tunnel;
      const ts = Math.max(0, Math.min(total, v.s - v.dir * TAIL_M)); // tail walked back along the track
      const tp = posAt(v.ln, ts);
      alat = tp.lat; alon = tp.lon;
    }
    const age = (now - v.lastSeen) / 1000;
    const fade = submerged ? 1 : age <= STALE_S ? 1 : age >= DROP_S ? 0 : 1 - (age - STALE_S) / (DROP_S - STALE_S);
    if (fade <= 0) continue;
    out.push({ id, line: v.line, lat, lon, alat, alon, devSec: v.devSec, fade, submerged });
  }
  return out;
}

/** Set of line ids that currently have a live train — so the sim can stand down per line. tick()
 *  prunes dead vehicles, so any vehicle still tracked counts as live coverage. */
export function liveLineSet(): Set<string> {
  const s = new Set<string>();
  for (const v of vehicles.values()) s.add(v.line);
  return s;
}

/** Whether we've ever heard from the feed (used only for diagnostics/fallback). */
export function liveFresh(): boolean {
  return fetchedAt > 0 && Date.now() - fetchedAt < 60 * 1000;
}
