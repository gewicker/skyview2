// Live buses from the backend OBA proxy (/api/buses). Same grammar as livetrains.ts: ease each
// vehicle's shown position toward its latest 20s poll, trail a lagging anchor for a short comet
// tail (collapses at stops), fade a vehicle out when it stops appearing. Ambient, label-free.
// Degrades silently: no key / empty list ⇒ no buses.

interface BusMsg { id: string; lat: number; lon: number; updated: number; route?: string; headsign?: string; }

interface Veh {
  lat: number; lon: number;   // eased shown position
  alat: number; alon: number; // lagging anchor (tail origin)
  tLat: number; tLon: number; // latest poll target
  route: string; headsign: string;
  lastSeen: number;
}

export interface LiveBus {
  lat: number; lon: number;
  alat: number; alon: number;
  fade: number;
  route: string; headsign: string; rapidRide: boolean;
}

/** RapidRide routes are named "A Line".."H Line" — frequent network, branded apart from local buses. */
export function isRapidRide(route: string): boolean { return /\bLine$/.test(route); }

const POS_TAU = 1.6;    // s — shown eases toward target
const ANCHOR_TAU = 2.2; // s — shorter tail than trains (buses stop more)
const STALE_S = 90;
const DROP_S = 150;

let started = false;
const vehicles = new Map<string, Veh>();

export function startLiveBuses(): void {
  if (started) return;
  started = true;
  const poll = () => {
    fetch("/api/buses")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j || !Array.isArray(j.buses)) return;
        const now = Date.now();
        for (const m of j.buses as BusMsg[]) {
          if (!m.id || (m.lat === 0 && m.lon === 0)) continue;
          const v = vehicles.get(m.id);
          if (v) {
            v.tLat = m.lat; v.tLon = m.lon; v.lastSeen = now;
            v.route = m.route ?? ""; v.headsign = m.headsign ?? "";
          } else {
            vehicles.set(m.id, { lat: m.lat, lon: m.lon, alat: m.lat, alon: m.lon, tLat: m.lat, tLon: m.lon,
              route: m.route ?? "", headsign: m.headsign ?? "", lastSeen: now });
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
    v.lat += (v.tLat - v.lat) * kp;
    v.lon += (v.tLon - v.lon) * kp;
    v.alat += (v.lat - v.alat) * ka;
    v.alon += (v.lon - v.alon) * ka;
  }
}

export function liveBuses(): LiveBus[] {
  const now = Date.now();
  const out: LiveBus[] = [];
  for (const v of vehicles.values()) {
    const age = (now - v.lastSeen) / 1000;
    const fade = age <= STALE_S ? 1 : age >= DROP_S ? 0 : 1 - (age - STALE_S) / (DROP_S - STALE_S);
    if (fade <= 0) continue;
    out.push({ lat: v.lat, lon: v.lon, alat: v.alat, alon: v.alon, fade, route: v.route, headsign: v.headsign, rapidRide: isRapidRide(v.route) });
  }
  return out;
}
