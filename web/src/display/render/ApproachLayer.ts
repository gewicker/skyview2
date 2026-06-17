// Approach awareness: detect aircraft established on the extended centerline of a
// local runway (KSEA/KBFI/KRNT) — laterally aligned, tracking the course, low and
// inbound — and tag them with the runway they're lined up for. You're right under
// the Sea-Tac flows, so this is the high-signal overlay.
import type { Layer, FrameContext } from "./types";
import { AIRPORTS } from "./airports";

const DEG = Math.PI / 180;
const MI = 1609.34;

interface End {
  icao: string;
  iata: string; // owning airport's IATA, matched against the aircraft's destination
  ident: string; // runway you'd be landing on
  tLat: number; // touchdown threshold
  tLon: number;
  course: number; // landing heading, deg
  elevFt: number; // field elevation MSL (threshold) — for the glidepath fit
  cosLat: number; // cos(tLat) — precomputed (constant per end)
  ux: number; // sin(course)  ┐ landing-direction unit vector (E,N)
  uy: number; // cos(course)  ┘
}

// Precompute both landing directions for every runway once, with the trig hoisted out of
// the per-aircraft/per-frame hot path in match().
const ENDS: End[] = (() => {
  const out: End[] = [];
  const mk = (ap: typeof AIRPORTS[number], ident: string, thr: readonly [number, number], course: number): End => {
    const cb = course * DEG;
    return {
      icao: ap.icao, iata: ap.iata, ident, tLat: thr[0], tLon: thr[1], course, elevFt: ap.elevFt,
      cosLat: Math.cos(thr[0] * DEG), ux: Math.sin(cb), uy: Math.cos(cb),
    };
  };
  for (const ap of AIRPORTS) {
    for (const rw of ap.runways) {
      const a = bearing(rw.le[0], rw.le[1], rw.he[0], rw.he[1]); // le→he
      out.push(mk(ap, rw.leIdent, rw.le, a));
      out.push(mk(ap, rw.heIdent, rw.he, (a + 180) % 360));
    }
  }
  return out;
})();

const GP_FT_PER_NM = 318;   // 3.00° glidepath ≈ 318 ft per NM
const GP_TOL_FT = 900;      // reject a candidate the aircraft is wildly off the glidepath for

const LOCAL_IATA = new Set(AIRPORTS.map((ap) => ap.iata));

export class ApproachLayer implements Layer {
  readonly name = "approach";

  draw(f: FrameContext): void {
    if (!f.cfg.showFinal) return;
    const ctx = f.ctx;
    ctx.save();
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (const a of f.aircraft) {
      if (a.onGround) continue;
      if (a.altBaro != null && a.altBaro > 6000) continue; // only low, inbound traffic
      // Geometry decides whether it's on final; the destination is used ONLY to
      // disambiguate between local fields (see match), never to suppress a tag — the
      // route DB frequently shows an arrival's outbound city (e.g. "SFO"), so trusting
      // it to gate tagging wrongly hid genuine finals.
      const m = match(a);
      if (!m) continue;
      const p = f.cam.project(a.lat, a.lon);

      // "Established on final" is conveyed by the runway tag itself — no enclosing
      // bracket. Rule across the app: shapes around a target mean SELECTION; status is
      // shown by colour/weight. (The old cyan diamond collided with the cyan selection
      // ring, so a glance couldn't tell "selected" from "merely on final".) The tag gets
      // a bright treatment + a "locked on final" bullet instead — far cheaper than a
      // pulsing reticle, and unambiguous. No shadowBlur (Pi software render).
      const tag = `${m.ident} ${m.icao.replace(/^K/, "")} · ${m.miles.toFixed(1)} mi`;
      ctx.font = "600 11px system-ui, sans-serif";
      ctx.textAlign = "left";
      const tw = ctx.measureText(tag).width;
      const bullet = 5; // cyan "on final" dot + gap before the text
      const boxW = bullet + 4 + tw;
      const ty = p.y + 18;            // centered below the glyph (no diamond offset now)
      const bx = p.x - boxW / 2;
      // No plate (box = selection across the app): a bright cyan bullet + outlined text is the one
      // high-signal "on final" event — bright cyan is reserved for THIS (passive chart furniture is dim).
      ctx.fillStyle = "rgba(150,230,255,0.97)";
      ctx.beginPath();
      ctx.arc(bx + 2, ty, 2.5, 0, 6.283);
      ctx.fill();
      ctx.lineJoin = "round";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.strokeText(tag, bx + bullet + 4, ty);
      ctx.fillStyle = "rgba(150,230,255,0.97)";
      ctx.fillText(tag, bx + bullet + 4, ty);
    }
    ctx.restore();
  }
}

