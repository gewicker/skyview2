// Notable classification. Beyond emergencies and military we surface public-service
// and standout traffic, each with its own alert treatment: a blinking screen-edge
// border (highest-priority category present) + a small stylised emblem on the target.
// Emblems are generic symbols (medical cross, flame, shield, chevron), NOT real
// agency logos — keeps it legal and visually consistent with the clean SkyView look.
import type { RGB } from "./colors";

export type NotableCat = "emergency" | "medical" | "fire" | "police" | "military" | "heavy" | "rare";

export type Emblem = "warn" | "cross" | "flame" | "shield" | "chevron" | "none";

export interface CatStyle {
  color: RGB;      // border + bracket colour
  border: boolean; // gets the blinking screen-edge border
  priority: number;// higher wins the edge border when several are present
  label: string;
  emblem: Emblem;
}

// Only a true EMERGENCY earns the screen-edge border (this lives by a bed; routine
// military/medical/police traffic must not strobe the frame). The rest are identified
// by their on-target emblem + bracket only.
export const NOTABLE_STYLE: Record<NotableCat, CatStyle> = {
  emergency: { color: [235, 70, 58], border: true, priority: 6, label: "EMERGENCY", emblem: "warn" },
  medical: { color: [236, 238, 242], border: false, priority: 5, label: "MEDICAL", emblem: "cross" },
  fire: { color: [255, 138, 38], border: false, priority: 4, label: "FIRE", emblem: "flame" },
  police: { color: [70, 132, 255], border: false, priority: 3, label: "POLICE", emblem: "shield" },
  military: { color: [124, 140, 80], border: false, priority: 2, label: "MILITARY", emblem: "chevron" },
  heavy: { color: [120, 180, 255], border: false, priority: 1, label: "HEAVY", emblem: "none" },
  rare: { color: [255, 184, 72], border: false, priority: 1, label: "RARE", emblem: "none" },
};

const EMERGENCY = new Set(["7500", "7600", "7700"]);

// Callsign keyword heuristics (best-effort — air-ambulance/LE flights aren't perfectly
// labelled in ADS-B). Matched as whole-word or prefix on the trimmed callsign.
const MEDICAL = ["LIFEGUARD", "LIFEFLIGHT", "LIFEFLT", "LIFE", "MEDEVAC", "MEDIC", "MERCY", "ANGEL", "AIRLIFT", "AIRMED", "STARFLIGHT", "STARFLT", "NIGHTINGALE", "MEDSTAR", "AIRMETHODS"];
const FIRE = ["TANKER", "AIRTANKER", "HELITAK", "HELITANK", "FIREBIRD", "BIRDDOG", "CALFIRE", "FIREFLY", "BOMBER", "SMOKEY", "FIRE"];
const POLICE = ["POLICE", "SHERIFF", "TROOPER", "PATROL", "STARCHASE", "GUARDIAN", "LAWMAN", "NPAS", "FOXTROT", "AIRUNIT", "COPTER"];
const MILITARY = ["RCH", "REACH", "EVAC", "PAT", "CNV", "GRZLY", "DOOM", "SENTRY", "BLKCAT", " HERKY", "VADER", "GUARD"];

const RARE = new Set([
  "A388", "A124", "A225", "C5M", "B748", "B74S", "B74R", "AN22", "B52", "B1", "B2",
  "U2", "SR71", "C17", "E3CF", "E3TF", "E6", "KC10", "VC25", "B377", "DC3", "DC6",
  "B17", "B29", "P51", "SPIT", "CONC", "TU95", "A400",
]);
const HEAVY = new Set([
  "A332", "A333", "A338", "A339", "A359", "A35K", "A342", "A343", "A345", "A346",
  "B762", "B763", "B764", "B772", "B77L", "B773", "B77W", "B788", "B789", "B78X",
  "B741", "B742", "B743", "B744", "MD11", "DC10", "L101", "IL96",
]);

interface AC { squawk?: string; flight?: string; typeCode?: string; category?: string }

function hasWord(cs: string, words: string[]): boolean {
  for (const w of words) if (cs.startsWith(w.trim()) || cs.includes(w.trim())) return true;
  return false;
}

export function classifyNotable(a: AC): NotableCat | null {
  if (a.squawk && EMERGENCY.has(a.squawk)) return "emergency";
  const cs = (a.flight || "").trim().toUpperCase();
  if (cs) {
    if (hasWord(cs, MEDICAL)) return "medical";
    if (hasWord(cs, FIRE)) return "fire";
    if (hasWord(cs, POLICE)) return "police";
    for (const p of MILITARY) if (cs.startsWith(p.trim())) return "military";
  }
  const t = (a.typeCode || "").toUpperCase();
  if (t && RARE.has(t)) return "rare";
  if (a.category === "A5" || (t && HEAVY.has(t))) return "heavy";
  return null;
}

// Back-compat for any old import.
export const NOTABLE_COLOR: Record<NotableCat, RGB> = Object.fromEntries(
  Object.entries(NOTABLE_STYLE).map(([k, v]) => [k, v.color]),
) as Record<NotableCat, RGB>;
