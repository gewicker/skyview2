// Detailed airport diagram from bundled OpenStreetMap aeroway geometry: taxiway
// centerlines, apron + building fills, and the aerodrome boundary — GPS-accurate and
// drawn UNDER the runways (which come from FAA data in AirportsLayer). Only shown when
// zoomed in to airport scale.
//
// Perf: the geometry is static in world space, so we project it into a Path2D PER KIND
// and cache that keyed on the view — projection (≈5.6k points) only re-runs when the view
// changes, and each kind then strokes/fills in ONE call instead of per-feature.
import type { Layer, FrameContext } from "./types";
import { AIRPORT_DIAGRAM, type DiagFeature } from "./airportDiagram";

const ORDER = [3, 1, 2, 0]; // back→front: boundary, apron, building, taxiway
const SHOW_PXMI = 230;      // px-per-mile threshold to start showing detail

export class AirportDiagramLayer implements Layer {
  readonly name = "airport-diagram";
  private byKind = new Map<number, DiagFeature[]>();
  private paths = new Map<number, Path2D>();
  private key = "";

  constructor() {
    for (const f of AIRPORT_DIAGRAM) {
      const arr = this.byKind.get(f.k);
      if (arr) arr.push(f); else this.byKind.set(f.k, [f]);
    }
  }

  draw(f: FrameContext): void {
    if (!f.cfg.showAirport) return;
    const h0 = f.cam.project(f.cfg.centerLat, f.cfg.centerLon);
    const h1 = f.cam.project(f.cfg.centerLat + 1 / 69, f.cfg.centerLon);
    const pxPerMile = Math.hypot(h1.x - h0.x, h1.y - h0.y) || 1;
    if (pxPerMile < SHOW_PXMI) return;             // only at airport scale
    const op = Math.min(1, (pxPerMile - SHOW_PXMI) / 260); // fade in past the threshold

    // Rebuild the per-kind Path2D cache only when the view actually changes.
    const v = f.view;
    const key = `${v.mapCenterLat}|${v.mapCenterLon}|${v.mapZoom}|${f.cfg.mapRotationDeg}|${f.cfg.mirrorX}|${f.cfg.mirrorY}|${f.w}|${f.h}`;
    if (key !== this.key) { this.rebuild(f); this.key = key; }

    const ctx = f.ctx;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const k of ORDER) {
      const path = this.paths.get(k);
      if (!path) continue;
      this.style(ctx, k, pxPerMile, op);
      if (k === 1 || k === 2) { ctx.fill(path); ctx.stroke(path); }
      else ctx.stroke(path);
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Project every (on-screen) feature into one Path2D per kind for the current view.
  private rebuild(f: FrameContext): void {
    this.paths.clear();
    const W = f.w, H = f.h, M = 70;
    for (const k of ORDER) {
      const feats = this.byKind.get(k);
      if (!feats) continue;
      const path = new Path2D();
      for (const feat of feats) {
        const p = feat.p;
        const c0 = f.cam.project(p[0], p[1]);
        if (c0.x < -M || c0.x > W + M || c0.y < -M || c0.y > H + M) {
          const mi = (p.length >> 2) * 2; // ~middle vertex
          const cm = f.cam.project(p[mi], p[mi + 1]);
          if (cm.x < -M || cm.x > W + M || cm.y < -M || cm.y > H + M) continue;
        }
        path.moveTo(c0.x, c0.y);
        for (let i = 2; i < p.length; i += 2) {
          const q = f.cam.project(p[i], p[i + 1]);
          path.lineTo(q.x, q.y);
        }
        if (k === 1 || k === 2) path.closePath();
      }
      this.paths.set(k, path);
    }
  }

  private style(ctx: CanvasRenderingContext2D, k: number, pxPerMile: number, op: number): void {
    ctx.setLineDash([]);
    if (k === 0) {            // taxiway centerline
      ctx.strokeStyle = `rgba(198,206,168,${0.45 * op})`;
      ctx.lineWidth = Math.max(1.1, pxPerMile * 0.005);
    } else if (k === 1) {     // apron
      ctx.fillStyle = `rgba(120,140,162,${0.13 * op})`;
      ctx.strokeStyle = `rgba(150,172,192,${0.18 * op})`;
      ctx.lineWidth = 1;
    } else if (k === 2) {     // building (terminal/hangar)
      ctx.fillStyle = `rgba(150,160,178,${0.22 * op})`;
      ctx.strokeStyle = `rgba(182,194,210,${0.34 * op})`;
      ctx.lineWidth = 1;
    } else {                  // aerodrome boundary
      ctx.strokeStyle = `rgba(120,165,185,${0.16 * op})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([7, 8]);
    }
  }
}
