// Detailed airport diagram from bundled OpenStreetMap aeroway geometry: taxiway
// centerlines, apron + building fills, and the aerodrome boundary — GPS-accurate and
// drawn UNDER the runways (which come from FAA data in AirportsLayer). Only shown when
// zoomed in to airport scale: it would be illegible clutter (and wasted frames) on a wide
// view, so it fades in past a zoom threshold and culls features outside the viewport.
import type { Layer, FrameContext } from "./types";
import { AIRPORT_DIAGRAM, type DiagFeature } from "./airportDiagram";

const ORDER = [3, 1, 2, 0]; // back→front: boundary, apron, building, taxiway
const SHOW_PXMI = 230;      // px-per-mile threshold to start showing detail

export class AirportDiagramLayer implements Layer {
  readonly name = "airport-diagram";
  private byKind = new Map<number, DiagFeature[]>();

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

    const ctx = f.ctx;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const k of ORDER) {
      const feats = this.byKind.get(k);
      if (feats) this.drawKind(f, feats, k, pxPerMile, op);
    }
    ctx.restore();
  }

  private drawKind(f: FrameContext, feats: DiagFeature[], k: number, pxPerMile: number, op: number): void {
    const ctx = f.ctx;
    const fill = k === 1 || k === 2;
    if (k === 0) {            // taxiway centerline
      ctx.strokeStyle = `rgba(198,206,168,${0.45 * op})`;
      ctx.lineWidth = Math.max(1.1, pxPerMile * 0.005);
      ctx.setLineDash([]);
    } else if (k === 1) {     // apron
      ctx.fillStyle = `rgba(120,140,162,${0.13 * op})`;
      ctx.strokeStyle = `rgba(150,172,192,${0.18 * op})`;
      ctx.lineWidth = 1; ctx.setLineDash([]);
    } else if (k === 2) {     // building (terminal/hangar)
      ctx.fillStyle = `rgba(150,160,178,${0.22 * op})`;
      ctx.strokeStyle = `rgba(182,194,210,${0.34 * op})`;
      ctx.lineWidth = 1; ctx.setLineDash([]);
    } else {                  // aerodrome boundary
      ctx.fillStyle = "rgba(0,0,0,0)";
      ctx.strokeStyle = `rgba(120,165,185,${0.16 * op})`;
      ctx.lineWidth = 1; ctx.setLineDash([7, 8]);
    }

    const W = f.w, H = f.h, M = 70;
    for (const feat of feats) {
      const p = feat.p;
      const c0 = f.cam.project(p[0], p[1]);
      // Cull off-screen features (cheap: check the first point, then a midpoint).
      if (c0.x < -M || c0.x > W + M || c0.y < -M || c0.y > H + M) {
        const mi = (p.length >> 2) * 2; // ~middle vertex
        const cm = f.cam.project(p[mi], p[mi + 1]);
        if (cm.x < -M || cm.x > W + M || cm.y < -M || cm.y > H + M) continue;
      }
      ctx.beginPath();
      ctx.moveTo(c0.x, c0.y);
      for (let i = 2; i < p.length; i += 2) {
        const q = f.cam.project(p[i], p[i + 1]);
        ctx.lineTo(q.x, q.y);
      }
      if (fill) { ctx.closePath(); ctx.fill(); ctx.stroke(); }
      else ctx.stroke();
    }
    if (k === 3) ctx.setLineDash([]);
  }
}
