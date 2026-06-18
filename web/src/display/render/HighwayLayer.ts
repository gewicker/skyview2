// Synthetic highway traffic — the road family in the unified model. Two expressions of one
// congestion scalar: a scrolling FLOW WASH along the centerline (a congestion-tinted dashed
// stroke that scrolls at the local speed, so you SEE volume moving — slow where jammed, quick
// where clear) and shaded CAR glyphs marching along it (tinted by the same ramp, bunched
// tighter and crawling where congested). Cars are the smallest, faintest moving glyph
// (brightness law: aircraft > vessels > cars > weather) and carry directional head/tail
// lights. There's no keyless per-vehicle feed, so volume comes from a time-of-day model
// (honest texture; live WSDOT travel-times is a follow-up). Off by default.
//
// PERF: the road geometry is ~5,300 points. We project them into a screen-space cache keyed on
// the camera view and reproject ONLY when the view changes (i.e. during a pan/zoom gesture). At
// rest there is zero per-frame projection/allocation. Flow and cars share the one projection
// (previously each re-projected every segment, doubling the cost when cars were visible).
import type { Layer, FrameContext } from "./types";
import { HIGHWAYS, congestionNow, type Highway } from "./highways";
import { congRamp, desatRGB } from "./colors";
import { carSprite, drawCar, CAR_BUCKETS } from "./carGlyph";
import { startTraffic, tickTraffic, liveCong, desatAmount } from "./traffic";

const SPACING = 22;        // base px between cars (modulated tighter by congestion)
const CAR_CAP = 90;        // hard cap on cars drawn per frame (Pi budget)
const FLOOR = 0.12;        // below this congestion a segment draws nothing (clear road recedes)
const CARS_ZOOM_MIN = 3.5; // map-zoom where cars begin fading in (street zoom); tune on the panel
const CARS_ZOOM_FULL = 5.5;// map-zoom where cars are fully shown (DPI-independent, unlike px/mile)
const col = (c: readonly number[], a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const smooth01 = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Pt { x: number; y: number }

export class HighwayLayer implements Layer {
  readonly name = "highway";
  private desat = 0;     // ambient "modelled not live" tell, set per frame
  private widthMul = 1;  // ribbon width grows mildly with zoom
  private carsVis = 0;   // 0 at metro zoom … 1 at street zoom (cars fade in)
  // Flattened segment list (built once) + a parallel projected-points cache, reprojected only
  // when the camera view-key changes.
  private flat: { hw: Highway; si: number; seg: [number, number][] }[] = [];
  private proj: Pt[][] = [];
  private projKey = "";

  constructor() {
    startTraffic(); // begin polling the backend WSDOT proxy (no key on server = no-op data)
  }

  private ensureProjected(f: FrameContext): void {
    if (!this.flat.length) {
      for (const hw of HIGHWAYS) hw.segments.forEach((seg, si) => this.flat.push({ hw, si, seg }));
    }
    const v = f.view;
    // Everything Camera derives from: view centre/zoom + config rotation/mirror + screen size/dpr.
    const key = `${v.mapCenterLat},${v.mapCenterLon},${v.mapZoom},${f.cfg.mapRotationDeg},${f.cfg.mirrorX ? 1 : 0},${f.cfg.mirrorY ? 1 : 0},${f.w},${f.h},${f.dpr}`;
    if (key === this.projKey) return; // view unchanged → reuse cached screen coords
    this.projKey = key;
    for (let i = 0; i < this.flat.length; i++) {
      const seg = this.flat[i].seg;
      let pts = this.proj[i];
      if (!pts) { pts = []; this.proj[i] = pts; }
      pts.length = 0;
      for (const [lat, lon] of seg) pts.push(f.cam.project(lat, lon));
    }
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
    this.ensureProjected(f);
    const ctx = f.ctx, w = f.w, h = f.h;
    const im = 0.6 + 0.6 * intensity;

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Flow ribbon (under the cars) — the primary congestion carrier at every zoom.
    for (let i = 0; i < this.flat.length; i++) {
      const pts = this.proj[i];
      if (pts.length < 2 || !this.onScreen(pts, w, h)) continue;
      this.drawFlowSeg(f, pts, this.segCong(this.flat[i].hw, this.flat[i].si), im);
    }
    ctx.setLineDash([]);
    // Cars: street-zoom detail only — sub-perceptual at metro zoom, so faded in by carsVis.
    if (this.carsVis > 0.01) {
      const carAlpha = 0.7 * intensity * this.carsVis;
      let budget = CAR_CAP;
      for (let i = 0; i < this.flat.length && budget > 0; i++) {
        const pts = this.proj[i];
        if (pts.length < 2 || !this.onScreen(pts, w, h)) continue;
        budget = this.drawCarsSeg(f, pts, this.segCong(this.flat[i].hw, this.flat[i].si), carAlpha, budget);
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

  private onScreen(pts: Pt[], w: number, h: number): boolean {
    for (const p of pts) if (p.x > -60 && p.x < w + 60 && p.y > -60 && p.y < h + 60) return true;
    return false;
  }

  // The congestion ribbon for one segment: ONE redundant-encoded carrier. Congestion drives hue
  // (ramp), WIDTH, GLOW, dash-density and scroll-speed together. Clear road (cong < FLOOR) draws
  // nothing — jams stand alone. No base track.
  private drawFlowSeg(f: FrameContext, pts: Pt[], cong: number, im: number): void {
    const ctx = f.ctx;
    // Smooth fade near the floor (NOT a hard cutoff) so a segment whose congestion drifts across
    // the threshold — or whose sensor flips to NoData between polls — dims in/out gently.
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
    // Core stroke. Warm/congested segments get a scrolling dash (denser when jammed); cool
    // segments stay solid (dashes on clear road = noise).
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
  }

  private stroke(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  private drawCarsSeg(f: FrameContext, pts: Pt[], cong: number, alpha: number, budget: number): number {
    const w = f.w, h = f.h;
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
    return budget;
  }
}