export interface Match { iata: string; icao: string; ident: string; miles: number }

// What a candidate arrival needs to expose — a structural subset so this works for both the
// renderer's Visible and the route-card's Aircraft.
export type ArrivalInput = {
  lat?: number | null; lon?: number | null; altBaro?: number | null;
  track?: number | null; destination?: string; onGround?: boolean;
};

// PUBLIC AUTHORITY for a local "→ DEST": the field an aircraft is physically established on
// final to, by glidepath + lateral-alignment physics. Replaces the old nearest-centroid test,
// which mislabels SEA arrivals as BFI (the fields sit ~4 mi apart and SEA's north approach
// passes right over Boeing Field). Returns null unless genuinely on a runway's final.
export function arrivalField(a: ArrivalInput): Match | null {
  if (a.onGround) return null;
  if (a.altBaro != null && a.altBaro > 6000) return null;
  return match(a);
}

// Pick the runway an aircraft is actually on final to. Lateral alignment qualifies a
// candidate; the DEFINITIVE separation between near/far collinear runways (BFI 14R vs
// SEA 16R share a centerline) is the GLIDEPATH FIT — at a given point the near-field
// arrival is far lower than the far-field one. We score each candidate by how close the
// aircraft's altitude is to that runway's 3° glidepath, then let a known local
// destination act only as a gentle tiebreak (never override the physics).
function match(a: ArrivalInput): Match | null {
  if (a.lat == null || a.lon == null) return null;
  let best: Match | null = null;
  let bestScore = Infinity;
  const destLocal = a.destination && LOCAL_IATA.has(a.destination) ? a.destination : null;
  for (const e of ENDS) {
    // Local east/north metres from the threshold.
    const east = (a.lon - e.tLon) * e.cosLat * 111320;
    const north = (a.lat - e.tLat) * 110540;
    const ux = e.ux, uy = e.uy; // landing direction (E,N), precomputed
    const along = east * ux + north * uy; // +ve past threshold; approach side is −ve
    const dist = -along; // metres before the threshold
    if (dist < 300 || dist > 12 * MI) continue;
    const latOff = Math.abs(east * uy - north * ux); // lateral offset (metres) from this centerline
    if (latOff > 0.7 * MI) continue;
    const latPenaltyFt = latOff * 3.28084; // metres → ft, so it combines with the glidepath altErr below
    // Heading must be flying the course (within ~28°).
    if (a.track != null) {
      const d = Math.abs(((a.track - e.course + 540) % 360) - 180);
      if (d > 28) continue;
    }
    const miles = dist / MI;

    // Score = glidepath fit + lateral alignment. The glidepath (altitude vs 3° path) separates
    // collinear near/far fields (BFI 14R vs SEA 16R); the lateral penalty separates the PARALLEL
    // runways that share a glidepath (SEA 34R/34C/34L) — the aircraft is matched to the parallel
    // whose extended centerline it's actually flying, not just the first one in the list.
    let score: number;
    if (a.altBaro != null) {
      const gpAlt = e.elevFt + miles * GP_FT_PER_NM;
      const altErr = Math.abs(a.altBaro - gpAlt);
      if (altErr > GP_TOL_FT) continue; // not on THIS runway's glidepath — rule it out
      score = altErr + latPenaltyFt;
    } else {
      score = miles * GP_FT_PER_NM + latPenaltyFt; // no altitude: nearest-threshold + alignment
    }
    if (destLocal && e.iata === destLocal) score *= 0.6; // gentle prior toward stated dest

    if (score < bestScore) { bestScore = score; best = { iata: e.iata, icao: e.icao, ident: e.ident, miles }; }
  }
  return best;
}

function bearing(la1: number, lo1: number, la2: number, lo2: number): number {
  const p1 = la1 * DEG, p2 = la2 * DEG, dl = (lo2 - lo1) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / DEG) % 360 + 360) % 360;
}
