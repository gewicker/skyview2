// Bundled highway centerlines for the local corridor (Seattle / Eastside). These are
// approximate polylines — enough to place the synthetic traffic on the right roads; they
// can be replaced later with surveyed GPS tracks (OSM ways) without touching HighwayLayer.
// Points are [lat, lon], ordered along the road.

export interface Highway {
  id: string;
  name: string;
  base: number;          // baseline congestion 0..1 (busier roads sit higher)
  path: [number, number][];
}

export const HIGHWAYS: Highway[] = [
  {
    id: "i5", name: "I-5", base: 0.55,
    path: [
      [47.722, -122.327], [47.696, -122.325], [47.661, -122.323], [47.620, -122.330],
      [47.591, -122.320], [47.561, -122.312], [47.531, -122.299], [47.487, -122.270],
    ],
  },
  {
    id: "i405", name: "I-405", base: 0.50,
    path: [
      [47.770, -122.203], [47.726, -122.186], [47.697, -122.187], [47.654, -122.191],
      [47.620, -122.187], [47.588, -122.180], [47.535, -122.192], [47.491, -122.202],
    ],
  },
  {
    id: "i90", name: "I-90", base: 0.45,
    path: [
      [47.590, -122.332], [47.591, -122.286], [47.589, -122.246], [47.587, -122.195],
      [47.582, -122.135], [47.573, -122.073],
    ],
  },
  {
    id: "sr520", name: "SR-520", base: 0.42,
    path: [
      [47.641, -122.305], [47.641, -122.274], [47.642, -122.244], [47.640, -122.214],
      [47.633, -122.190], [47.652, -122.140], [47.669, -122.122],
    ],
  },
];

/** Local congestion 0..1 from the wall clock: a rush-hour curve, lighter on weekends.
 *  Honest texture, not live data (live WSDOT travel-times is a follow-up). */
export function congestionNow(base: number): number {
  const d = new Date();
  const hr = d.getHours() + d.getMinutes() / 60;
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  // Two gaussian rush humps (AM ~8, PM ~17.5).
  const hump = (c: number, w: number) => Math.exp(-((hr - c) ** 2) / (2 * w * w));
  let rush = 0.9 * hump(8, 1.3) + 1.0 * hump(17.5, 1.6);
  if (weekend) rush *= 0.45; // weekends: midday-ish, no commute spikes
  // Overnight floor is near-empty.
  const night = hr < 5 || hr > 22 ? 0.15 : 1;
  return Math.max(0, Math.min(1, (0.18 + 0.82 * rush) * night * (0.6 + 0.4 * base)));
}
