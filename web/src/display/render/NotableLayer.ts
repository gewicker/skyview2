// Notable visuals: a target-bracket designator around flagged aircraft, and an
// edge-flash pulse in the category colour when a new one appears (the Pi has no
// speaker, so the screen edge is the alert). Drawn on top of everything.
import type { Layer, FrameContext } from "./types";
import { classifyNotable, NOTABLE_COLOR } from "./notable";

type RGB = [number, number, number];
const FLASH_MS = 2600;

export class NotableLayer implements Layer {
  readonly name = "notable";
  private flashUntil = 0;
  private flashColor: RGB = [232, 72, 60];
  private seen = new Set<string>();

  draw(f: FrameContext): void {
    if (!f.cfg.showNotable) return;
    const ctx = f.ctx;
    const nowMs = f.t * 1000;
    const current = new Set<string>();

    for (const a of f.aircraft) {
      const cat = classifyNotable(a);
      if (!cat) continue;
      current.add(a.hex);
      const color = NOTABLE_COLOR[cat];
      const p = f.cam.project(a.lat, a.lon);
      this.designator(ctx, p.x, p.y, color, f.t);
      if (f.cfg.notableFlash && cat !== "heavy" && !this.seen.has(a.hex)) {
        this.flashUntil = nowMs + FLASH_MS;
        this.flashColor = color;
      }
    }
    this.seen = current;

    if (f.cfg.notableFlash && nowMs < this.flashUntil) {
      const k = (this.flashUntil - nowMs) / FLASH_MS; // 1 → 0
      const a = (0.18 + 0.32 * k) * (0.55 + 0.45 * Math.sin(f.t * 8));
      this.edgeFlash(ctx, f.w, f.h, this.flashColor, Math.max(0, a));
    }
  }

  private designator(ctx: CanvasRenderingContext2D, x: number, y: number, c: RGB, t: number): void {
    const r = 15 + 2 * Math.sin(t * 4);
    const g = 5;
    ctx.save();
    ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},0.9)`;
    ctx.lineWidth = 2;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      ctx.beginPath();
      ctx.moveTo(x + sx * r, y + sy * r - sy * g * 2);
      ctx.lineTo(x + sx * r, y + sy * r);
      ctx.lineTo(x + sx * r - sx * g * 2, y + sy * r);
      ctx.stroke();
    }
    ctx.restore();
  }

  private edgeFlash(ctx: CanvasRenderingContext2D, w: number, h: number, c: RGB, alpha: number): void {
    ctx.save();
    const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.hypot(w, h) * 0.6);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},${Math.min(0.6, alpha).toFixed(3)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}
