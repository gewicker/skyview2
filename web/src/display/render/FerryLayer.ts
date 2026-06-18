// Live WA State Ferries as cool steel-blue markers gliding the Sound, each trailing a soft white
// wake (from the lagging anchor). Real marine traffic — sits in the ground tier below aircraft, no
// additive glow / strobe (aircraft-only). Steel blue is clear of the rail jade, bus violet,
// aircraft cyan/amber, and the gold home beacon. Label-free until tapped.
import type { Layer, FrameContext } from "./types";
import { startLiveFerries, tickLiveFerries, liveFerries } from "./liveferries";

const HULL = "120,170,205"; // cool steel blue

export class FerryLayer implements Layer {
  readonly name = "ferries";

  draw(f: FrameContext): void {
    if (!f.cfg.showFerries) return;
    startLiveFerries();
    tickLiveFerries(f.dt);
    const ferries = liveFerries();
    if (!ferries.length) return;
    const ctx = f.ctx, w = f.w, h = f.h;
    ctx.save();
    ctx.lineCap = "round";
    for (const v of ferries) {
      const p = f.cam.project(v.lat, v.lon);
      if (p.x < -16 || p.x > w + 16 || p.y < -16 || p.y > h + 16) continue;
      const a = v.fade;
      // wake from the lagging anchor (collapses at the dock)
      if (!v.atDock) {
        const ap = f.cam.project(v.alat, v.alon);
        const grad = ctx.createLinearGradient(ap.x, ap.y, p.x, p.y);
        grad.addColorStop(0, `rgba(220,235,245,0)`);
        grad.addColorStop(1, `rgba(220,235,245,${0.4 * a})`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(ap.x, ap.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      // soft halo
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${HULL},${0.16 * a})`;
      ctx.fill();
      // hull marker (slightly larger than a bus — ferries are big)
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${HULL},${0.92 * a})`;
      ctx.fill();
      // bright core
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.7, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(235,244,250,${0.96 * a})`;
      ctx.fill();
    }
    ctx.restore();
  }
}
