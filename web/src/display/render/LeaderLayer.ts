// Velocity leader-lines: a thin predictor projected ahead of each airborne target
// along its track, length = where it'll be in LEAD_SEC at current groundspeed. Makes
// headings + relative motion read at a glance (who's converging, who's diverging).
// Drawn under the glyphs. Gated on cfg.showRelative.
import type { Layer, FrameContext } from "./types";
import { altRamp, hexRGB, type RGB } from "./colors";

const DEG = Math.PI / 180;
const KT_MS = 0.514444;
const LEAD_SEC = 60;

export class LeaderLayer implements Layer {
  readonly name = "leaders";

  draw(f: FrameContext): void {
    if (!f.cfg.showRelative || f.interacting) return;
    const ctx = f.ctx;
    const flat = hexRGB(f.cfg.palette.glyph || "#ff9a3c");
    ctx.save();
    ctx.lineCap = "round";
    for (const a of f.aircraft) {
      if (a.onGround || a.track == null || a.gs == null || a.gs < 30) continue;
      const distM = a.gs * KT_MS * LEAD_SEC;
      const br = a.track * DEG;
      const dLat = (distM * Math.cos(br)) / 110540;
      const dLon = (distM * Math.sin(br)) / (111320 * Math.cos(a.lat * DEG));
      const p0 = f.cam.project(a.lat, a.lon);
      const p1 = f.cam.project(a.lat + dLat, a.lon + dLon);
      const rgb: RGB = f.cfg.altitudeColor ? altRamp(a.altBaro ?? 0) : flat;
      const grad = ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
      grad.addColorStop(0, `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},0.5)`);
      grad.addColorStop(1, `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},0)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
      // A small tick at the 60-second point.
      ctx.fillStyle = `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},0.4)`;
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
