// Comet trails: each aircraft's recent path, fading from transparent (old) to bright
// (now), coloured by trail mode. Drawn under the glyphs. Per the Pi paint budget,
// trails are capped to the nearest N aircraft (the expensive per-segment work).
import type { Layer, FrameContext, Visible } from "./types";

const MAX_TRAILS = 40;

export class TrailLayer implements Layer {
  readonly name = "trails";

  draw(f: FrameContext): void {
    const ctx = f.ctx;
    const home = f.cam.project(f.cfg.centerLat, f.cfg.centerLon);

    // Nearest N to home get trails (cheap distance in screen space is fine here).
    const list = [...f.aircraft];
    if (list.length > MAX_TRAILS) {
      list.sort((a, b) => d2(f, a, home) - d2(f, b, home));
      list.length = MAX_TRAILS;
    }

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const a of list) {
      const pts = a.trail;
      if (pts.length < 2) continue;
      const base = f.cfg.trailMode === "flat" ? "215,222,233" : trailRGB(a.altBaro);
      const t0 = pts[0].t;
      const span = pts[pts.length - 1].t - t0 || 1;
      ctx.lineWidth = 2;
      for (let i = 1; i < pts.length; i++) {
        const p0 = f.cam.project(pts[i - 1].lat, pts[i - 1].lon);
        const p1 = f.cam.project(pts[i].lat, pts[i].lon);
        const age = (pts[i].t - t0) / span; // 0 old → 1 new
        ctx.strokeStyle = `rgba(${base},${(0.08 + 0.55 * age).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

function d2(f: FrameContext, a: Visible, home: { x: number; y: number }): number {
  const p = f.cam.project(a.lat, a.lon);
  const dx = p.x - home.x, dy = p.y - home.y;
  return dx * dx + dy * dy;
}

// Low = warm, high = cool (matches the glyph altitude ramp).
function trailRGB(alt?: number | null): string {
  if (alt == null) return "154,163,178";
  const t = Math.max(0, Math.min(1, alt / 40000));
  return `${Math.round(255 * (1 - t) + 90 * t)},${Math.round(150 * (1 - t) + 170 * t)},${Math.round(60 * (1 - t) + 255 * t)}`;
}
