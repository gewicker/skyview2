// Seaplane bases on the local lakes. Deliberately NOT the concrete-runway treatment: a water
// landing lane is an FAA advisory operating area on open water, so it's drawn as a soft,
// cooler, half-opacity DASHED corridor (vs the runway's solid slate pavement), with a dotted
// centerline + a direction chevron at each end instead of piano keys / painted numerals. The
// base itself is the real aeronautical chart symbol — an anchor in a circle — label-free until
// tapped, like navaids/fixes. A few muted dock/terminal/ramp marks in the airport-diagram
// building palette complete the area detail. Same muted system, unmistakably water.
import type { Layer, FrameContext } from "./types";
import { SEAPLANE_BASES, type SeaplaneBase, type DockMark } from "./seaplane";

const LANE_FILL = "rgba(70,150,180,0.10)";   // cool, translucent — half the runway's opacity
const LANE_EDGE = "rgba(150,205,225,0.42)";  // dashed advisory edge
const LANE_CTR = "rgba(150,205,225,0.30)";   // dotted centerline
const LANE_DIR = "rgba(150,205,225,0.55)";   // end direction chevron
const SHOW_MARKS_PXMI = 80;                  // fine shore detail only when zoomed into the lake

export class SeaplaneLayer implements Layer {
  readonly name = "seaplane";

  draw(f: FrameContext): void {
    if (!f.cfg.showAirport) return;
    const ctx = f.ctx;
    const h0 = f.cam.project(f.cfg.centerLat, f.cfg.centerLon);
    const h1 = f.cam.project(f.cfg.centerLat + 1 / 69, f.cfg.centerLon);
    const pxPerMile = Math.hypot(h1.x - h0.x, h1.y - h0.y) || 1;

    ctx.save();
    ctx.lineCap = "butt";
    for (const base of SEAPLANE_BASES) {
      this.drawLanes(f, base, pxPerMile);
      if (pxPerMile > SHOW_MARKS_PXMI) for (const m of base.marks) this.drawMark(f, m);
      this.drawAnchor(f, base);
    }
    ctx.restore();
  }

  private drawLanes(f: FrameContext, base: SeaplaneBase, pxPerMile: number): void {
    const ctx = f.ctx;
    // Long lane first so a shorter crossing lane (Kenmore 18/36) layers on top — the overlap
    // just sums to a slightly brighter "operating area" diamond.
    for (const lane of base.lanes) {
      const a = f.cam.project(lane.le[0], lane.le[1]);
      const b = f.cam.project(lane.he[0], lane.he[1]);
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const nx = -uy, ny = ux;
      const halfW = Math.max(2, (lane.widthFt / 5280) * pxPerMile / 2);

      // Translucent corridor (source-over, low alpha — NOT additive).
      ctx.beginPath();
      ctx.moveTo(a.x + nx * halfW, a.y + ny * halfW);
      ctx.lineTo(b.x + nx * halfW, b.y + ny * halfW);
      ctx.lineTo(b.x - nx * halfW, b.y - ny * halfW);
      ctx.lineTo(a.x - nx * halfW, a.y - ny * halfW);
      ctx.closePath();
      ctx.fillStyle = LANE_FILL;
      ctx.fill();

      // Dashed advisory edges (the clearest "not a runway" tell).
      ctx.strokeStyle = LANE_EDGE;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(a.x + nx * halfW, a.y + ny * halfW); ctx.lineTo(b.x + nx * halfW, b.y + ny * halfW);
      ctx.moveTo(a.x - nx * halfW, a.y - ny * halfW); ctx.lineTo(b.x - nx * halfW, b.y - ny * halfW);
      ctx.stroke();

      // Dotted centerline.
      ctx.strokeStyle = LANE_CTR;
      ctx.setLineDash([2, 7]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);

      // Direction chevrons (landing direction) at each end — instead of painted numerals.
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
