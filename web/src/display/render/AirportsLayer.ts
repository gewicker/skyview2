// Airport overlay: glowing runways at true position, plus optional approach corridors
// (extended runway centerlines) so you can see what's lined up for final.
import type { Layer, FrameContext } from "./types";
import { AIRPORTS } from "./airports";

export class AirportsLayer implements Layer {
  readonly name = "airports";

  draw(f: FrameContext): void {
    if (!f.cfg.showAirport && !f.cfg.showApproaches) return;
    const ctx = f.ctx;
    // px per mile (for the approach extension length), from the home reference.
    const h0 = f.cam.project(f.cfg.centerLat, f.cfg.centerLon);
    const h1 = f.cam.project(f.cfg.centerLat + 1 / 69, f.cfg.centerLon);
    const pxPerMile = Math.hypot(h1.x - h0.x, h1.y - h0.y) || 1;

    ctx.save();
    ctx.lineCap = "round";
    for (const ap of AIRPORTS) {
      for (const rw of ap.runways) {
        const a = f.cam.project(rw.le[0], rw.le[1]);
        const b = f.cam.project(rw.he[0], rw.he[1]);
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;

        if (f.cfg.showApproaches) {
          const ext = 5 * pxPerMile; // ~5 mi final
          ctx.strokeStyle = "rgba(120,190,215,0.22)";
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 6]);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y); ctx.lineTo(a.x - ux * ext, a.y - uy * ext);
          ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + ux * ext, b.y + uy * ext);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (f.cfg.showAirport) {
          ctx.strokeStyle = "rgba(150,205,225,0.55)";
          ctx.lineWidth = Math.max(2, (rw.widthFt / 150) * 3.2);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
}
