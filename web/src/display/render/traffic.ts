// Live highway congestion from the backend WSDOT proxy (/api/traffic). The server
// hands us a flat list of flow stations (lat/lon + road id + 0..1 congestion); here
// we SNAP each road's segments to their nearest station so the existing flow-wash +
// car model can read a real per-segment scalar. The hard "match sparse sensors to
// ~950 segments" step is solved spatially: every segment adopts its nearest station's
// value with a distance falloff (coverage weight), so adjacent segments share readings
// and congestion varies smoothly along a corridor; segments far from any sensor fade to
// the time-of-day model. Targets refresh on each 60 s poll; the render clock eases the
// shown value toward the target (τ≈10 s) so the art breathes instead of snapping.
//
// Degrades silently: no key on the server ⇒ no stations ⇒ coverage 0 ⇒ pure model.
// A stale/dead feed ⇒ freshness decays 3→6 min ⇒ live weight fades out and the layer
// gently desaturates (see freshness / desatAmount).
import { HIGHWAYS } from "./highways";

interface Station {
  lat: number;
  lon: number;
  road: string; // i5 / i90 / i405 / sr520
  cong: number; // 0..1
}

const DMAX_MI = 4; // beyond this from the nearest sensor a segment runs on the model
const TAU_S = 10; // ease time-constant for target→shown transitions
const MAX_DESAT = 0.32; // fallback desaturation amplitude (low — a whisper)

let started = false;
let stations: Station[] = [];
let fetchedAt = 0; // local ms of last successful fetch (0 = never)

// Per-highway working arrays (indexed by segment), built lazily from HIGHWAYS.
const mids: Record<string, { lat: number; lon: number }[]> = {};
const target: Record<string, Float32Array> = {}; // nearest-station congestion 0..1
const cover: Record<string, Float32Array> = {}; // spatial coverage weight 0..1
const shown: Record<string, Float32Array> = {}; // eased value actually used by the layer
let built = false;

const COS_LAT = Math.cos(47.6 * (Math.PI / 180)); // local degrees→miles correction

function build(): void {
  if (built) return;
  for (const hw of HIGHWAYS) {
    const m: { lat: number; lon: number }[] = [];
    for (const seg of hw.segments) {
      const p = seg[(seg.length / 2) | 0] ?? seg[0];
      m.push({ lat: p ? p[0] : 0, lon: p ? p[1] : 0 });
    }
    mids[hw.id] = m;
    target[hw.id] = new Float32Array(m.length);
    cover[hw.id] = new Float32Array(m.length);
    shown[hw.id] = new Float32Array(m.length);
  }
  built = true;
}

function distMi(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dx = (aLon - bLon) * COS_LAT * 69;
  const dy = (aLat - bLat) * 69;
  return Math.hypot(dx, dy);
}

function rebuildTargets(): void {
  build();
  for (const hw of HIGHWAYS) {
    const m = mids[hw.id];
    const tgt = target[hw.id];
    const cov = cover[hw.id];
    const sts = stations.filter((s) => s.road === hw.id);
    for (let i = 0; i < m.length; i++) {
      if (!sts.length) {
        cov[i] = 0;
        continue;
      }
      let best = Infinity;
      let bc = 0;
      for (const s of sts) {
        const d = distMi(m[i].lat, m[i].lon, s.lat, s.lon);
        if (d < best) {
          best = d;
          bc = s.cong;
        }
      }
      cov[i] = Math.max(0, Math.min(1, 1 - best / DMAX_MI));
      tgt[i] = bc;
    }
  }
}

/** Global feed freshness 0..1 — full for 3 min, ramps to 0 by 6 min, 0 if never. */
export function freshness(): number {
  if (!fetchedAt) return 0;
  const age = (Date.now() - fetchedAt) / 1000;
  if (age < 180) return 1;
  if (age > 360) return 0;
  return 1 - (age - 180) / 180;
}

/** Ambient desaturation amount for the layer (0 live … MAX_DESAT fully modelled). */
export function desatAmount(): number {
  return (1 - freshness()) * MAX_DESAT;
}

/** Advance the per-segment ease toward the latest targets. Call once per frame. */
export function tickTraffic(dt: number): void {
  if (!built) return;
  const k = 1 - Math.exp(-Math.max(0, dt) / TAU_S);
  for (const hw of HIGHWAYS) {
    const cur = shown[hw.id];
    const tgt = target[hw.id];
    for (let i = 0; i < cur.length; i++) cur[i] += (tgt[i] - cur[i]) * k;
  }
}

/** Live congestion for one segment: eased value + how much it should count (0..1).
 *  w folds spatial coverage with feed freshness; w=0 means "use the model". */
export function liveCong(id: string, seg: number): { val: number; w: number } {
  const cur = shown[id];
  const cov = cover[id];
  if (!cur || seg < 0 || seg >= cur.length) return { val: 0, w: 0 };
  return { val: cur[seg], w: cov[seg] * freshness() };
}

/** Begin polling /api/traffic (~every 60 s). Idempotent. */
export function startTraffic(): void {
  if (started) return;
  started = true;
  const poll = () => {
    fetch("/api/traffic")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j || !Array.isArray(j.stations) || j.stations.length === 0) return;
        stations = j.stations as Station[];
        fetchedAt = Date.now();
        rebuildTargets();
      })
      .catch(() => {});
  };
  poll();
  setInterval(poll, 60 * 1000);
}
