// Comet trails, coloured by trail mode (ported from v1):
//   "climb"    — green climbing → neutral level → red descending, per the altitude
//                delta between fixes, intensity scaled by trailBoost.
//   "altitude" — the altitude ramp (low warm → high cool).
//   "flat"     — a single palette colour.
// Each segment fades old→bright; width scales with glyph size + boost. Capped to the
// nearest N aircraft (the expensive per-segment work) for the Pi paint budget.
import type { Layer, FrameContext, Visible } from "./types";
import { altRamp, lerp, hexRGB, type RGB } from "./colors";

const MAX_TRAILS = 40;

const TRAIL_CLIMB: RGB = [60, 230, 150];
const TRAIL_DESCEND: RGB = [255, 95, 60];
const TRAIL_LEVEL: RGB = [130, 150, 185];

export class TrailLayer implements Layer {
  readonly name = "trails";

  draw(f: FrameContext): void {
    if (f.cfg.showTraffic === false) return; // master traffic toggle
    if (f.interacting) return; // low-detail during a gesture (trails are the costliest layer)
    const ctx = f.ctx;
    const mode = f.cfg.trailMode;
    const boost = f.cfg.trailBoost ?? 0.5;
    const flat = hexRGB(f.cfg.palette.trail || "#cfd8e3");
    const home = f.cam.project(f.cfg.centerLat, f.cfg.centerLon);

    // Only clone+sort when we must cap; under the cap, iterate the live array (no per-frame alloc).
    let list = f.aircraft;
    if (list.length > MAX_TRAILS) {
      list = [...f.aircraft];
      list.sort((a, b) => d2(f, a, home) - d2(f, b, home));
      list.length = MAX_TRAILS;
    }

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const a of list) {
      const pts = a.trail;
      if (pts.length < 2) continue;
      const t0 = pts[0].t;
      const span = pts[pts.length - 1].t - t0 || 1;
      for (let i = 1; i < pts.length; i++) {
        const s0 = pts[i - 1], s1 = pts[i];
        const f01 = (s1.t - t0) / span; // 0 tail → 1 head
        let rgb: RGB;
        if (mode === "flat") rgb = flat;
        else if (mode === "climb") rgb = climbColor(s0.alt, s1.alt, boost);
        else rgb = s1.alt != null ? altRamp(s1.alt) : flat;
        const p0 = f.cam.project(s0.lat, s0.lon);
        const p1 = f.cam.project(s1.lat, s1.lon);
        const taper = f01 * f01 * (3 - 2 * f01); // smoothstep tail→head
        ctx.strokeStyle = `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},${((0.5 + 0.45 * boost) * taper).toFixed(3)})`;
        ctx.lineWidth = (0.4 + 2.6 * taper * ((f.cfg.glyphSizePx ?? 18) / 14)) * (1 + 0.5 * boost);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
      // Bright head node so the leading edge reads as the "comet" nucleus.
      const head = pts[pts.length - 1];
      let hrgb: RGB;
      if (mode === "flat") hrgb = flat;
      else if (mode === "climb") hrgb = climbColor(pts[pts.length - 2].alt, head.alt, boost);
      else hrgb = head.alt != null ? altRamp(head.alt) : flat;
      const hp = f.cam.project(head.lat, head.lon);
      ctx.fillStyle = `rgba(${hrgb[0] | 0},${hrgb[1] | 0},${hrgb[2] | 0},${(0.5 + 0.4 * boost).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, 1.1 + 1.0 * ((f.cfg.glyphSizePx ?? 18) / 18), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// Segment colour by vertical trend (v1): green up, red down, neutral level.
function climbColor(a: number | null | undefined, b: number | null | undefined, boost: number): RGB {
  const d = (b ?? a ?? 0) - (a ?? b ?? 0);
  let k = (d / 25) * (0.7 + boost);
  k = Math.max(-1, Math.min(1, k));
  return k >= 0 ? lerp(TRAIL_LEVEL, TRAIL_CLIMB, k) : lerp(TRAIL_LEVEL, TRAIL_DESCEND, -k);
}

function d2(f: FrameContext, a: Visible, home: { x: number; y: number }): number {
  const p = f.cam.project(a.lat, a.lon);
  const dx = p.x - home.x, dy = p.y - home.y;
  return dx * dx + dy * dy;
}
