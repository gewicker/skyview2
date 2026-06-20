// Hospital / medevac HELIPORTS — real FAA-charted heliports at the trauma centers that routinely host
// a medevac helicopter (Airlift Northwest et al.). Kept SEPARATE from airports.ts (a heliport has no
// runways, no glidepath, no installed runway lighting — it must never leak into the concrete-runway
// machinery that iterates AIRPORTS) and from seaplane.ts (those are water aerodromes). A heliport is a
// single rooftop pad, drawn with the real aeronautical chart symbol — an "H" in a circle — plus a
// medical cross, so a helicopter parked there reads as "home base" rather than a stray ground contact.
// Coordinates are FAA-authoritative (the charted heliport reference point); extend the list for other
// medical pads (UW Medical Center, Seattle Children's, etc.) as needed.
export interface Helipad {
  ident: string; // FAA LID, e.g. "WA53"
  name: string;  // full label
  short: string; // compact label when less zoomed in
  lat: number;
  lon: number;
}

export const HELIPADS: Helipad[] = [
  // Harborview Medical Center — the region's Level I trauma center (First Hill, Seattle); Airlift
  // Northwest keeps a medevac helicopter on the rooftop pad. FAA WA53, N47°36.17' W122°19.48'.
  { ident: "WA53", name: "Harborview Medical Center", short: "Harborview", lat: 47.60283, lon: -122.32467 },
];
