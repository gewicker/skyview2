// Link light rail — a static transit ribbon (above-ground track) + station markers, drawn from
// GPS-accurate OSM geometry (see rail.ts / get-rail-osm.ps1). A distinct muted GREEN so it reads
// as transit and doesn't collide with the congestion ramp, the dim aeronautical cyan, or the gold
// HOME beacon. Nominal: no live trains — just the line and stations. Off-screen culled; the track
// is projected into a view-keyed cache (reprojected only on pan/zoom), like the highway layer.
import type { Layer, FrameContext } from "./types";
import { RAIL_SEGMENTS, RAIL_STATIONS } from "./rail";

const LINE = "rgba(122,201,143,";          // muted Link green (alpha appended)
const STATION = "rgba(150,225,170,0.95)";  // station ring
const STATION_CORE = "rgba(240,255,245,0.95)";

interface Pt { x: number; y: number }

export class RailLayer implements Layer {
  readonly name = "rail";
  private proj: Pt[][] = [];
  private projKey = "";

  private ensureProjected(f: FrameContext): void {
    const v = f.view;
    const key = `${v.mapCenterLat},${v.mapCenterLon},${v.mapZoom},${f.cfg.mapRotationDeg},${f.cfg.mirrorX ? 1 : 0},${f.cfg.mirrorY ? 1 : 0},${f.w},${f.h},${f.dpr}`;
    if (key === this.projKey) return;
    this.projKey = key;
    for (let i = 0; i < RAIL_SEGMENTS.length; i++) {
      let pts = this.proj[i];
      if (!pts) { pts = []; this.proj[i] = pts; }
      pts.length = 0;
      for (const [lat, lon] of RAIL_SEGMENTS[i]) pts.push(f.cam.project(lat, lon));
    }
  }

  draw(f: FrameContext): void {
    if (!f.cfg.showRail) return;
    if (!RAIL_SEGMENTS.length && !RAIL_STATIONS.length) return; // generator not run yet
    this.ensureProjected(f);
    const ctx = f.ctx, w = f.w, h = f.h;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Line: a soft glow under-stroke + a clean core so it reads as a distinct transit ribbon.
    for (let i = 0; i < this.proj.length; i++) {
      const pts = this.proj[i];
      if (pts.length < 2 || !onScreen(pts, w, h)) continue;
      ctx.strokeStyle = LINE + "0.18)";
      ctx.lineWidth = 4;
      stroke(ctx, pts);
      ctx.strokeStyle = LINE + "0.85)";
      ctx.lineWidth = 1.6;
      stroke(ctx, pts);
    }
    // Stations: a small ring + light core — the landmarks. Label-free until tapped (ambient rule).
    for (const s of RAIL_STATIONS) {
      const p = f.cam.project(s.lat, s.lon);
      if (p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = STATION;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = STATION_CORE;
      ctx.fill();
    }
    ctx.restore();
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
