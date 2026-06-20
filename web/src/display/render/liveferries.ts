// Live WA State Ferries from the backend WSF proxy (/api/ferries). Vessels are tracked from their
// REAL GPS fixes (always on the water) and PREDICTED forward between the ~15 s polls so they glide
// continuously instead of easing to the last fix and stalling (the start/stop stutter). Prediction
// uses each vessel's OWN estimated velocity from successive fixes — the boat's actual recent on-water
// course — NOT a synthetic terminal→terminal chord (that chord cuts across land, e.g. Seattle→
// Bremerton runs over Bainbridge). Because a ferry holds a near-straight heading over a 15 s window,
// extrapolating its recent velocity keeps it on the water; the per-poll fix then gently corrects it,
// velocity zeros at dock, and decays when the feed goes quiet so a lost boat coasts to a stop. Same
// velocity-glide grammar as the bus store. (A future upgrade can pace along real OSM water geometry.)
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
  fLat: number; fLon: number; lastFixAt: number; hasFix: boolean; // last accepted fix → velocity
  vLat: number; vLon: number;                                     // estimated velocity, degrees/sec
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
const MAX_DEG_S = 0.0001;   // ~11 m/s lat cap — clamp so a spurious fix can't fling a vessel (ferries ≤ ~18 kt)
const FIX_STALE_MS = 20000; // poll is ~15 s; no fix past this → decay velocity so a docked/lost boat coasts to a stop
const VEL_DECAY = 0.92;     // per-tick velocity decay while the feed is quiet

let started = false;
const vessels = new Map<number, Veh>();
let terminals: FerryTerminal[] = [];

/** WSF terminal locations in range (dock anchors + crossing-lane endpoints). */
export function ferryTerminals(): FerryTerminal[] { return terminals; }

export function startLiveFerries(): void {
  if (started) return;
  started = true;
  const poll = () => {
    if (typeof document !== "undefined" && document.hidden) return; // don't fetch on a hidden tab
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
            // Estimate velocity from the move since the last fix (the vessel's own recent on-water
            // course), so tick can dead-reckon it forward between polls instead of stalling. Snap the
            // target to the real fix each poll; the ease then absorbs the small per-poll correction.
            const dtFix = (now - v.lastFixAt) / 1000;
            if (v.hasFix && dtFix > 0.5) {
              let vl = (m.lat - v.fLat) / dtFix, vo = (m.lon - v.fLon) / dtFix;
              vl = Math.max(-MAX_DEG_S, Math.min(MAX_DEG_S, vl));
              vo = Math.max(-MAX_DEG_S, Math.min(MAX_DEG_S, vo));
              v.vLat = v.vLat * 0.5 + vl * 0.5; // smoothed
              v.vLon = v.vLon * 0.5 + vo * 0.5;
            }
            if (m.atDock) { v.vLat = 0; v.vLon = 0; } // a docked boat doesn't dead-reckon
            v.tLat = m.lat; v.tLon = m.lon; v.fLat = m.lat; v.fLon = m.lon; v.lastFixAt = now; v.hasFix = true;
            v.speed = m.speed; v.atDock = m.atDock; v.route = m.route; v.lastSeen = now;
            v.depLat = m.depLat ?? 0; v.depLon = m.depLon ?? 0; v.arrLat = m.arrLat ?? 0; v.arrLon = m.arrLon ?? 0;
          } else {
            vessels.set(m.id, {
              name: m.name, route: m.route, speed: m.speed, atDock: m.atDock,
              lat: m.lat, lon: m.lon, alat: m.lat, alon: m.lon, tLat: m.lat, tLon: m.lon,
              depLat: m.depLat ?? 0, depLon: m.depLon ?? 0, arrLat: m.arrLat ?? 0, arrLon: m.arrLon ?? 0,
              lastSeen: now,
              fLat: m.lat, fLon: m.lon, lastFixAt: now, hasFix: true, vLat: 0, vLon: 0,
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
    // Dead-reckon the target forward at the estimated velocity so the boat glides continuously
    // between the ~15 s polls (no ease-then-stall stutter). Decay the velocity once the feed goes
    // quiet (a missed poll / lost vessel) so it coasts to a stop instead of sailing off; in normal
    // operation lastFixAt updates every poll so this never triggers and the glide stays smooth.
    if (now - v.lastFixAt > FIX_STALE_MS) { v.vLat *= VEL_DECAY; v.vLon *= VEL_DECAY; }
    if (!v.atDock) { v.tLat += v.vLat * dt; v.tLon += v.vLon * dt; }
    v.lat += (v.tLat - v.lat) * kp;   // ease toward the (now moving) target — smooth + on the water
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
