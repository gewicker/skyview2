// Live buses from the backend OBA proxy (/api/buses). Buses report only every ~20 s, so instead of
// easing to the last fix and stalling, each bus is moved forward between polls. Two pacing modes:
//
//   • ROAD-SNAP (preferred): when the backend supplies the trip's route shape (a decoded polyline),
//     we build a path.ts RailLine from it once, project the bus's fixes onto it, and pace it in
//     ARC-LENGTH along the road — exactly the live-train pattern (estimate speed from successive
//     projected fixes, dead-reckon along the shape between polls, gentle per-poll correction). The
//     bus follows the actual road instead of cutting corners on a straight chord.
//   • VELOCITY FALLBACK (unchanged): when a bus has no usable shape (none supplied, or its fix sits
//     far off the shape), we estimate its velocity (deg/s) from successive fixes and glide a moving
//     target along that heading — the original behavior, kept verbatim so nothing regresses.
//
// Either way liveBuses() returns the same shape (lat/lon/alat/alon/fade/route/headsign/rapidRide/
// waterTaxi) so BusLayer needs no structural change. Velocity is capped + decays when the feed goes
// quiet (a dropped bus coasts to a stop). Carries route/headsign for the tap card.

import { project, posAt, lineLength, cumLen, type RailLine, type RailVertex } from "./path";

interface BusMsg { id: string; lat: number; lon: number; updated: number; route?: string; headsign?: string; shape?: string; waterTaxi?: boolean; }

interface Veh {
  // velocity-fallback state (the original store — used when not confidently on a shape)
  lat: number; lon: number;       // eased shown position
  alat: number; alon: number;     // lagging anchor (tail + heading)
  tLat: number; tLon: number;     // moving prediction target (advanced by velocity between polls)
  vLat: number; vLon: number;     // estimated velocity, degrees/sec
  fLat: number; fLon: number; lastFixAt: number; hasFix: boolean; // last accepted fix (for velocity)
  route: string; headsign: string; waterTaxi: boolean;
  lastSeen: number;
  // arc-length (road-snap) state — populated only while a usable shape is attached
  shapeId: string;                // current trip's shapeId ("" = none)
  ln: RailLine | null;            // built line for shapeId (null = no geometry → velocity fallback)
  onLine: boolean;                // last fix projected within the gate (else fall back this poll)
  s: number;                      // arc-length position (m)
  dir: 1 | -1;                    // travel direction along the shape (+1 toward the high-index end)
  sVel: number;                   // estimated speed (m/s) from consecutive projected fixes
  hasArc: boolean;                // got >=1 accepted on-line fix
  lastFixS: number;               // previous accepted projected fix s (for speed/direction)
  lastArcFixAt: number;           // local ms of the last accepted on-line fix
}

export interface LiveBus {
  id: string;
  lat: number; lon: number;
  alat: number; alon: number;
  fade: number;
  route: string; headsign: string; rapidRide: boolean; waterTaxi: boolean;
}

/** RapidRide routes are named "A Line".."H Line" — frequent network, branded apart from local buses. */
export function isRapidRide(route: string): boolean { return /\bLine$/.test(route); }

const POS_TAU = 1.6;       // s — shown eases toward the (moving) target (velocity fallback)
const ANCHOR_TAU = 2.2;    // s — shorter tail than trains (buses stop more)
const STALE_S = 90;
const DROP_S = 150;
const MAX_DEG_S = 0.0004;  // ~44 m/s lat cap — clamp so a spurious fix can't fling a bus
const FIX_STALE_MS = 24000; // no fix past this → decay velocity so a dropped bus coasts to a stop

// arc-length (road-snap) constants — mirror livetrains.ts, tuned a touch for road buses
const GATE_M = 45;         // a fix farther than this off the shape is off-route → velocity fallback
const FIX_CORR = 0.5;      // per-poll gentle correction of s toward the projected fix
const TAIL_M = 90;         // comet-tail length walked back along the shape (alat/alon)
const DIR_EPS = 6;         // m of s change needed to (re)set travel direction
const SPD_MAX = 30;        // m/s cap on the estimated speed (~108 km/h — generous for a bus)
const SPD_DECAY = 0.92;    // per-stale-poll speed decay so a quiet bus coasts to a stop on its road

let started = false;
const vehicles = new Map<string, Veh>();

// One RailLine per shapeId, built once from the decoded polyline (shapes are static). Buses sharing
// a trip-shape share the geometry object so path.ts's cumLen memo (WeakMap) is reused.
const lineByShape = new Map<string, RailLine>();

