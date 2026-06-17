// Bundled marine lanes for Puget Sound — Washington State Ferry routes plus a couple of
// generic shipping lanes through the central Sound / Elliott Bay. As with highways there's
// no keyless per-vessel feed, so VesselLayer SYNTHESIZES traffic moving along these lanes
// (honest texture; live AIS via aisstream.io/AIS-catcher is a follow-up). Points are
// [lat, lon] ordered terminal→terminal (ferries bounce) or along-channel (shipping loops).

export interface Lane {
  id: string;
  name: string;   // shown only for ferries, only in ambientMode
  ferry: boolean;
  count: number;  // vessels populating this lane
  speedKts: number;
  path: [number, number][];
}

export const LANES: Lane[] = [
  // --- WSF ferry routes (named landmarks) ---
  { id: "bainbridge", name: "Bainbridge ferry", ferry: true, count: 2, speedKts: 18,
    path: [[47.6025, -122.3387], [47.6155, -122.4300], [47.6228, -122.5114]] },
  { id: "bremerton", name: "Bremerton ferry", ferry: true, count: 1, speedKts: 16,
    path: [[47.6025, -122.3387], [47.5900, -122.4900], [47.5640, -122.6240]] },
  { id: "edmonds", name: "Edmonds–Kingston ferry", ferry: true, count: 1, speedKts: 15,
    path: [[47.8130, -122.3825], [47.8040, -122.4400], [47.7950, -122.4970]] },
  { id: "fauntleroy", name: "Vashon ferry", ferry: true, count: 1, speedKts: 14,
    path: [[47.5230, -122.3965], [47.5160, -122.4300], [47.5080, -122.4640]] },
  // --- generic shipping lanes (cargo/tankers) ---
  { id: "ship-central", name: "", ferry: false, count: 3, speedKts: 12,
    path: [[47.9300, -122.4400], [47.8200, -122.4200], [47.7000, -122.4300],
           [47.6200, -122.4100], [47.5400, -122.4200], [47.4200, -122.4500]] },
  { id: "ship-elliott", name: "", ferry: false, count: 2, speedKts: 10,
    path: [[47.6300, -122.3850], [47.6050, -122.3650], [47.5850, -122.3500],
           [47.5650, -122.3450]] },
];

const DEG = Math.PI / 180;

// Per-lane cumulative arc length (equirectangular metres) — computed once, lazily.
interface LaneMetric { cum: number[]; total: number }
const metrics = new Map<string, LaneMetric>();

function metric(lane: Lane): LaneMetric {
  let m = metrics.get(lane.id);
  if (m) return m;
  const cum = [0];
  for (let i = 1; i < lane.path.length; i++) {
    const [la1, lo1] = lane.path[i - 1], [la2, lo2] = lane.path[i];
    const mlat = ((la1 + la2) / 2) * DEG;
    const dx = (lo2 - lo1) * Math.cos(mlat) * 111320;
    const dy = (la2 - la1) * 110540;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  m = { cum, total: cum[cum.length - 1] };
  metrics.set(lane.id, m);
  return m;
}

/** Seconds for a vessel to traverse the lane once, end to end. */
export function lanePeriod(lane: Lane): number {
  return metric(lane).total / Math.max(0.5, lane.speedKts * 0.5144);
}

/** Position + travel direction at fraction u∈[0,1] along the lane. dir flips the heading. */
export function laneAt(lane: Lane, u: number): { lat: number; lon: number } {
  const m = metric(lane);
  const target = Math.max(0, Math.min(1, u)) * m.total;
  let i = 1;
  while (i < m.cum.length && m.cum[i] < target) i++;
  if (i >= m.cum.length) i = m.cum.length - 1;
  const segLen = m.cum[i] - m.cum[i - 1] || 1;
  const t = (target - m.cum[i - 1]) / segLen;
  const [la1, lo1] = lane.path[i - 1], [la2, lo2] = lane.path[i];
  return { lat: la1 + (la2 - la1) * t, lon: lo1 + (lo2 - lo1) * t };
}
