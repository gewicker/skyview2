// Live WA State Ferries as cool steel-blue markers gliding the Sound, each trailing a soft white
// wake (from the lagging anchor). Real marine traffic — sits in the ground tier below aircraft, no
// additive glow / strobe (aircraft-only). Steel blue is clear of the rail jade, bus violet,
// aircraft cyan/amber, and the gold home beacon. Label-free until tapped.
import type { Layer, FrameContext } from "./types";
import { startLiveFerries, tickLiveFerries, liveFerries } from "./liveferries";

const HULL = "140,195,235"; // brighter steel-cyan so it stands off the teal water

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
      ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${HULL},${0.2 * a})`;
      ctx.fill();
      // hull marker (bigger + brighter so it reads off the teal water)
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${HULL},${0.95 * a})`;
      ctx.fill();
      // bright near-white core — the visible "there's a boat here" point
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(238,246,252,${0.98 * a})`;
      ctx.fill();
    }
    ctx.restore();
  }
}