function lineForShape(id: string, pts: number[][] | undefined): RailLine | null {
  if (!id) return null;
  const have = lineByShape.get(id);
  if (have) return have;
  if (!pts || pts.length < 2) return null;
  const path: RailVertex[] = [];
  for (const p of pts) {
    if (!p || p.length < 2) continue;
    path.push({ lat: p[0], lon: p[1], tunnel: false });
  }
  if (path.length < 2) return null;
  // No stations along a bus shape — leave stationIdx empty; path.ts paceVel falls back to its
  // nominal pace, but we drive buses by their OWN estimated speed (sVel), not paceVel, so it's moot.
  const ln: RailLine = { id, name: id, path, stationIdx: [] };
  lineByShape.set(id, ln);
  return ln;
}

export function startLiveBuses(): void {
  if (started) return;
  started = true;
  const poll = () => {
    if (typeof document !== "undefined" && document.hidden) return; // don't fetch on a hidden tab
    fetch("/api/buses")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j || !Array.isArray(j.buses)) return;
        const shapes: Record<string, number[][]> | undefined =
          j.shapes && typeof j.shapes === "object" ? j.shapes : undefined;
        const now = Date.now();
        for (const m of j.buses as BusMsg[]) {
          if (!m.id || (m.lat === 0 && m.lon === 0)) continue;
          let v = vehicles.get(m.id);
          if (!v) {
            v = {
              lat: m.lat, lon: m.lon, alat: m.lat, alon: m.lon, tLat: m.lat, tLon: m.lon,
              vLat: 0, vLon: 0, fLat: m.lat, fLon: m.lon, lastFixAt: now, hasFix: true,
              route: m.route ?? "", headsign: m.headsign ?? "", waterTaxi: !!m.waterTaxi, lastSeen: now,
              shapeId: "", ln: null, onLine: false, s: 0, dir: 1, sVel: 0, hasArc: false,
              lastFixS: 0, lastArcFixAt: 0,
            };
            vehicles.set(m.id, v);
          }

          // --- velocity-fallback bookkeeping (kept exactly as before) ---
          const dtFix = (now - v.lastFixAt) / 1000;
          if (v.hasFix && dtFix > 0.5) {
            let vl = (m.lat - v.fLat) / dtFix, vo = (m.lon - v.fLon) / dtFix;
            vl = Math.max(-MAX_DEG_S, Math.min(MAX_DEG_S, vl));
            vo = Math.max(-MAX_DEG_S, Math.min(MAX_DEG_S, vo));
            v.vLat = v.vLat * 0.5 + vl * 0.5;
            v.vLon = v.vLon * 0.5 + vo * 0.5;
          }
          v.tLat = m.lat; v.tLon = m.lon;       // snap the prediction target to the real fix
          v.fLat = m.lat; v.fLon = m.lon; v.lastFixAt = now; v.hasFix = true;
          v.route = m.route ?? ""; v.headsign = m.headsign ?? ""; v.waterTaxi = !!m.waterTaxi;
          v.lastSeen = now;

          // --- arc-length (road-snap) bookkeeping ---
          const shapeId = m.shape ?? "";
          if (shapeId !== v.shapeId) {
            // New (or first) shape for this trip — (re)build geometry and reset arc state so a route
            // change doesn't carry stale arc-length across an unrelated polyline.
            v.shapeId = shapeId;
            v.ln = lineForShape(shapeId, shapes?.[shapeId]);
            v.hasArc = false; v.sVel = 0; v.dir = 1; v.lastFixS = 0; v.lastArcFixAt = 0;
          } else if (shapeId && !v.ln) {
            // Same shapeId but geometry wasn't available before (shape arrived in a later poll).
            v.ln = lineForShape(shapeId, shapes?.[shapeId]);
          }
          if (v.ln) {
            const pr = project(v.ln, m.lat, m.lon);
            if (pr.dist < GATE_M) {
              v.onLine = true;
              if (!v.hasArc) { v.s = pr.s; v.hasArc = true; }
              else {
                const dtArc = (now - v.lastArcFixAt) / 1000;
                if (dtArc > 0.5) {
                  const ds = pr.s - v.lastFixS;
                  if (Math.abs(ds) > DIR_EPS) v.dir = ds >= 0 ? 1 : -1;
                  const est = Math.min(SPD_MAX, Math.abs(ds) / dtArc);
                  v.sVel = v.sVel > 0 ? v.sVel + (est - v.sVel) * 0.5 : est; // smoothed
                }
                v.s += (pr.s - v.s) * FIX_CORR;                            // gentle correction
              }
              v.lastFixS = pr.s;
              v.lastArcFixAt = now;
            } else {
              v.onLine = false; // fix sits off the road shape → use velocity fallback for this bus
            }
          } else {
            v.onLine = false;
          }
        }
      })
      .catch(() => {});
  };
  poll();
  setInterval(poll, 20 * 1000);
}

