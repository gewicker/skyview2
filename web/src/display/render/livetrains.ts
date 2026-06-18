// Live Link trains from the backend OBA proxy (/api/rail). The server hands us a flat
// list of vehicles (id + line + lat/lon + schedule deviation) refreshed every ~20 s.
// Here we EASE each vehicle's shown position toward its latest poll target so it glides
// instead of teleporting, and trail a lagging "anchor" point behind it to draw a comet
// tail without any heading math (when stopped at a platform the anchor catches up and
// the tail collapses). A vehicle that stops appearing in polls fades, then drops.
//
// Degrades silently: no key on the server ⇒ empty list ⇒ no live trains ⇒ the layer
// falls back to the timetable simulation (trains.ts). Same grammar as traffic.ts.

interface RailTrainMsg { id: string; line: string; lat: number; lon: number; devSec: number; updated: number; }

interface Veh {
  line: string;
  lat: number; lon: number;     // eased shown position
  alat: number; alon: number;   // lagging anchor (tail origin)
  tLat: number; tLon: number;   // latest poll target
  devSec: number;
  lastSeen: number;             // local ms we last saw it in a poll
}

export interface LiveTrain {
  id: string;
  line: string;
  lat: number; lon: number;
  alat: number; alon: number;   // tail anchor
  devSec: number;
  fade: number;                 // 1 fresh … 0 about to drop (desaturate as it falls)
}

const POS_TAU = 1.6;   // s — shown position eases toward the latest target
const ANCHOR_TAU = 3.0; // s — anchor lags shown; sets the comet-tail length
const STALE_S = 90;    // begin fading a vehicle this long after we last saw it
const DROP_S = 150;    // remove it entirely after this

let started = false;
let fetchedAt = 0; // local ms of last successful fetch (0 = never)
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
          const v = vehicles.get(m.id);
          if (v) {
            v.line = m.line; v.tLat = m.lat; v.tLon = m.lon; v.devSec = m.devSec; v.lastSeen = now;
          } else {
            vehicles.set(m.id, {
              line: m.line, lat: m.lat, lon: m.lon, alat: m.lat, alon: m.lon,
              tLat: m.lat, tLon: m.lon, devSec: m.devSec, lastSeen: now,
            });
          }
        }
      })
      .catch(() => {});
  };
  poll();
  setInterval(poll, 20 * 1000);
}

/** Advance the per-vehicle ease toward the latest targets. Call once per frame. */
export function tickLiveTrains(dt: number): void {
  const kp = 1 - Math.exp(-Math.max(0, dt) / POS_TAU);
  const ka = 1 - Math.exp(-Math.max(0, dt) / ANCHOR_TAU);
  const now = Date.now();
  for (const [id, v] of vehicles) {
    if (now - v.lastSeen > DROP_S * 1000) { vehicles.delete(id); continue; }
    v.lat += (v.tLat - v.lat) * kp;
    v.lon += (v.tLon - v.lon) * kp;
    v.alat += (v.lat - v.alat) * ka;
    v.alon += (v.lon - v.alon) * ka;
  }
}

/** Current live trains with a freshness fade (1 fresh … 0 dropping). */
export function liveTrains(): LiveTrain[] {
  const now = Date.now();
  const out: LiveTrain[] = [];
  for (const [id, v] of vehicles) {
    const age = (now - v.lastSeen) / 1000;
    const fade = age <= STALE_S ? 1 : age >= DROP_S ? 0 : 1 - (age - STALE_S) / (DROP_S - STALE_S);
    if (fade <= 0) continue;
    out.push({ id, line: v.line, lat: v.lat, lon: v.lon, alat: v.alat, alon: v.alon, devSec: v.devSec, fade });
  }
  return out;
}

/** Set of line ids that currently have a live train — so the sim can stand down per line. */
export function liveLineSet(): Set<string> {
  const now = Date.now();
  const s = new Set<string>();
  for (const v of vehicles.values()) {
    if ((now - v.lastSeen) / 1000 < DROP_S) s.add(v.line);
  }
  return s;
}

/** Whether we've ever heard from the feed (used only for diagnostics/fallback). */
export function liveFresh(): boolean {
  return fetchedAt > 0 && Date.now() - fetchedAt < 60 * 1000;
}
