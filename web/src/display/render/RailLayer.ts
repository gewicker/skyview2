// Link light rail — a static transit ribbon (above-ground track) + station markers, drawn from
// GPS-accurate OSM geometry (see rail.ts / get-rail-osm.ps1). A distinct muted GREEN so it reads
// as transit and doesn't collide with the congestion ramp, the dim aeronautical cyan, or the gold
// HOME beacon. Nominal: no live trains — just the line and stations. Off-screen culled; the track
// is projected into a view-keyed cache (reprojected only on pan/zoom), like the highway layer.
import type { Layer, FrameContext } from "./types";
import { RAIL_SEGMENTS, RAIL_STATIONS, RAIL_LINES } from "./rail";
import { liveTrains } from "./livetrains";
import { coreDim } from "./night";

// Underground spans of each line (runs of consecutive tunnel segments), as [lat,lon] polylines —
// drawn as a recessed dashed hairline beneath the surface ribbon so the eye reads "the track
// continues below." Computed once from the tunnel-aware RAIL_LINES.
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

const LINE = "rgba(40,225,170,";             // bright transit JADE (alpha appended) — more saturated and
                                             // brighter than the cool satellite grade, and clear of the
                                             // ~15k-ft altitude meadow-green trails, so it reads from a room away
const LINE_HAIR = "rgba(150,240,200,0.9)";   // bright coaxial centerline — reads as lit infrastructure
const STATION_RING = "rgba(40,225,170,0.95)"; // jade outline

interface Pt { x: number; y: number }

export class RailLayer implements Layer {
  readonly name = "rail";
  private proj: Pt[][] = [];
  private projTun: Pt[][] = [];
  private projKey = "";
  private rings: { x: number; y: number; t0: number }[] = []; // one-shot arrival rings at stations
  private lastFire = new Map<string, number>();               // per-station ring cooldown (sec)

  private ensureProjected(f: FrameContext): void {
    const v = f.view;
    // Decimate the ~4,900-vertex geometry while panning/zooming (stride 4 ≈ −75% projections per
    // frame), snapping back to full fidelity the instant the gesture ends. The stride is part of the
    // cache key, so settling forces one clean full reproject. (perf: docs/PERF-GESTURE.md)
    const stride = f.interacting ? 4 : 1;
    const key = `${v.mapCenterLat},${v.mapCenterLon},${v.mapZoom},${f.cfg.mapRotationDeg},${f.cfg.mirrorX ? 1 : 0},${f.cfg.mirrorY ? 1 : 0},${f.w},${f.h},${f.dpr},${stride}`;
    if (key === this.projKey) return;
    this.projKey = key;
    projectPolys(f.cam, RAIL_SEGMENTS, this.proj, stride);
    projectPolys(f.cam, TUNNEL_SPANS, this.projTun, stride);
  }

