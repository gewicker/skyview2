// Simulated Link light-rail trains, driven by the published TIMETABLE (interim until the live
// OneBusAway GPS feed key arrives — see skyview-light-rail notes). Trains glide along the station
// chords at the scheduled cadence: spawn at each terminus every headway within the service span,
// cross end-to-end in `runtime`, both directions. Position is an arc-length fraction along the
// ordered stops, interpolated by cumulative chord distance.
//
// Per the design pass: SCHEDULED trains render as HOLLOW, slightly-desaturated beads (a plausible
// guess, not a measurement). When the live key lands, the same beads will gain a solid core and
// full saturation so going live reads as an upgrade. See TrainLayer.ts for the visual.
//
// SCOPE (v1): the 2 Line (South Bellevue <-> Marymoor Village) — the locally visible East Link
// segment, with complete contiguous station coords from OSM (rail.ts). The 1 Line is deferred: its
// station data has gaps (missing Rainier Valley -> SeaTac) and airport-gate noise; it needs a
// complete ordered OSM station capture first. East Main + Downtown Redmond termini also await data.

export interface TrainStop { name: string; lat: number; lon: number; }
export interface Daypart { from: number; to: number; headway: number; } // minutes from local midnight
export interface TrainLine {
  id: string;
  name: string;
  rgb: [number, number, number];   // base line tint (2 Line emerald; 1 Line will be a cooler blue)
  stops: TrainStop[];               // ordered, terminus -> terminus
  spanStart: number;                // service span, minutes from local midnight
  spanEnd: number;
  runtime: number;                  // one-way end-to-end, minutes
  dayparts: Daypart[];              // headway by time of day (nominal, from the published schedule)
}

export const TRAIN_LINES: TrainLine[] = [
  {
    id: "2",
    name: "2 Line",
    rgb: [0, 124, 173],             // official 2 Line blue (OBA 007CAD) — matches the live beads
    stops: [
      { name: "South Bellevue", lat: 47.586555, lon: -122.190412 },
      { name: "Bellevue Downtown", lat: 47.615234, lon: -122.191932 },
      { name: "Wilburton", lat: 47.617955, lon: -122.183811 },
      { name: "Spring District", lat: 47.623788, lon: -122.178499 },
      { name: "BelRed", lat: 47.624457, lon: -122.165728 },
      { name: "Overlake Village", lat: 47.636321, lon: -122.138928 },
      { name: "Redmond Technology", lat: 47.644798, lon: -122.133633 },
      { name: "Marymoor Village", lat: 47.667285, lon: -122.109574 },
    ],
    spanStart: 300, spanEnd: 1440,  // ~5:00am to midnight
    runtime: 22,                    // South Bellevue <-> Marymoor Village, ~22 min
    dayparts: [
      { from: 300, to: 360, headway: 15 },   // early
      { from: 360, to: 540, headway: 8 },    // AM peak
      { from: 540, to: 900, headway: 10 },   // midday
      { from: 900, to: 1110, headway: 8 },   // PM peak
      { from: 1110, to: 1320, headway: 12 }, // evening
      { from: 1320, to: 1440, headway: 15 }, // late
    ],
  },
];

export interface SimTrain {
  line: TrainLine;
  lat: number; lon: number;     // bead position
  tlat: number; tlon: number;   // tail point (trails behind the direction of travel)
}

// Cumulative chord distance (km) along each line's stops — computed once per line.
const CUM = new WeakMap<TrainLine, number[]>();
function cum(line: TrainLine): number[] {
  let c = CUM.get(line);
  if (c) return c;
  c = [0];
  for (let i = 1; i < line.stops.length; i++) {
    const a = line.stops[i - 1], b = line.stops[i];
    c.push(c[i - 1] + haversine(a.lat, a.lon, b.lat, b.lon));
  }
  CUM.set(line, c);
  return c;
}
function haversine(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371, d = Math.PI / 180;
  const dla = (la2 - la1) * d, dlo = (lo2 - lo1) * d;
  const a = Math.sin(dla / 2) ** 2 + Math.cos(la1 * d) * Math.cos(la2 * d) * Math.sin(dlo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function headwayFor(line: TrainLine, nowMin: number): number {
  for (const d of line.dayparts) if (nowMin >= d.from && nowMin < d.to) return d.headway;
  return line.dayparts[line.dayparts.length - 1].headway;
}

// frac (0..1, from the first stop) -> interpolated lat/lon along the station chords.
function posAt(line: TrainLine, frac: number): { lat: number; lon: number } {
  const c = cum(line);
  const total = c[c.length - 1];
  const target = Math.max(0, Math.min(1, frac)) * total;
  let i = 1;
  while (i < c.length - 1 && c[i] < target) i++;
  const seg = c[i] - c[i - 1];
  const t = seg > 0 ? (target - c[i - 1]) / seg : 0;
  const a = line.stops[i - 1], b = line.stops[i];
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

const TAIL = 0.018; // comet-tail length as a fraction of the whole line

// Every train that should be running right now (local time), per the timetable.
export function simTrains(nowMin: number): SimTrain[] {
  const out: SimTrain[] = [];
  for (const line of TRAIN_LINES) {
    if (nowMin < line.spanStart || nowMin > line.spanEnd) continue; // no phantom trains off-hours
    const H = headwayFor(line, nowMin), R = line.runtime;
    for (const dir of [1, -1] as const) {
      const base = line.spanStart + (dir < 0 ? H / 2 : 0); // offset the two directions
      const kStart = Math.ceil((nowMin - R - base) / H);
      const kEnd = Math.floor((nowMin - base) / H);
      for (let k = kStart; k <= kEnd; k++) {
        const t0 = base + k * H;                      // this train's terminus departure
        if (t0 < line.spanStart || t0 > line.spanEnd) continue;
        const p = (nowMin - t0) / R;                  // 0..1 progress along its run
        if (p < 0 || p > 1) continue;
        const frac = dir > 0 ? p : 1 - p;             // arc-length fraction from the first stop
        const tailFrac = frac - dir * TAIL;
        const pos = posAt(line, frac);
        const tp = posAt(line, tailFrac);
        out.push({ line, lat: pos.lat, lon: pos.lon, tlat: tp.lat, tlon: tp.lon });
      }
    }
  }
  return out;
}

// Minutes from local midnight (the Pi kiosk runs Pacific local time). Includes ms for fluid motion.
export function nowMinLocal(d = new Date()): number {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60000;
}
