// Holding-pattern / circling detection. A holding aircraft keeps turning the same way
// while staying inside a small box, so we accumulate signed heading change along its
// trail and check the trail's geographic span. When both cross thresholds we mark it
// with a rotating "HOLD" badge. Cheap: trails are short and few.
import type { Layer, FrameContext, Sample } from "./types";

const DEG = Math.PI / 180;

export class HoldingLayer implements Layer {
  readonly name = "holding";

  draw(f: FrameContext): void {
    if (!f.cfg.showTraffic) return; // piggyback the traffic master toggle
    const ctx = f.ctx;
    for (const a of f.aircraft) {
      if (a.onGround) continue;
      if (!isHolding(a.trail)) continue;
      const p = f.cam.project(a.lat, a.lon);
      const r = 17;
      const spin = f.t * 1.4;
      ctx.save();
      ctx.strokeStyle = "rgba(255,196,90,0.85)";
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, spin, spin + Math.PI * 1.55);
      ctx.stroke();
      ctx.setLineDash([]);
      // Arrowhead at the open end to imply rotation.
      const ah = spin + Math.PI * 1.55;
      const hx = p.x + Math.cos(ah) * r, hy = p.y + Math.sin(ah) * r;
      const tx = -Math.sin(ah), ty = Math.cos(ah);
      ctx.fillStyle = "rgba(255,196,90,0.9)";
      ctx.beginPath();
      ctx.moveTo(hx + tx * 4, hy + ty * 4);
      ctx.lineTo(hx - tx * 4, hy - ty * 4);
      ctx.lineTo(hx + Math.cos(ah) * 6, hy + Math.sin(ah) * 6);
      ctx.closePath();
      ctx.fill();

      ctx.font = "600 10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(20,16,6,0.66)";
      const tw = ctx.measureText("HOLD").width;
      roundRect(ctx, p.x - tw / 2 - 4, p.y - r - 16, tw + 8, 13, 3);
      ctx.fill();
      ctx.fillStyle = "rgba(255,214,140,0.95)";
      ctx.fillText("HOLD", p.x, p.y - r - 7);
      ctx.restore();
    }
    ctx.textAlign = "left";
  }
}

function isHolding(trail: Sample[] | undefined): boolean {
  if (!trail || trail.length < 10) return false;
  let minLa = Infinity, maxLa = -Infinity, minLo = Infinity, maxLo = -Infinity;
  for (const s of trail) {
    minLa = Math.min(minLa, s.lat); maxLa = Math.max(maxLa, s.lat);
    minLo = Math.min(minLo, s.lon); maxLo = Math.max(maxLo, s.lon);
  }
  const midLa = (minLa + maxLa) / 2;
  const cosLa = Math.cos(midLa * DEG);
  const spanMi = Math.hypot((maxLa - minLa) * 69, (maxLo - minLo) * 69 * cosLa);
  if (spanMi > 6 || spanMi < 0.3) return false; // too big = transit; too small = parked jitter

  // Net-progress ratio: a hold/orbit loops back on itself, so the straight-line
  // start→end distance is small next to the path actually flown. Transiting or
  // landing traffic runs nearly straight (ratio → 1). This is what rejects the
  // low-speed bearing-jitter false positives on final (e.g. a 737 on short final).
  let pathMi = 0;
  for (let i = 1; i < trail.length; i++) {
    pathMi += Math.hypot((trail[i].lat - trail[i - 1].lat) * 69, (trail[i].lon - trail[i - 1].lon) * 69 * cosLa);
  }
  if (pathMi <= 0) return false;
  const a0 = trail[0], a1 = trail[trail.length - 1];
  const netMi = Math.hypot((a1.lat - a0.lat) * 69, (a1.lon - a0.lon) * 69 * cosLa);
  if (netMi / pathMi > 0.45) return false; // running through, not circling

  let turn = 0, prev: number | null = null;
  for (let i = 1; i < trail.length; i++) {
    const b = bearing(trail[i - 1], trail[i]);
    if (prev != null) {
      let d = ((b - prev + 540) % 360) - 180; // signed −180..180
      turn += d;
    }
    prev = b;
  }
  return Math.abs(turn) > 240; // consistent ~¾-turn+ of circling in one direction
}

function bearing(a: Sample, b: Sample): number {
  const p1 = a.lat * DEG, p2 = b.lat * DEG, dl = (b.lon - a.lon) * DEG;
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
