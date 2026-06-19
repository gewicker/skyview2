// Curated local place labels (Bellevue / Lake Washington area), drawn through the
// map projection for the satellite/wire styles (the dark vector style keeps its own
// baked labels). Coordinates are city/feature centroids; approximate is fine.
export interface Place {
  name: string;
  lat: number;
  lon: number;
  major?: boolean;
  water?: boolean;
  // local = a sub-city neighborhood / landmark (e.g. a Bellevue district or an East Link
  // station area). These read the home Eastside richly but would clutter the default ~16-mile
  // view, so PlaceLabelsLayer only draws them once the user has zoomed in (see that layer's
  // zoom gate). City/water labels above are unaffected and always show as before.
  local?: boolean;
}

export const PLACES: Place[] = [
  // Cities (always shown). Bellevue + Seattle are the major anchors; the rest are the
  // surrounding municipalities. Do NOT duplicate these as `local` neighborhoods below.
  { name: "Bellevue", lat: 47.6101, lon: -122.2015, major: true },
  { name: "Seattle", lat: 47.6062, lon: -122.3321, major: true },
  { name: "Kirkland", lat: 47.6769, lon: -122.206 },
  { name: "Redmond", lat: 47.674, lon: -122.1215 },
  { name: "Mercer Island", lat: 47.5707, lon: -122.2221 },
  { name: "Newcastle", lat: 47.5301, lon: -122.1593 },
  { name: "Renton", lat: 47.4829, lon: -122.2171 },
  { name: "Issaquah", lat: 47.5301, lon: -122.0326 },
  { name: "Sammamish", lat: 47.6163, lon: -122.0356 },
  { name: "Tukwila", lat: 47.464, lon: -122.261 },
  { name: "Bothell", lat: 47.7601, lon: -122.2054 },
  { name: "Woodinville", lat: 47.7543, lon: -122.1635 },
  { name: "Kenmore", lat: 47.7573, lon: -122.244 },
  { name: "Lake Washington", lat: 47.61, lon: -122.255, water: true },
  { name: "Lake Sammamish", lat: 47.587, lon: -122.087, water: true },

  // Home-area neighborhoods / landmarks (Bellevue + the East Link / 2 Line spine). Drawn at the
  // quiet (non-major) tier and gated to zoomed-in views so the default panel stays calm. Several
  // of these double as the 2 Line station-area names (Wilburton, Spring District, BelRed,
  // Overlake) — naming the home transit spine by its districts is the deliberate, rebalance-safe
  // East Link emphasis (no rail recoloring; see RailLineLayer note). Skips districts that already
  // appear as their own city above (Newcastle, Issaquah). "Downtown Bellevue" / "Bellevue Square"
  // sit inside the existing "Bellevue" city label, so they only surface once zoomed in.
  { name: "Downtown Bellevue", lat: 47.615, lon: -122.201, local: true },
  { name: "Bellevue Square", lat: 47.617, lon: -122.203, local: true },
  { name: "Wilburton", lat: 47.616, lon: -122.188, local: true },
  { name: "Spring District", lat: 47.623, lon: -122.172, local: true },
  { name: "BelRed", lat: 47.627, lon: -122.164, local: true },
  { name: "Crossroads", lat: 47.616, lon: -122.13, local: true },
  { name: "Overlake", lat: 47.64, lon: -122.134, local: true },
  { name: "Factoria", lat: 47.579, lon: -122.177, local: true },
  { name: "Eastgate", lat: 47.571, lon: -122.148, local: true },
];
