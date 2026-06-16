// Notable visuals: a target bracket + a small stylised emblem on flagged aircraft
// (medical cross, fire flame, police shield, military chevron, emergency warning), and
// a blinking screen-edge border in the colour of the highest-priority category on
// screen — the Pi has no speaker, so the edge is the alert. Emblems are generic
// symbols, not real agency logos. Drawn on top of everything.
import type { Layer, FrameContext } from "./types";
import { classifyNotable, NOTABLE_STYLE, type NotableCat, type Emblem } from "./notable";
import { isLightsOut, sunAltitude } from "./sun";
import type { RGB } from "./colors";

export class NotableLayer implements Layer {
  readonly name = "notable";

  draw(f: FrameContext): void {
    if (!f.cfg.showNotable) return;
    const ctx = f.ctx;
    let topCat: NotableCat | null = null;
    let topPri = 0;

    for (const a of f.aircraft) {
      const cat = classifyNotable(a);
      if (!cat) continue;
      const st = NOTABLE_STYLE[cat];
      const p = f.cam.project(a.lat, a.lon);
      this.designator(ctx, p.x, p.y, st.color, f.t);
      if (st.emblem !== "none") {
        drawEmblem(ctx, p.x, p.y - 26, st.emblem, f.t);
        // Tiny category tag under the emblem.
        ctx.save();
        ctx.font = "600 9px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = `rgba(${st.color[0]},${st.color[1]},${st.color[2]},0.92)`;
        ctx.fillText(st.label, p.x, p.y - 38);
        ctx.restore();
      }
      if (st.border && st.priority > topPri) { topPri = st.priority; topCat = cat; }
    }

    // Screen-edge border for an EMERGENCY only — a slow, calm breath (no strobe, no
    // red/white flicker), and fully suppressed during the night/mute window so it
    // never disturbs sleep.
    if (topCat && f.cfg.notableFlash && !this.muted(f)) {
      const st = NOTABLE_STYLE[topCat];
      const breath = 0.5 + 0.5 * Math.sin(f.t * 1.3); // ~0.2 Hz
      this.edgeBorder(ctx, f.w, f.h, st.color, 0.22 + 0.34 * breath);
    }
  }

  // True while the display is in its muted night state (lights-out schedule or manual).
  private muted(f: FrameContext): boolean {
    if (f.cfg.monitorMode !== "lightsout") return false;
    const date = new Date(Date.now() + (f.cfg.skyTimeOffsetMin || 0) * 60000);
    if (isLightsOut(f.cfg.centerLat, f.cfg.centerLon, f.cfg.lightsOutHour ?? 23, date)) return true;
    return (f.cfg.muteUntil ?? 0) > Date.now() && sunAltitude(f.cfg.centerLat, f.cfg.centerLon, date) < 0;
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

  // A blinking frame just inside the screen edges.
  private edgeBorder(ctx: CanvasRenderingContext2D, w: number, h: number, c: RGB, alpha: number): void {
    ctx.save();
    const lw = 6, inset = lw / 2 + 2;
    ctx.strokeStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.min(0.9, alpha).toFixed(3)})`;
    ctx.lineWidth = lw;
    ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
    // Soft inner glow so it reads on a busy map.
    const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.hypot(w, h) * 0.6);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${(alpha * 0.4).toFixed(3)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}

// --- emblems (stylised, ~16px) ------------------------------------------------- //
function drawEmblem(ctx: CanvasRenderingContext2D, x: number, y: number, kind: Emblem, t: number): void {
  const pulse = 0.7 + 0.3 * Math.sin(t * 5);
  ctx.save();
  ctx.translate(x, y);
  switch (kind) {
    case "cross": { // medical: red cross on white
      roundRect(ctx, -8, -8, 16, 16, 4); ctx.fillStyle = `rgba(245,245,248,${pulse})`; ctx.fill();
      ctx.fillStyle = "rgba(214,30,30,0.95)";
      ctx.fillRect(-2, -6, 4, 12); ctx.fillRect(-6, -2, 12, 4);
      break;
    }
    case "flame": { // fire: amber flame
      ctx.fillStyle = `rgba(255,140,36,${pulse})`;
      ctx.beginPath();
      ctx.moveTo(0, -9); ctx.quadraticCurveTo(6, -2, 4, 4);
      ctx.quadraticCurveTo(3, 8, 0, 8); ctx.quadraticCurveTo(-4, 8, -4, 3);
      ctx.quadraticCurveTo(-4, 0, -1, -3); ctx.quadraticCurveTo(0, 0, 0, -9);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,220,120,0.9)";
      ctx.beginPath(); ctx.arc(0, 3, 2.4, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "shield": { // police: blue shield + star
      ctx.fillStyle = `rgba(70,132,255,${pulse})`;
      ctx.beginPath();
      ctx.moveTo(0, -9); ctx.lineTo(7, -5); ctx.lineTo(7, 2);
      ctx.quadraticCurveTo(7, 7, 0, 9); ctx.quadraticCurveTo(-7, 7, -7, 2);
      ctx.lineTo(-7, -5); ctx.closePath(); ctx.fill();
      star(ctx, 0, -1, 4, 1.8, "rgba(255,255,255,0.95)");
      break;
    }
    case "chevron": { // military: olive chevrons
      ctx.strokeStyle = `rgba(150,170,100,${pulse})`; ctx.lineWidth = 2; ctx.lineCap = "round";
      for (const oy of [-3, 1]) {
        ctx.beginPath(); ctx.moveTo(-6, oy + 3); ctx.lineTo(0, oy - 2); ctx.lineTo(6, oy + 3); ctx.stroke();
      }
      break;
    }
    case "warn": { // emergency: red/white warning triangle
      ctx.fillStyle = `rgba(235,60,50,${pulse})`;
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(9, 7); ctx.lineTo(-9, 7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillRect(-1.3, -3, 2.6, 6); ctx.fillRect(-1.3, 4, 2.6, 2.2);
      break;
    }
  }
  ctx.restore();
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, rOut: number, rIn: number, fill: string): void {
  ctx.fillStyle = fill; ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const r = i % 2 ? rIn : rOut;
    const fn = i === 0 ? "moveTo" : "lineTo";
    ctx[fn](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath(); ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
