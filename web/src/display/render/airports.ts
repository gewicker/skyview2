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
    // Thresholds from FAA/airnav; lengths verified (11,901 / 9,426 / 8,500 ft). 16L is
    // the EAST runway, 16R the WEST (the prior data had L/R longitudes swapped).
    { leIdent: "16L", heIdent: "34R", le: [47.463795, -122.307750], he: [47.431172, -122.308038], widthFt: 150 },
    { leIdent: "16C", heIdent: "34C", le: [47.463810, -122.310984], he: [47.437971, -122.311210], widthFt: 150 },
    { leIdent: "16R", heIdent: "34L", le: [47.463836, -122.317857], he: [47.440534, -122.318058], widthFt: 150 },
  ],
};
export const KBFI: Airport = {
  icao: "KBFI",
  iata: "BFI",
  name: "Boeing Field",
  elevFt: 21,
  runways: [
    // FAA/airnav thresholds; lengths verified (10,007 / 3,709 ft).
    { leIdent: "14R", heIdent: "32L", le: [47.540543, -122.311354], he: [47.516737, -122.291228], widthFt: 200 },
    { leIdent: "14L", heIdent: "32R", le: [47.538018, -122.307460], he: [47.529194, -122.300001], widthFt: 100 },
  ],
};
export const KRNT: Airport = {
  icao: "KRNT",
  iata: "RNT",
  name: "Renton",
  elevFt: 32,
  // FAA/airnav thresholds; length verified (5,382 ft).
  runways: [{ leIdent: "16", heIdent: "34", le: [47.500474, -122.216853], he: [47.485795, -122.214631], widthFt: 200 }],
};

export const KPAE: Airport = {
  icao: "KPAE",
  iata: "PAE",
  name: "Paine Field",
  elevFt: 606,
  // FAA/airnav thresholds; lengths verified (9,010 / 3,004 ft).
  runways: [
    { leIdent: "16R", heIdent: "34L", le: [47.921336, -122.285851], he: [47.896640, -122.285303], widthFt: 150 },
    { leIdent: "16L", heIdent: "34R", le: [47.906425, -122.271693], he: [47.898192, -122.271601], widthFt: 75 },
  ],
};

export const AIRPORTS: Airport[] = [KSEA, KBFI, KRNT, KPAE];
