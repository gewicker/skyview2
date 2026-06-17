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
import { congRamp, desatRGB } from "./colors";
import { carSprite, drawCar, CAR_BUCKETS } from "./carGlyph";
import { startTraffic, tickTraffic, liveCong, desatAmount } from "./traffic";

const SPACING = 22;     // base px between cars (modulated tighter by congestion)
const CAR_CAP = 90;     // hard cap on cars drawn per frame (Pi budget)
const FLOOR = 0.12;        // below this congestion a segment draws nothing (clear road recedes)
const CARS_ZOOM_MIN = 3.5; // map-zoom where cars begin fading in (street zoom); tune on the panel
const CARS_ZOOM_FULL = 5.5;// map-zoom where cars are fully shown (DPI-independent, unlike px/mile)
const col = (c: readonly number[], a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const smooth01 = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class HighwayLayer implements Layer {
  readonly name = "highway";
  private pts: { x: number; y: number }[] = [];
  private desat = 0;     // ambient "modelled not live" tell, set per frame
  private widthMul = 1;  // ribbon width grows mildly with zoom
  private carsVis = 0;   // 0 at metro zoom … 1 at street zoom (cars fade in)

  constructor() {
    startTraffic(); // begin polling the backend WSDOT proxy (no key on server = no-op data)
  }

  draw(f: FrameContext): void {
    if (!f.cfg.showHighways) return;
    const intensity = f.cfg.highwayIntensity ?? 0.6;
    if (intensity < 0.02) return;
    tickTraffic(f.dt); // ease live congestion toward the latest poll's targets
    this.desat = desatAmount();
    // Zoom-aware encoding keyed on map-zoom (not px/mile, which varies with panel DPI). Ribbon
    // width grows mildly with zoom; cars only fade in once zoomed into street level.
    const mz = f.view.mapZoom || 1;
    this.widthMul = Math.max(0.85, Math.min(2.2, 0.85 + 0.18 * (mz - 1)));
    this.carsVis = smooth01(CARS_ZOOM_MIN, CARS_ZOOM_FULL, mz);
    const ctx = f.ctx;
    let budget = CAR_CAP;

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // The flow ribbon is the primary congestion carrier at every zoom.
    for (const hw of HIGHWAYS) this.drawFlow(f, hw, intensity);
    // Cars: street-zoom detail only — sub-perceptual at metro zoom, so faded in by carsVis.
    if (this.carsVis > 0.01) {
      const carAlpha = 0.7 * intensity * this.carsVis;
      for (const hw of HIGHWAYS) {
        if (budget <= 0) break;
        budget = this.drawCars(f, hw, carAlpha, budget);
      }
    }
    ctx.restore();
  }

  // Per-segment congestion. Live WSDOT data drives it where a sensor is near (blended by
  // coverage×freshness); elsewhere / when the feed is stale it falls back to the time-of-day
  // model. A small stable along-road sine keeps the flow from being a flat wash either way.
  private segCong(hw: Highway, segIdx: number): number {
    const v = Math.sin(segIdx * 1.7 + hw.id.length) * 0.5 + 0.5; // 0..1 stable per segment
    const model = Math.max(0, Math.min(1, congestionNow(hw.base) * (0.82 + 0.36 * v)));
    const live = liveCong(hw.id, segIdx);
    if (live.w <= 0) return model;
    const liveTex = Math.max(0, Math.min(1, live.val * (0.92 + 0.16 * v)));
    return Math.max(0, Math.min(1, live.w * liveTex + (1 - live.w) * model));
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

  // The congestion ribbon: ONE redundant-encoded carrier. Congestion drives hue (ramp), WIDTH,
  // GLOW, dash-density and scroll-speed together, so it reads from across the room via any
  // channel. Clear road (cong < FLOOR) draws nothing — jams stand alone. No base track.
  private drawFlow(f: FrameContext, hw: Highway, intensity: number): void {
    const ctx = f.ctx, w = f.w, h = f.h;
    const im = 0.6 + 0.6 * intensity;
    hw.segments.forEach((seg, si) => {
      const pts = this.project(f, seg);
      if (pts.length < 2 || !this.onScreen(pts, w, h)) return;
      const cong = this.segCong(hw, si);
      // Smooth fade near the floor (NOT a hard cutoff) so a segment whose congestion drifts
      // across the threshold — or whose sensor flips to NoData between polls — dims in/out
      // gently instead of popping on and off. Clear road still recedes to ~nothing.
      const vis = smooth01(FLOOR, FLOOR + 0.14, cong);
      if (vis <= 0.002) return;
      const c = desatRGB(congRamp(cong), this.desat);
      const width = (1.2 + 3.3 * cong * cong) * this.widthMul; // squared → only bad stretches fatten
      const aCore = (0.12 + 0.43 * cong) * im * vis;
      // Soft glow under-stroke (wider, low alpha) so jams bloom off the dark map — no shadowBlur.
      ctx.setLineDash([]);
      ctx.lineWidth = width * 2;
      ctx.strokeStyle = col(c, aCore * 0.25);
      this.stroke(ctx, pts);
      // Core stroke. Warm/congested segments get a scrolling dash (denser when jammed) so motion
      // and "look here" read at a glance; cool segments stay solid (dashes on clear road = noise).
      ctx.lineWidth = width;
      ctx.strokeStyle = col(c, aCore);
      if (cong > 0.5) {
        const dash: [number, number] = cong > 0.8 ? [3, 5] : [4, 12];
        ctx.setLineDash(dash);
        ctx.lineDashOffset = -((f.t * (26 - 22 * cong)) % (dash[0] + dash[1]));
      } else {
        ctx.setLineDash([]);
      }
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
