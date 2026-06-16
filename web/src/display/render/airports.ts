// Bundled airport geometry (OurAirports values for the Seattle area), drawn at true
// position so arrivals/departures line up with the runways and approach corridors
// are computed from real thresholds.
export interface Runway {
  leIdent: string;
  heIdent: string;
  le: [number, number]; // [lat, lon] low-numbered threshold
  he: [number, number]; // [lat, lon] high-numbered threshold
  widthFt: number;
}
export interface Airport {
  icao: string;
  iata: string; // ADS-B route destinations arrive as IATA codes (SEA, BFI, RNT)
  name: string;
  elevFt: number; // field elevation MSL — used to deconflict collinear finals by glidepath
  runways: Runway[];
}

export const KSEA: Airport = {
  icao: "KSEA",
  iata: "SEA",
  name: "Sea-Tac",
  elevFt: 433,
  runways: [
    { leIdent: "16L", heIdent: "34R", le: [47.46384, -122.31121], he: [47.4337, -122.31085], widthFt: 150 },
    { leIdent: "16C", heIdent: "34C", le: [47.46519, -122.3079], he: [47.43169, -122.30748], widthFt: 150 },
    { leIdent: "16R", heIdent: "34L", le: [47.46695, -122.30453], he: [47.44313, -122.30425], widthFt: 200 },
  ],
};
export const KBFI: Airport = {
  icao: "KBFI",
  iata: "BFI",
  name: "Boeing Field",
  elevFt: 21,
  runways: [
    { leIdent: "14R", heIdent: "32L", le: [47.54113, -122.30707], he: [47.51234, -122.29897], widthFt: 200 },
    { leIdent: "14L", heIdent: "32R", le: [47.53283, -122.30307], he: [47.52336, -122.30037], widthFt: 100 },
  ],
};
export const KRNT: Airport = {
  icao: "KRNT",
  iata: "RNT",
  name: "Renton",
  elevFt: 32,
  runways: [{ leIdent: "16", heIdent: "34", le: [47.50293, -122.2167], he: [47.48355, -122.21934], widthFt: 200 }],
};

export const AIRPORTS: Airport[] = [KSEA, KBFI, KRNT];
