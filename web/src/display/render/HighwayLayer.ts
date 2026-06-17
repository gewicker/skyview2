// Synthetic highway traffic — ambient life on the local freeways. There's no keyless
// per-vehicle feed, so cars are SYNTHESIZED: dots marching along bundled road centerlines
// at a speed/colour set by a time-of-day congestion model (honest texture, not live data).
// Tuned to stay AMBIENT, never competing with aircraft: tiny 2.2 px dots, traffic-state
// colour but hard alpha ceiling (effective peak ~0.44), and a faint road track so an empty
// highway still orients. Label-free always — individual cars have nothing worth saying.
// Off by default; the loud one is left off in the bedside preset.
import type { Layer, FrameContext } from "./types";
import { HIGHWAYS, congestionNow, type Highway } from "./highways";

const DOT = 2.2;          // car radius (px) — below the taxiing-aircraft chevron floor
const SPACING = 15;       // px between cars along the road
const MASTER = 0.55;      // global multiplier → effective peak ≈ 0.44

// Congestion → colour (muted so a jammed I-5 never out-shouts the traffic).
function trafficColor(c: number): [number, number, number] {
  if (c < 0.4) return [86, 196, 140];   // free-flow green
  if (c < 0.7) return [232, 176, 82];   // moderate amber
  return [224, 96, 72];                 // heavy, desaturated red
}

export class HighwayLayer implements Layer {
  readonly name = "highway";
  private pts: { x: number; y: number }[] = []; // scratch, reused per road

  draw(f: FrameContext): void {
    if (!f.cfg.showHighways) return;
    const intensity = f.cfg.highwayIntensity ?? 0.6;
    if (intensity < 0.02) return;
    const ctx = f.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    for (const hw of HIGHWAYS) this.drawRoad(f, hw, intensity);
    ctx.restore();
  }

  private drawRoad(f: FrameContext, hw: Highway, intensity: number): void {
    const ctx = f.ctx, w = f.w, h = f.h;
    // Project the centerline once.
    this.pts.length = 0;
    for (const [lat, lon] of hw.path) this.pts.push(f.cam.project(lat, lon));
    const pts = this.pts;
    if (pts.length < 2) return;

    // Quick reject: skip a road entirely off-screen.
    let onscreen = false;
    for (const p of pts) {
      if (p.x > -50 && p.x < w + 50 && p.y > -50 && p.y < h + 50) { onscreen = true; break; }
    }
    if (!onscreen) return;

    // Faint road track so an empty highway still reads (orienting).
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(120,130,150,0.18)";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();

    const cong = congestionNow(hw.base);
    const [r, g, b] = trafficColor(cong);
    // Heavier traffic = slower-moving dots; free-flow streams quickly.
    const speed = 26 - 22 * cong;                // px/sec
    const alpha = Math.min(0.8, 0.55 + 0.35 * cong) * MASTER * intensity;
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;

    // March dots along the projected polyline. Cars sit at global arc-length positions
    // G = m*SPACING + phase (integer m); phase advances with time so the stream flows.
    const phase = (f.t * speed) % SPACING;
    let startG = 0; // global distance at the start of the current segment
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], c = pts[i];
      const segLen = Math.hypot(c.x - a.x, c.y - a.y);
      if (segLen < 0.001) continue;
      const nx = (c.x - a.x) / segLen, ny = (c.y - a.y) / segLen;
      // First car at or past the segment start: smallest m with m*SPACING+phase >= startG.
      const m0 = Math.ceil((startG - phase) / SPACING);
      for (let d = m0 * SPACING + phase - startG; d <= segLen; d += SPACING) {
        const x = a.x + nx * d, y = a.y + ny * d;
        if (x < -10 || x > w + 10 || y < -10 || y > h + 10) continue;
        ctx.beginPath();
        ctx.arc(x, y, DOT, 0, 6.283);
        ctx.fill();
      }
      startG += segLen;
    }
  }
}
