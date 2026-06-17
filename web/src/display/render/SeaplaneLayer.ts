// Seaplane bases on the local lakes. Marked with the real aeronautical chart symbol — an anchor
// in a circle — label-free until tapped (like navaids/fixes), plus a few muted dock/terminal/ramp
// marks (airport-diagram building palette) once zoomed into the lake. Water LANDING LANES were
// dropped: the FAA advisory operating areas have no surveyed coordinates here and the hand-placed
// ones rendered onto the far shore, so the anchor (the standard water-aerodrome symbol) stands alone.
import type { Layer, FrameContext } from "./types";
import { SEAPLANE_BASES, type SeaplaneBase, type DockMark } from "./seaplane";
import { sunAltitude } from "./sun";

const SHOW_MARKS_PXMI = 80;                  // fine shore detail only when zoomed into the lake
// Day→night factor (0 day → 1 night), matching the aircraft/runway-light curve, for dock embers.
const nightFactor = (sunAltDeg: number): number => {
  const f = (3 - sunAltDeg) / 9;
  return f < 0 ? 0 : f > 1 ? 1 : f;
};

export class SeaplaneLayer implements Layer {
  readonly name = "seaplane";

  draw(f: FrameContext): void {
    if (!f.cfg.showAirport) return;
    const ctx = f.ctx;
    const h0 = f.cam.project(f.cfg.centerLat, f.cfg.centerLon);
    const h1 = f.cam.project(f.cfg.centerLat + 1 / 69, f.cfg.centerLon);
    const pxPerMile = Math.hypot(h1.x - h0.x, h1.y - h0.y) || 1;

    const nf = nightFactor(sunAltitude(f.cfg.centerLat, f.cfg.centerLon, new Date(Date.now() + (f.cfg.skyTimeOffsetMin || 0) * 60000)));
    ctx.save();
    ctx.lineCap = "butt";
    for (const base of SEAPLANE_BASES) {
      if (pxPerMile > SHOW_MARKS_PXMI) for (const m of base.marks) this.drawMark(f, m, nf);
      this.drawAnchor(f, base);
    }
    ctx.restore();
  }

  private drawMark(f: FrameContext, m: DockMark, nf: number): void {
    const ctx = f.ctx;
    // Night dock "ember": a small warm additive glow at the dock/ramp/terminal, fading in at dusk.
    if (nf > 0.05) {
      const e = f.cam.project(m.p[0], m.p[1]);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, 7);
      g.addColorStop(0, `rgba(255,190,110,${(0.5 * nf).toFixed(3)})`);
      g.addColorStop(1, "rgba(255,170,90,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(e.x, e.y, 7, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
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
    ctx.strokeStyle = "rgba(120,160,178,0.82)"; // passive low-chroma cyan (matches chart furniture)
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
