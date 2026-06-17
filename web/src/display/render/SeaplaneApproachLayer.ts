// Water-lane approach awareness: tag a floatplane established on a seaplane base's water lane.
// A live (per-frame) layer — NOT in the static airport cache. Reuses the runway-tag look
// (same plate, no enclosing shape) but with WATER-TUNED gates: low + slow + descending, wide
// lateral window (lanes are 500–1000 ft), no 3° glidepath (there's no published GP to water),
// and a teal bullet so it reads as a water arrival vs the land final's brighter cyan.
import type { Layer, FrameContext, Visible } from "./types";
import { SEAPLANE_BASES } from "./seaplane";

const DEG = Math.PI / 180;
const MI = 1609.34;

interface End {
  ident: string; baseIdent: string; baseName: string;
  tLat: number; tLon: number; course: number; halfWidthM: number;
  cosLat: number; ux: number; uy: number;
}

// Precompute both landing directions for every water lane (trig hoisted out of the hot path).
const ENDS: End[] = (() => {
  const out: End[] = [];
  for (const base of SEAPLANE_BASES) {
    for (const lane of base.lanes) {
      const c = bearing(lane.le[0], lane.le[1], lane.he[0], lane.he[1]); // le→he
      const hw = (lane.widthFt * 0.3048) / 2;
      const mk = (ident: string, thr: readonly [number, number], course: number): End => ({
        ident, baseIdent: base.ident, baseName: base.name,
        tLat: thr[0], tLon: thr[1], course, halfWidthM: hw,
        cosLat: Math.cos(thr[0] * DEG), ux: Math.sin(course * DEG), uy: Math.cos(course * DEG),
      });
      out.push(mk(lane.leIdent, lane.le, c));
      out.push(mk(lane.heIdent, lane.he, (c + 180) % 360));
    }
  }
  return out;
})();

export class SeaplaneApproachLayer implements Layer {
  readonly name = "seaplaneApproach";

  draw(f: FrameContext): void {
    if (!f.cfg.showFinal) return;
    const ctx = f.ctx;
    ctx.save();
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (const a of f.aircraft) {
      if (a.onGround) continue;
      // Water-tuned gates: low + slow rule out airliners/jets overflying the lakes.
      if (a.altBaro == null || a.altBaro > 1500) continue;
      if (a.gs != null && a.gs > 120) continue;
      if (a.baroRate != null && a.baroRate > 100) continue; // level or descending only
      const m = match(a);
      if (!m) continue;
      const p = f.cam.project(a.lat, a.lon);
      const tag = `${m.ident} ${m.baseIdent} · ${m.miles.toFixed(1)} mi`;
      const tw = ctx.measureText(tag).width;
      const bullet = 5, boxW = bullet + 4 + tw;
      const ty = p.y + 18, bx = p.x - boxW / 2;
      ctx.fillStyle = "rgba(8,20,28,0.72)";
      roundRect(ctx, bx - 5, ty - 9, boxW + 10, 18, 4);
      ctx.fill();
      ctx.fillStyle = "rgba(120,210,235,0.95)"; // teal bullet = water arrival
      ctx.beginPath();
      ctx.arc(bx + 2, ty, 2.5, 0, 6.283);
      ctx.fill();
      ctx.fillStyle = "rgba(180,225,238,0.95)";
      ctx.fillText(tag, bx + bullet + 4, ty);
    }
    ctx.restore();
  }
}

interface Match { ident: string; baseIdent: string; baseName: string; miles: number }

function match(a: Visible): Match | null {
  let best: Match | null = null;
  let bestDist = Infinity;
  for (const e of ENDS) {
    const east = (a.lon - e.tLon) * e.cosLat * 111320;
    const north = (a.lat - e.tLat) * 110540;
    const along = east * e.ux + north * e.uy; // +ve past threshold; approach side is −ve
    const dist = -along;
    if (dist < 200 || dist > 4 * MI) continue;
    const latOff = Math.abs(east * e.uy - north * e.ux); // lateral offset from centerline
    if (latOff > 0.35 * e.halfWidthM * 2) continue; // within ~0.35 of the (wide) lane
    if (a.track != null) {
      const d = Math.abs(((a.track - e.course + 540) % 360) - 180);
      if (d > 30) continue;
    }
    if (dist < bestDist) { bestDist = dist; best = { ident: e.ident, baseIdent: e.baseIdent, baseName: e.baseName, miles: dist / MI }; }
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