export function tickLiveBuses(dt: number): void {
  const kp = 1 - Math.exp(-Math.max(0, dt) / POS_TAU);
  const ka = 1 - Math.exp(-Math.max(0, dt) / ANCHOR_TAU);
  const now = Date.now();
  for (const [id, v] of vehicles) {
    if (now - v.lastSeen > DROP_S * 1000) { vehicles.delete(id); continue; }

    // Velocity fallback is ALWAYS maintained (cheap) so it's ready the instant a bus goes off-route.
    if (now - v.lastFixAt > FIX_STALE_MS) { v.vLat *= 0.92; v.vLon *= 0.92; }
    v.tLat += v.vLat * dt; v.tLon += v.vLon * dt;
    v.lat += (v.tLat - v.lat) * kp;
    v.lon += (v.tLon - v.lon) * kp;
    v.alat += (v.lat - v.alat) * ka;
    v.alon += (v.lon - v.alon) * ka;

    // Arc-length advance (only when usefully on a shape): dead-reckon at the estimated speed so the
    // bus glides along the road between the ~20 s polls; correction was applied at poll time.
    if (v.ln && v.hasArc && v.onLine) {
      if (now - v.lastArcFixAt > FIX_STALE_MS) v.sVel *= SPD_DECAY; // quiet bus coasts to a stop
      const total = lineLength(v.ln);
      v.s += v.dir * v.sVel * Math.max(0, dt);
      if (v.s < 0) v.s = 0; else if (v.s > total) v.s = total;
    }
  }
}

export function liveBuses(): LiveBus[] {
  const now = Date.now();
  const out: LiveBus[] = [];
  for (const [id, v] of vehicles) {
    const age = (now - v.lastSeen) / 1000;
    const fade = age <= STALE_S ? 1 : age >= DROP_S ? 0 : 1 - (age - STALE_S) / (DROP_S - STALE_S);
    if (fade <= 0) continue;
    let lat = v.lat, lon = v.lon, alat = v.alat, alon = v.alon;
    if (v.ln && v.hasArc && v.onLine) {
      // Road-snapped: resolve position + a tail point walked back along the shape for heading.
      const total = lineLength(v.ln);
      const p = posAt(v.ln, v.s);
      lat = p.lat; lon = p.lon;
      const ts = Math.max(0, Math.min(total, v.s - v.dir * TAIL_M));
      const tp = posAt(v.ln, ts);
      alat = tp.lat; alon = tp.lon;
    }
    out.push({ id, lat, lon, alat, alon, fade, route: v.route, headsign: v.headsign, rapidRide: isRapidRide(v.route), waterTaxi: v.waterTaxi });
  }
  return out;
}

/** The decoded route polyline (lat/lon points) for a tapped bus's CURRENT trip shape, or null when
 *  it has no usable shape (velocity-fallback buses, or a shape that hasn't arrived in a poll yet). */
export function busShapePath(id: string): { lat: number; lon: number }[] | null {
  const v = vehicles.get(id);
  if (!v || !v.ln || v.ln.path.length < 2) return null;
  return v.ln.path.map((p) => ({ lat: p.lat, lon: p.lon }));
}

/** The road AHEAD for a tapped bus: the slice of its trip shape from the bus's current arc-length
 *  position to the destination terminus (in the travel direction), starting at the exact bus point.
 *  This is what BusRouteLayer draws — the bus-space twin of the aircraft destination great-circle
 *  (see docs/BUS-ROUTE-DESIGN.md). Also returns the estimated speed `sVel` (m/s) so the layer can
 *  pace its directional dash flow. null when the bus has no road-snapped arc position (velocity
 *  fallback) — those buses simply get no route line. */
export function busAhead(id: string): { pts: { lat: number; lon: number }[]; sVel: number } | null {
  const v = vehicles.get(id);
  // Require onLine too (not just hasArc): tick only advances v.s while on-line, so an off-route bus
  // has a FROZEN v.s — drawing the ahead-slice from it would detach the line from the (velocity-
  // fallback) bead. Mirror liveBuses' road-snap gate; the layer no-ops on null (bug scrub v6 P1-1).
  if (!v || !v.ln || !v.hasArc || !v.onLine || v.ln.path.length < 2) return null;
  const cum = cumLen(v.ln);
  const head = posAt(v.ln, v.s);
  const pts: { lat: number; lon: number }[] = [{ lat: head.lat, lon: head.lon }];
  // Walk the shape vertices ahead of the bus in the travel direction, ending at the terminus. The
  // 1 m epsilon skips a vertex coincident with the head so the first segment isn't zero-length (P2-2).
  const EPS = 1;
  if (v.dir >= 0) {
    for (let i = 0; i < v.ln.path.length; i++) {
      if (cum[i] > v.s + EPS) pts.push({ lat: v.ln.path[i].lat, lon: v.ln.path[i].lon });
    }
  } else {
    for (let i = v.ln.path.length - 1; i >= 0; i--) {
      if (cum[i] < v.s - EPS) pts.push({ lat: v.ln.path[i].lat, lon: v.ln.path[i].lon });
    }
  }
  if (pts.length < 2) return null;
  return { pts, sVel: v.sVel };
}