  draw(f: FrameContext): void {
    if (!f.cfg.showRail) return;
    if (!RAIL_SEGMENTS.length && !RAIL_STATIONS.length) return; // generator not run yet
    this.ensureProjected(f);
    const ctx = f.ctx, w = f.w, h = f.h;
    // Mild width growth with zoom (constant, NOT congestion-driven — rail is fixed infrastructure).
    const wm = Math.max(1, Math.min(2.2, 1 + 0.22 * ((f.view.mapZoom || 1) - 1)));
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Subsurface track: dashed, dimmed, NO glow (the bloom is what makes the surface line read as
    // lit infrastructure; dropping it makes the dashed hairline read as "below ground"). Drawn first
    // so the surface ribbon, stations, and trains all sit above it.
    if (this.projTun.length) {
      ctx.setLineDash([6 * wm, 7 * wm]);
      ctx.strokeStyle = LINE + "0.3)";
      ctx.lineWidth = 1.6 * wm;
      for (const pts of this.projTun) if (pts.length >= 2 && onScreen(pts, w, h)) stroke(ctx, pts);
      ctx.setLineDash([]);
    }
    // Line: a soft glow under-stroke + a clean core so it reads as a distinct transit ribbon.
    for (let i = 0; i < this.proj.length; i++) {
      const pts = this.proj[i];
      if (pts.length < 2 || !onScreen(pts, w, h)) continue;
      ctx.strokeStyle = LINE + "0.22)";   // wide soft glow — bloom without shadowBlur
      ctx.lineWidth = 9 * wm;
      stroke(ctx, pts);
      ctx.strokeStyle = LINE + "0.95)";   // mid body
      ctx.lineWidth = 2.6 * wm;
      stroke(ctx, pts);
      ctx.strokeStyle = LINE_HAIR;        // bright centerline inside the body
      ctx.lineWidth = 1 * wm;
      stroke(ctx, pts);
    }
    // Stations: ring + core landmarks, whose HALO BLOOMS with nearby live-train activity — hubs
    // breathe through the day, quiet stations stay dim. Label-free until tapped (ambient rule).
    const trains = liveTrains();
    const sr = wm; // stations grow a touch with zoom too
    for (const s of RAIL_STATIONS) {
      const p = f.cam.project(s.lat, s.lon);
      if (p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) continue;
      // nearest live train → bloom (within 2 NM) + a one-shot arrival ring (within ~0.3 NM)
      let near = Infinity;
      for (const t of trains) {
        const d = distNMrail(s.lat, s.lon, t.lat, t.lon);
        if (d < near) near = d;
      }
      const prox = near < 2 ? 1 - near / 2 : 0;
      if (near < 0.3 && f.t - (this.lastFire.get(s.name) ?? -999) > 30) {
        this.rings.push({ x: p.x, y: p.y, t0: f.t }); // a train just pulled in — fire one soft ring
        this.lastFire.set(s.name, f.t);
      }
      ctx.beginPath();                                 // halo bloom (swells with nearby train)
      ctx.arc(p.x, p.y, 7 * sr * (1 + 0.6 * prox), 0, Math.PI * 2);
      ctx.fillStyle = LINE + (0.22 + 0.25 * prox).toFixed(3) + ")"; // lifted floor so it doesn't smudge over water
      ctx.fill();
      ctx.beginPath();                                 // stroked ring = a deliberate "stop" marker
      ctx.arc(p.x, p.y, 5 * sr, 0, Math.PI * 2);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = STATION_RING;
      ctx.stroke();
      ctx.beginPath();                                 // bright core landmark (night-dimmed with the room)
      ctx.arc(p.x, p.y, 2.4 * sr, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(232,255,244,${(0.98 * coreDim()).toFixed(3)})`;
      ctx.fill();
    }
    // Arrival rings: a single slow expanding ring as a train reaches a station — a quiet "bell of
    // light," like a drop in water. Rare (30s cooldown/station), low-alpha, no glow.
    this.rings = this.rings.filter((r) => f.t - r.t0 < 1.2);
    for (const r of this.rings) {
      const age = (f.t - r.t0) / 1.2; // 0..1
      ctx.beginPath();
      ctx.arc(r.x, r.y, (5 + 17 * age) * sr, 0, Math.PI * 2);
      ctx.strokeStyle = LINE + (0.5 * (1 - age)).toFixed(3) + ")";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    ctx.restore();
  }
}

// Project a list of [lat,lon] polylines into screen-space caches, taking every `stride`-th vertex
// (always keeping each polyline's last point so segments don't visibly shorten). stride 1 = full.
function projectPolys(cam: { project(lat: number, lon: number): Pt }, src: [number, number][][], out: Pt[][], stride: number): void {
  for (let i = 0; i < src.length; i++) {
    let pts = out[i];
    if (!pts) { pts = []; out[i] = pts; }
    pts.length = 0;
    const s = src[i], n = s.length;
    for (let k = 0; k < n; k += stride) pts.push(cam.project(s[k][0], s[k][1]));
    if (n > 0 && (n - 1) % stride !== 0) pts.push(cam.project(s[n - 1][0], s[n - 1][1]));
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
// Cheap equirectangular distance in nautical miles — fine for the short station↔train ranges here.
function distNMrail(la1: number, lo1: number, la2: number, lo2: number): number {
  const x = (lo2 - lo1) * Math.cos((((la1 + la2) / 2) * Math.PI) / 180);
  const y = la2 - la1;
  return Math.sqrt(x * x + y * y) * 60;
}
