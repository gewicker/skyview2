// Client-side notable classification (mirrors internal/notable on the server) so the
// renderer can flag standout traffic without extra plumbing. Most of your sky is
// routine 737s/A320s, so beyond emergencies/military we also surface heavies and a
// curated set of rare/special airframes.
export type NotableCat = "emergency" | "military" | "heavy" | "rare";

export const NOTABLE_COLOR: Record<NotableCat, [number, number, number]> = {
  emergency: [232, 72, 60],
  military: [124, 140, 80],
  heavy: [120, 180, 255],
  rare: [255, 184, 72],
};

const EMERGENCY = new Set(["7500", "7600", "7700"]);
const MILITARY = ["RCH", "REACH", "EVAC", "PAT", "CNV", "GRZLY", "DOOM", "SENTRY", "BLKCAT"];

// Rare / special airframes worth calling out around Seattle (very-heavies, freighters,
// VIP, vintage, oddballs). ICAO type codes.
const RARE = new Set([
  "A388", "A124", "A225", "C5M", "B748", "B74S", "B74R", "AN22", "B52",
  "B1", "B2", "U2", "SR71", "C17", "E3CF", "E3TF", "E6", "KC10", "VC25", "B377",
  "DC3", "DC6", "B17", "B29", "P51", "SPIT", "CONC", "TU95", "A400",
]);

// Widebody / quad type codes → "heavy" (fallback to ADS-B emitter category A5).
const HEAVY = new Set([
  "A332", "A333", "A338", "A339", "A359", "A35K", "A342", "A343", "A345", "A346",
  "B762", "B763", "B764", "B772", "B77L", "B773", "B77W", "B788", "B789", "B78X",
  "B741", "B742", "B743", "B744", "MD11", "DC10", "L101", "IL96",
]);

export function classifyNotable(a: { squawk?: string; flight?: string; typeCode?: string; category?: string }): NotableCat | null {
  if (a.squawk && EMERGENCY.has(a.squawk)) return "emergency";
  const cs = (a.flight || "").trim().toUpperCase();
  for (const p of MILITARY) if (cs.startsWith(p)) return "military";
  const t = (a.typeCode || "").toUpperCase();
  if (t && RARE.has(t)) return "rare";
  if (a.category === "A5" || (t && HEAVY.has(t))) return "heavy";
  return null;
}
