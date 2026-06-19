// Live buses from the backend OBA proxy (/api/buses). Buses report only every ~20 s, so instead of
// easing to the last fix and stalling, each bus is PREDICTED forward: we estimate its velocity
// (deg/s) from successive fixes and let a moving target glide along that heading between polls, with
// the shown position easing toward the (moving) target — so motion is continuous and natural. Each
// poll snaps the target to the real fix, correcting drift; this is "approximate accuracy" by design
// (it's the bus's own motion extrapolated, not a road-snapped path — that would need OBA route
// shapes). Velocity is capped (a glitchy fix can't fling a bus) and decays when the feed goes quiet
// (a dropped bus coasts to a stop, never flies off). Carries route/headsign for the tap card.

interface BusMsg { id: string; lat: number; lon: number; updated: number; route?: string; headsign?: string; }

interface Veh {
  lat: number; lon: number;       // eased shown position
  alat: number; alon: number;     // lagging anchor (tail + heading)
  tLat: number; tLon: number;     // moving prediction target (advanced by velocity between polls)
  vLat: number; vLon: number;     // estimated velocity, degrees/sec
  fLat: number; fLon: number; lastFixAt: number; hasFix: boolean; // last accepted fix (for velocity)
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

const POS_TAU = 1.6;       // s — shown eases toward the (moving) target
const ANCHOR_TAU = 2.2;    // s — shorter tail than trains (buses stop more)
const STALE_S = 90;
const DROP_S = 150;
const MAX_DEG_S = 0.0004;  // ~44 m/s lat cap — clamp so a spurious fix can't fling a bus
const FIX_STALE_MS = 24000; // no fix past this → decay velocity so a dropped bus coasts to a stop

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
            const dtFix = (now - v.lastFixAt) / 1000;
            if (v.hasFix && dtFix > 0.5) {
              // Estimate velocity from the move since the last fix, smoothed + capped.
              let vl = (m.lat - v.fLat) / dtFix, vo = (m.lon - v.fLon) / dtFix;
              vl = Math.max(-MAX_DEG_S, Math.min(MAX_DEG_S, vl));
              vo = Math.max(-MAX_DEG_S, Math.min(MAX_DEG_S, vo));
              v.vLat = v.vLat * 0.5 + vl * 0.5;
              v.vLon = v.vLon * 0.5 + vo * 0.5;
            }
            v.tLat = m.lat; v.tLon = m.lon;       // snap the prediction target to the real fix
            v.fLat = m.lat; v.fLon = m.lon; v.lastFixAt = now; v.hasFix = true;
            v.route = m.route ?? ""; v.headsign = m.headsign ?? ""; v.lastSeen = now;
          } else {
            vehicles.set(m.id, {
              lat: m.lat, lon: m.lon, alat: m.lat, alon: m.lon, tLat: m.lat, tLon: m.lon,
              vLat: 0, vLon: 0, fLat: m.lat, fLon: m.lon, lastFixAt: now, hasFix: true,
              route: m.route ?? "", headsign: m.headsign ?? "", lastSeen: now,
            });
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
    // Decay the predicted velocity once a fix is overdue, so a quiet bus eases to a stop.
    if (now - v.lastFixAt > FIX_STALE_MS) { v.vLat *= 0.92; v.vLon *= 0.92; }
    // Advance the moving target by the estimated velocity (prediction), then ease the shown
    // position toward it — continuous glide, corrected to the real fix on each poll.
    v.tLat += v.vLat * dt; v.tLon += v.vLon * dt;
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
