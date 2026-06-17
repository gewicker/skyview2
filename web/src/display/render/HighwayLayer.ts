// Synthetic highway traffic — the road family in the unified model. Two expressions of one
// congestion scalar: a scrolling FLOW WASH along the centerline (a congestion-tinted dashed
// stroke that scrolls at the local speed, so you SEE volume moving — slow where jammed, quick
// where clear) and shaded CAR glyphs marching along it (tinted by the same ramp, bunched
// tighter and crawling where congested). Cars are the smallest, faintest moving glyph
// (brightness law: aircraft > vessels > cars > weather) and carry directional head/tail
// lights. There's no keyless per-vehicle feed, so volume comes from a time-of-day model
// (honest texture; live WSDOT travel-times is a follow-up). Off by default.
import type { Layer, FrameContext } from "./types";
import { HIGHWAYS, congestionNow, type Highway } from "./highways";
import { congRamp } from "./colors";
import { carSprite, drawCar, CAR_BUCKETS } from "./carGlyph";

const SPACING = 22;     // base px between cars (modulated tighter by congestion)
const CAR_CAP = 90;     // hard cap on cars drawn per frame (Pi budget)
const col = (c: readonly number[], a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

export class HighwayLayer implements Layer {
  readonly name = "highway";
  private pts: { x: number; y: number }[] = [];

  draw(f: FrameContext): void {
    if (!f.cfg.showHighways) return;
    const intensity = f.cfg.highwayIntensity ?? 0.6;
    if (intensity < 0.02) return;
    const ctx = f.ctx;
    const carAlpha = 0.7 * intensity; // effective body peak ≈ 0.42 at default intensity
    let budget = CAR_CAP;

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.lineCap = "round";
    // Pass 1: the flow wash on every road (under the cars).
    for (const hw of HIGHWAYS) this.drawFlow(f, hw, intensity);
    // Pass 2: the cars on top.
    for (const hw of HIGHWAYS) {
      if (budget <= 0) break;
      budget = this.drawCars(f, hw, carAlpha, budget);
    }
    ctx.restore();
  }

  // Per-segment congestion: the road's time-of-day value with a little along-road variation
  // so the flow isn't a flat wash (a stretch can be heavier than its neighbour).
  private segCong(hw: Highway, segIdx: number): number {
    const base = congestionNow(hw.base);
    const v = Math.sin(segIdx * 1.7 + hw.id.length) * 0.5 + 0.5; // 0..1 stable per segment
    return Math.max(0, Math.min(1, base * (0.82 + 0.36 * v)));
  }

  private project(f: FrameContext, seg: [number, number][]): { x: number; y: number }[] {
    this.pts.length = 0;
    for (const [lat, lon] of seg) this.pts.push(f.cam.project(lat, lon));
    return this.pts;
  }

  private onScreen(pts: { x: number; y: number }[], w: number, h: number): boolean {
    for (const p of pts) if (p.x > -60 && p.x < w + 60 && p.y > -60 && p.y < h + 60) return true;
    return false;
  }

  private drawFlow(f: FrameContext, hw: Highway, intensity: number): void {
    const ctx = f.ctx, w = f.w, h = f.h;
    hw.segments.forEach((seg, si) => {
      const pts = this.project(f, seg);
      if (pts.length < 2 || !this.onScreen(pts, w, h)) return;
      const cong = this.segCong(hw, si);
      const speed = 26 - 22 * cong;
      // Faint base track so an empty road still orients.
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(120,130,150,0.14)";
      this.stroke(ctx, pts);
      // Congestion-tinted flow dash, scrolling along travel at the local speed.
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = col(congRamp(cong), 0.22 * (0.6 + 0.6 * intensity));
      ctx.setLineDash([6, 10]);
      ctx.lineDashOffset = -((f.t * speed) % 16);
      this.stroke(ctx, pts);
    });
    ctx.setLineDash([]);
  }

  private stroke(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]): void {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  private drawCars(f: FrameContext, hw: Highway, alpha: number, budget: number): number {
    const w = f.w, h = f.h;
    for (let si = 0; si < hw.segments.length && budget > 0; si++) {
      const pts = this.project(f, hw.segments[si]);
      if (pts.length < 2 || !this.onScreen(pts, w, h)) continue;
      const cong = this.segCong(hw, si);
      const spacing = SPACING / (0.6 + 0.8 * cong); // congestion bunches the cars
      const speed = 26 - 22 * cong;
      const sprite = carSprite(Math.round(cong * (CAR_BUCKETS - 1)));
      const phase = (f.t * speed) % spacing;
      let startG = 0;
      for (let i = 1; i < pts.length && budget > 0; i++) {
        const a = pts[i - 1], c = pts[i];
        const segLen = Math.hypot(c.x - a.x, c.y - a.y);
        if (segLen < 0.001) continue;
        const nx = (c.x - a.x) / segLen, ny = (c.y - a.y) / segLen;
        const ang = Math.atan2(ny, nx);
        const m0 = Math.ceil((startG - phase) / spacing);
        for (let d = m0 * spacing + phase - startG; d <= segLen && budget > 0; d += spacing) {
          const x = a.x + nx * d, y = a.y + ny * d;
          if (x < -12 || x > w + 12 || y < -12 || y > h + 12) continue;
          drawCar(f.ctx, sprite, x, y, ang, alpha);
          budget--;
        }
        startG += segLen;
      }
    }
    return budget;
  }
}
