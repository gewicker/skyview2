// The STATIC Link rail ribbon (above-ground track + dashed subsurface tunnel spans), split out of
// RailLayer so it can be wrapped in StaticOverlayLayer: it then bakes to an offscreen buffer and
// transform-blits during pan/zoom (re-projecting the ~4,900 vertices only when the view settles,
// not every gesture frame). The LIVE parts (stations + bloom + trains) stay in RailLayer / TrainLayer
// so they keep animating over this baked ribbon. See docs/PERF-INTERACT.md.
import type { Layer, FrameContext } from "./types";
import { RAIL_SEGMENTS, RAIL_LINES } from "./rail";

function buildTunnelSpans(): [number, number][][] {
  const out: [number, number][][] = [];
  for (const line of RAIL_LINES) {
    const p = line.path;
    let run: [number, number][] = [];
    for (let i = 0; i < p.length - 1; i++) {
      if (p[i].tunnel && p[i + 1].tunnel) {
        if (run.length === 0) run.push([p[i].lat, p[i].lon]);
        run.push([p[i + 1].lat, p[i + 1].lon]);
      } else if (run.length) { out.push(run); run = []; }
    }
    if (run.length) out.push(run);
  }
  return out;
}
const TUNNEL_SPANS = buildTunnelSpans();

const LINE = "rgba(40,225,170,";            // transit jade (alpha appended)
const LINE_HAIR = "rgba(120,215,180,0.55)"; // quiet coaxial centerline (receded so the train out-reads the line)

// East Link (2 Line) emphasis — DELIBERATELY NOT done here by recoloring. RAIL_SEGMENTS are plain
// polylines with no line key (RailStation has no line field either), so there is no clean way to tint
// just the home spine, and docs/RAIL-BALANCE.md forbids a loud line highlight (the live train must
// out-read the line). The home-line emphasis is instead carried as calm station-area neighborhood
// labels in places.ts (Wilburton / Spring District / BelRed / Overlake, plus Downtown Bellevue etc.),
// which name the 2 Line corridor through Bellevue/Redmond without disturbing the rail color hierarchy.

interface Pt { x: number; y: number }

export class RailLineLayer implements Layer {
  readonly name = "rail-line";
  private proj: Pt[][] = [];
  private projTun: Pt[][] = [];
  private projKey = "";

  // Projects on view change only. Wrapped in StaticOverlayLayer, draw() runs solely when the buffer
  // bakes (on settle), so full fidelity here costs nothing per gesture frame.
  private ensureProjected(f: FrameContext): void {
    const v = f.view;
    const key = `${v.mapCenterLat},${v.mapCenterLon},${v.mapZoom},${f.cfg.mapRotationDeg},${f.cfg.mirrorX ? 1 : 0},${f.cfg.mirrorY ? 1 : 0},${f.w},${f.h},${f.dpr}`;
    if (key === this.projKey) return;
    this.projKey = key;
    projectPolys(f.cam, RAIL_SEGMENTS, this.proj);
    projectPolys(f.cam, TUNNEL_SPANS, this.projTun);
  }

  draw(f: FrameContext): void {
    if (!f.cfg.showRail || !RAIL_SEGMENTS.length) return;
    this.ensureProjected(f);
    const ctx = f.ctx, w = f.w, h = f.h;
    const wm = Math.max(1, Math.min(2.2, 1 + 0.22 * ((f.view.mapZoom || 1) - 1)));
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Subsurface (tunnel) dashed hairline, under the surface ribbon.
    if (this.projTun.length) {
      ctx.setLineDash([6 * wm, 7 * wm]);
      ctx.strokeStyle = LINE + "0.3)";
      ctx.lineWidth = 1.6 * wm;
      for (const pts of this.projTun) if (pts.length >= 2 && onScreen(pts, w, h)) stroke(ctx, pts);
      ctx.setLineDash([]);
    }
    // Surface ribbon: soft glow + body + quiet hairline.
    for (let i = 0; i < this.proj.length; i++) {
      const pts = this.proj[i];
      if (pts.length < 2 || !onScreen(pts, w, h)) continue;
      ctx.strokeStyle = LINE + "0.14)";
      ctx.lineWidth = 7 * wm;
      stroke(ctx, pts);
      ctx.strokeStyle = LINE + "0.72)";
      ctx.lineWidth = 2.4 * wm;
      stroke(ctx, pts);
      ctx.strokeStyle = LINE_HAIR;
      ctx.lineWidth = 1 * wm;
      stroke(ctx, pts);
    }
    ctx.restore();
  }
}

function projectPolys(cam: { project(lat: number, lon: number): Pt }, src: [number, number][][], out: Pt[][]): void {
  for (let i = 0; i < src.length; i++) {
    let pts = out[i];
    if (!pts) { pts = []; out[i] = pts; }
    pts.length = 0;
    for (const [lat, lon] of src[i]) pts.push(cam.project(lat, lon));
  }
}
function onScreen(pts: Pt[], w: number, h: number): boolean {
  for (const p of pts) if (p.x > -60 && p.x < w + 60 && p.y > -60 && p.y < h + 60) return true;
  return false;
}
function stroke(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}
