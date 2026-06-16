// Curated local place labels (Bellevue / Lake Washington area), drawn through the
// map projection for the satellite/wire styles (the dark vector style keeps its own
// baked labels). Coordinates are city/feature centroids; approximate is fine.
export interface Place {
  name: string;
  lat: number;
  lon: number;
  major?: boolean;
  water?: boolean;
}

export const PLACES: Place[] = [
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
];
