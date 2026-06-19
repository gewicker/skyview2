// Live WA State Ferries from the backend WSF proxy (/api/ferries). Vessels are tracked from their
// REAL GPS fixes (always on the water) and eased between the ~15 s polls with a lagging anchor for a
// wake — same grammar as the bus/train stores. We deliberately do NOT dead-reckon along a synthetic
// terminal→terminal chord: that chord cuts across land (e.g. Seattle→Bremerton runs over Bainbridge),
// so straight-line prediction would put a boat on dry ground. Following the actual fixes keeps every
// vessel on the water. (A future upgrade can pace along real OSM water-route geometry.)
// Carries name/route/atDock/speed (tap card) + departing/arriving terminal coords (terminal markers).

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
}

export interface LiveFerry {
  id: number;
  lat: number; lon: number; alat: number; alon: number;
  fade: number; name: string; route: string; speed: number; atDock: boolean;
  depLat: number; depLon: number; arrLat: number; arrLon: number;
}

const POS_TAU = 2.0;
const ANCHOR_TAU = 3.5; // longer wake than buses — ferries are big and steady
const STALE_S = 120;
const DROP_S = 240;

let started = false;
const vessels = new Map<number, Veh>();
let terminals: FerryTerminal[] = [];

/** WSF terminal locations in range (dock anchors + crossing-lane endpoints). */
export function ferryTerminals(): FerryTerminal[] { return terminals; }

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
          const v = vessels.get(m.id);
          if (v) {
            v.tLat = m.lat; v.tLon = m.lon; v.speed = m.speed; v.atDock = m.atDock; v.route = m.route; v.lastSeen = now;
            v.depLat = m.depLat ?? 0; v.depLon = m.depLon ?? 0; v.arrLat = m.arrLat ?? 0; v.arrLon = m.arrLon ?? 0;
          } else {
            vessels.set(m.id, {
              name: m.name, route: m.route, speed: m.speed, atDock: m.atDock,
              lat: m.lat, lon: m.lon, alat: m.lat, alon: m.lon, tLat: m.lat, tLon: m.lon,
              depLat: m.depLat ?? 0, depLon: m.depLon ?? 0, arrLat: m.arrLat ?? 0, arrLon: m.arrLon ?? 0,
              lastSeen: now,
            });
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
    v.lat += (v.tLat - v.lat) * kp;   // ease toward the real fix (on the water)
    v.lon += (v.tLon - v.lon) * kp;
    v.alat += (v.lat - v.alat) * ka;  // lagging anchor → wake
    v.alon += (v.lon - v.alon) * ka;
  }
}

export function liveFerries(): LiveFerry[] {
  const now = Date.now();
  const out: LiveFerry[] = [];
  for (const [id, v] of vessels) {
    const age = (now - v.lastSeen) / 1000;
    const fade = age <= STALE_S ? 1 : age >= DROP_S ? 0 : 1 - (age - STALE_S) / (DROP_S - STALE_S);
    if (fade <= 0) continue;
    out.push({ id, lat: v.lat, lon: v.lon, alat: v.alat, alon: v.alon, fade, name: v.name, route: v.route, speed: v.speed, atDock: v.atDock,
      depLat: v.depLat, depLon: v.depLon, arrLat: v.arrLat, arrLon: v.arrLon });
  }
  return out;
}
