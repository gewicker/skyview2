// Approach awareness: detect aircraft established on the extended centerline of a
// local runway (KSEA/KBFI/KRNT) — laterally aligned, tracking the course, low and
// inbound — and tag them with the runway they're lined up for. You're right under
// the Sea-Tac flows, so this is the high-signal overlay.
import type { Layer, FrameContext, Visible } from "./types";
import { AIRPORTS } from "./airports";

const DEG = Math.PI / 180;
const MI = 1609.34;

interface End {
  icao: string;
  ident: string; // runway you'd be landing on
  tLat: number; // touchdown threshold
  tLon: number;
  course: number; // landing heading, deg
}

// Precompute both landing directions for every runway once.
const ENDS: End[] = (() => {
  const out: End[] = [];
  for (const ap of AIRPORTS) {
    for (const rw of ap.runways) {
      const a = bearing(rw.le[0], rw.le[1], rw.he[0], rw.he[1]); // le→he
      const b = (a + 180) % 360;
      out.push({ icao: ap.icao, ident: rw.leIdent, tLat: rw.le[0], tLon: rw.le[1], course: a });
      out.push({ icao: ap.icao, ident: rw.heIdent, tLat: rw.he[0], tLon: rw.he[1], course: b });
    }
  }
  return out;
})();

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
      const m = match(a);
      if (!m) continue;
      const p = f.cam.project(a.lat, a.lon);
      const pulse = 0.5 + 0.5 * Math.sin(f.t * 4);

      // Diamond bracket around the target.
      ctx.strokeStyle = `rgba(120,225,255,${(0.55 + 0.35 * pulse).toFixed(3)})`;
      ctx.lineWidth = 1.5;
      const r = 13;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y);
      ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y);
      ctx.closePath();
      ctx.stroke();

      // Runway tag — centered BELOW the glyph. The identity label sits to the
      // right at the glyph's vertical center, so anchoring here keeps the two from
      // overlapping (the old p.y anchor buried the callsign under "… mi").
      const tag = `${m.ident} ${m.icao.replace(/^K/, "")} · ${m.miles.toFixed(1)} mi`;
      ctx.font = "600 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      const tw = ctx.measureText(tag).width;
      const ty = p.y + r + 12;
      ctx.fillStyle = "rgba(8,20,28,0.72)";
      roundRect(ctx, p.x - tw / 2 - 5, ty - 9, tw + 10, 18, 4);
      ctx.fill();
      ctx.fillStyle = "rgba(170,235,255,0.95)";
      ctx.fillText(tag, p.x, ty);
    }
    ctx.restore();
  }
}

interface Match { icao: string; ident: string; miles: number }

function match(a: Visible): Match | null {
  let best: Match | null = null;
  for (const e of ENDS) {
    // Local east/north metres from the threshold.
    const east = (a.lon - e.tLon) * Math.cos(e.tLat * DEG) * 111320;
    const north = (a.lat - e.tLat) * 110540;
    const cb = e.course * DEG;
    const ux = Math.sin(cb), uy = Math.cos(cb); // landing direction (E,N)
    const along = east * ux + north * uy; // +ve past threshold; approach side is −ve
    const dist = -along; // metres before the threshold
    if (dist < 300 || dist > 12 * MI) continue;
    const latOff = Math.abs(east * uy - north * ux); // lateral offset
    if (latOff > 0.7 * MI) continue;
    // Heading must be flying the course (within ~28°).
    if (a.track != null) {
      let d = Math.abs(((a.track - e.course + 540) % 360) - 180);
      if (d > 28) continue;
    }
    const miles = dist / MI;
    if (!best || miles < best.miles) best = { icao: e.icao, ident: e.ident, miles };
  }
  return best;
}

function bearing(la1: number, lo1: number, la2: number, lo2: number): number {
  const p1 = la1 * DEG, p2 = la2 * DEG, dl = (lo2 - lo1) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / DEG) % 360 + 360) % 360;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
