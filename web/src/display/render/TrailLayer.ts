// Comet trails, coloured by trail mode (ported from v1):
//   "climb"    — green climbing → neutral level → red descending, per the altitude
//                delta between fixes, intensity scaled by trailBoost.
//   "altitude" — the altitude ramp (low warm → high cool).
//   "flat"     — a single palette colour.
// Each segment fades old→bright; width scales with glyph size + boost. Capped to the
// nearest N aircraft (the expensive per-segment work) for the Pi paint budget.
import type { Layer, FrameContext, Visible } from "./types";

const MAX_TRAILS = 40;

const TRAIL_CLIMB: RGB = [60, 230, 150];
const TRAIL_DESCEND: RGB = [255, 95, 60];
const TRAIL_LEVEL: RGB = [130, 150, 185];
type RGB = [number, number, number];

const ALT_STOPS: [number, RGB][] = [
  [0, [255, 140, 60]], [3000, [255, 196, 70]], [10000, [120, 220, 150]],
  [20000, [80, 190, 235]], [30000, [120, 150, 255]], [40000, [180, 150, 255]],
];

export class TrailLayer implements Layer {
  readonly name = "trails";

  draw(f: FrameContext): void {
    if (f.interacting) return; // low-detail during a gesture (trails are the costliest layer)
    const ctx = f.ctx;
    const mode = f.cfg.trailMode;
    const boost = f.cfg.trailBoost ?? 0.5;
    const flat = hexRGB(f.cfg.palette.trail || "#cfd8e3");
    const home = f.cam.project(f.cfg.centerLat, f.cfg.centerLon);

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
        ctx.strokeStyle = `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},${((0.5 + 0.45 * boost) * f01).toFixed(3)})`;
        ctx.lineWidth = (0.7 + 2.2 * f01 * ((f.cfg.glyphSizePx ?? 18) / 14)) * (1 + 0.5 * boost);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
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

function altRamp(alt: number): RGB {
  if (alt <= ALT_STOPS[0][0]) return ALT_STOPS[0][1];
  for (let i = 1; i < ALT_STOPS.length; i++) {
    if (alt <= ALT_STOPS[i][0]) {
      const [a0, c0] = ALT_STOPS[i - 1];
      const [a1, c1] = ALT_STOPS[i];
      return lerp(c0, c1, (alt - a0) / (a1 - a0));
    }
  }
  return ALT_STOPS[ALT_STOPS.length - 1][1];
}

function lerp(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function hexRGB(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [207, 216, 227];
}

function d2(f: FrameContext, a: Visible, home: { x: number; y: number }): number {
  const p = f.cam.project(a.lat, a.lon);
  const dx = p.x - home.x, dy = p.y - home.y;
  return dx * dx + dy * dy;
}
