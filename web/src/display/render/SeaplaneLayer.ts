// Seaplane bases on the local lakes. Deliberately NOT the concrete-runway treatment: a water
// landing lane is an FAA advisory operating area on open water, so it's drawn as a soft,
// cooler, half-opacity DASHED corridor (vs the runway's solid slate pavement), with a dotted
// centerline + a direction chevron at each end instead of piano keys / painted numerals. The
// base itself is the real aeronautical chart symbol — an anchor in a circle — label-free until
// tapped, like navaids/fixes. A few muted dock/terminal/ramp marks in the airport-diagram
// building palette complete the area detail. Same muted system, unmistakably water.
import type { Layer, FrameContext } from "./types";
import { SEAPLANE_BASES, type SeaplaneBase, type DockMark } from "./seaplane";

const LANE_CTR = "rgba(150,205,225,0.5)";    // slim dotted centerline (the lane itself)
const LANE_DIR = "rgba(150,205,225,0.6)";    // end direction chevron
const SHOW_MARKS_PXMI = 80;                  // fine shore detail only when zoomed into the lake
const LANE_ZOOM_MIN = 2.5;                    // map-zoom where water lanes begin to appear; the
const LANE_ZOOM_FULL = 4;                     // ambient view (lower zoom) is the clean anchor alone
const smooth01 = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class SeaplaneLayer implements Layer {
  readonly name = "seaplane";

  draw(f: FrameContext): void {
    if (!f.cfg.showAirport) return;
    const ctx = f.ctx;
    const h0 = f.cam.project(f.cfg.centerLat, f.cfg.centerLon);
    const h1 = f.cam.project(f.cfg.centerLat + 1 / 69, f.cfg.centerLon);
    const pxPerMile = Math.hypot(h1.x - h0.x, h1.y - h0.y) || 1;

    // Lanes are zoom-gated: the sprawling water corridors clutter the ambient view, so they
    // fade in only once you zoom into the lake. The anchor (the actual chart symbol) is always on.
    const laneVis = smooth01(LANE_ZOOM_MIN, LANE_ZOOM_FULL, f.view.mapZoom || 1);
    ctx.save();
    ctx.lineCap = "butt";
    for (const base of SEAPLANE_BASES) {
      if (laneVis > 0.01) {
        ctx.save();
        ctx.globalAlpha = laneVis;
        this.drawLanes(f, base);
        ctx.restore();
      }
      if (pxPerMile > SHOW_MARKS_PXMI) for (const m of base.marks) this.drawMark(f, m);
      this.drawAnchor(f, base);
    }
    ctx.restore();
  }

  private drawLanes(f: FrameContext, base: SeaplaneBase): void {
    const ctx = f.ctx;
    // A water landing lane is now a SLIM dotted centerline with a direction chevron at each end —
    // NOT the old wide translucent corridor, which (two lanes from a near-common origin) read as a
    // messy fan across the lake. The dotted line + chevrons say "advisory water lane" cleanly.
    for (const lane of base.lanes) {
      const a = f.cam.project(lane.le[0], lane.le[1]);
      const b = f.cam.project(lane.he[0], lane.he[1]);
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;

      ctx.strokeStyle = LANE_CTR;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);

      chevron(ctx, a, ux, uy, nx, ny);   // at le, pointing toward he
      chevron(ctx, b, -ux, -uy, nx, ny); // at he, pointing toward le
    }
  }

  private drawMark(f: FrameContext, m: DockMark): void {
    const ctx = f.ctx;
    ctx.setLineDash([]);
    if (m.kind === "terminal") {
      // Small filled block in the airport-diagram "building" palette.
      const p = f.cam.project(m.p[0], m.p[1]);
      ctx.fillStyle = "rgba(150,160,178,0.22)";
      ctx.strokeStyle = "rgba(182,194,210,0.34)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(p.x - 3.5, p.y - 2.5, 7, 5);
      ctx.fill();
      ctx.stroke();
      return;
    }
    // dock / ramp: a short thick line on the shore.
    ctx.strokeStyle = m.kind === "ramp" ? "rgba(150,172,192,0.45)" : "rgba(182,194,210,0.34)";
    ctx.lineWidth = m.kind === "ramp" ? 2 : 1.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < m.p.length; i += 2) {
      const q = f.cam.project(m.p[i], m.p[i + 1]);
      if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
    ctx.lineCap = "butt";
  }

  // Anchor-in-circle — the real chart symbol for a water aerodrome. Label-free until tapped.
  private drawAnchor(f: FrameContext, base: SeaplaneBase): void {
    const ctx = f.ctx;
    const p = f.cam.project(base.lat, base.lon);
    ctx.setLineDash([]);
    ctx.save();
    ctx.translate(p.x, p.y);

    // Disc.
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(20,40,52,0.55)";
    ctx.fill();
    ctx.strokeStyle = "rgba(150,205,225,0.85)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Anchor.
    ctx.strokeStyle = "rgba(198,224,236,0.92)";
    ctx.lineWidth = 1.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(0, -3); ctx.lineTo(0, 4);                 // shank
    ctx.moveTo(-2.6, -1.4); ctx.lineTo(2.6, -1.4);       // stock (crossbar)
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -4.4, 1.6, 0, Math.PI * 2);               // top ring
    ctx.stroke();
    ctx.beginPath();                                      // flukes
    ctx.moveTo(-3.4, 3); ctx.quadraticCurveTo(-2.2, 5.2, 0, 4.6);
    ctx.moveTo(3.4, 3); ctx.quadraticCurveTo(2.2, 5.2, 0, 4.6);
    ctx.stroke();

    ctx.restore();
    ctx.lineCap = "butt";
  }
}

// A small ">" chevron at a lane end, pointing along (ux,uy) — the landing direction.
function chevron(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, ux: number, uy: number, nx: number, ny: number): void {
  const s = 6;
  const tipX = p.x + ux * s, tipY = p.y + uy * s; // a touch inside the end, along the lane
  ctx.setLineDash([]);
  ctx.strokeStyle = LANE_DIR;
  ctx.lineWidth = 1.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(tipX - ux * s + nx * s, tipY - uy * s + ny * s);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(tipX - ux * s - nx * s, tipY - uy * s - ny * s);
  ctx.stroke();
  ctx.lineCap = "butt";
}
