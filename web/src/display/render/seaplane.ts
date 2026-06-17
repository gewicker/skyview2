// Bundled SEAPLANE BASES for the local lakes (Lake Washington / Lake Union). Kept SEPARATE
// from airports.ts on purpose: seaplanes land on WATER, not pavement — there are no painted
// runways, no edge lights, no taxiway network — so these must never leak into the concrete
// runway / installed-lighting / glidepath machinery that iterates AIRPORTS. A "lane" here is
// an FAA water operating-area, drawn as a soft translucent corridor (see SeaplaneLayer), not
// a runway ribbon. Lane endpoints are placed on the actual water (open-water lanes are
// inherently advisory; these can be GPS-refined). Idents/positions from FAA (S60/W55/W36).

export interface WaterLane {
  leIdent: string;
  heIdent: string;
  le: [number, number]; // [lat, lon] low-numbered end
  he: [number, number]; // [lat, lon] high-numbered end
  widthFt: number;
}

// A small bit of shore detail. p is a flat [lat,lon,...] polyline (1 point for a marker,
// 2+ for a ramp/pier line). kind drives the muted vector style in SeaplaneLayer.
export interface DockMark {
  kind: "dock" | "terminal" | "ramp";
  p: number[];
}

export interface SeaplaneBase {
  ident: string; // FAA LID: S60 / W55 / W36
  name: string;
  lat: number;   // anchor-in-circle glyph + faint dock-light position
  lon: number;
  lanes: WaterLane[];
  marks: DockMark[];
}

export const SEAPLANE_BASES: SeaplaneBase[] = [
  {
    ident: "S60", name: "Kenmore Air Harbor",
    lat: 47.75482, lon: -122.25929,
    lanes: [
      // 16/34: the long lane (10,000×1000 ft) running S down the north end of Lake Washington.
      { leIdent: "16", heIdent: "34", le: [47.75450, -122.26250], he: [47.72720, -122.25750], widthFt: 1000 },
      // 18/36: the short alternate (3,000×1000 ft), nearly N–S, off the Kenmore shore.
      { leIdent: "18", heIdent: "36", le: [47.75450, -122.26050], he: [47.74630, -122.26000], widthFt: 1000 },
    ],
    marks: [
      { kind: "terminal", p: [47.75500, -122.26020] },
      { kind: "dock", p: [47.75460, -122.25840, 47.75420, -122.25840] },
    ],
  },
  {
    ident: "W55", name: "Lake Union",
    lat: 47.62889, lon: -122.33861,
    lanes: [
      // 16/34 (5,000×500 ft): Gas Works Park (N) → Lake Union Park (S), down the lake's long axis.
      { leIdent: "16", heIdent: "34", le: [47.64480, -122.33450], he: [47.62980, -122.33720], widthFt: 500 },
    ],
    marks: [
      // South Lake Union terminal on the south shore.
      { kind: "terminal", p: [47.62900, -122.33930] },
    ],
  },
  {
    ident: "W36", name: "Will Rogers–Wiley Post Mem.",
    lat: 47.50250, lon: -122.21950,
    lanes: [
      // Advisory water area on the south end of Lake Washington, off the NW corner of KRNT,
      // running N into the lake. Short (W36 is mainly a ramp + dock).
      { leIdent: "16", heIdent: "34", le: [47.51400, -122.21300], he: [47.50300, -122.21850], widthFt: 600 },
    ],
    marks: [
      // Launch ramp from shore into the water + a small dock.
      { kind: "ramp", p: [47.50230, -122.21900, 47.50320, -122.21820] },
      { kind: "dock", p: [47.50270, -122.21770, 47.50230, -122.21760] },
    ],
  },
];
