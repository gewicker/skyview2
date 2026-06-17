// Navaid overlay (off by default): VOR/VORTAC/VOR-DME compass roses, NDB locators,
// named fixes, and DME range rings around the field VORTAC — drawn in a clean
// chart idiom over the satellite map. Tap a symbol to reveal its detail card.
// Few features (≈6 navaids + 3 rings), so this is cheap even on the Pi.
import type { Layer, FrameContext } from "./types";
import { NAVAIDS, FIXES, DME_CENTER, DME_RINGS_NM, destPoint, findNavaid, findFix, type Navaid } from "./navdata";

const TEAL = "rgba(108,152,172,";   // dim low-chroma cyan — PASSIVE chart furniture (bright cyan reserved for the live "on final" tag)
const FAINT = "rgba(108,152,172,0.26)";

export class NavaidLayer implements Layer {
  readonly name = "navaids";

  draw(f: FrameContext): void {
    if (!f.cfg.showNavaids) return;
    const ctx = f.ctx;
    ctx.save();
    ctx.textBaseline = "middle";

    // DME range rings around the field VORTAC.
    this.drawRings(f);

    // Navaids + fixes.
    for (const n of NAVAIDS) this.drawNavaid(f, n);
    for (const fx of FIXES) {
      const p = f.cam.project(fx.lat, fx.lon);
      this.drawFix(ctx, p.x, p.y, fx.name, f.selectedNavId === fx.id);
    }

    // Detail card for the tapped feature.
    if (f.selectedNavId) this.drawDetail(f);
    ctx.restore();
  }

  private pxPerNM(f: FrameContext, lat: number, lon: number): number {
    const a = f.cam.project(lat, lon);
    const n = destPoint(lat, lon, 0, 1);
    const b = f.cam.project(n[0], n[1]);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  // Screen angle (rad) of true north at a point — keeps roses upright under rotation.
  private northAngle(f: FrameContext, lat: number, lon: number): number {
    const p = f.cam.project(lat, lon);
    const n = destPoint(lat, lon, 0, 1);
    const q = f.cam.project(n[0], n[1]);
    return Math.atan2(q.y - p.y, q.x - p.x);
  }

  private drawRings(f: FrameContext): void {
    const ctx = f.ctx;
    const c = f.cam.project(DME_CENTER.lat, DME_CENTER.lon);
    const perNM = this.pxPerNM(f, DME_CENTER.lat, DME_CENTER.lon);
    if (!(perNM > 0)) return;
    ctx.save();
    ctx.setLineDash([3, 7]);
    ctx.lineWidth = 1;
    for (const nm of DME_RINGS_NM) {
      const r = nm * perNM;
      if (r < 28 || r > Math.hypot(f.w, f.h)) continue;
      ctx.strokeStyle = FAINT;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.stroke();
      // NM label at the ring's top.
      ctx.setLineDash([]);
      ctx.font = "600 9px system-ui, sans-serif";
      ctx.fillStyle = TEAL + "0.6)";
      ctx.textAlign = "center";
      ctx.fillText(`${nm}`, c.x, c.y - r + 1);
      ctx.setLineDash([3, 7]);
    }
    ctx.restore();
  }

  private drawNavaid(f: FrameContext, n: Navaid): void {
    const ctx = f.ctx;
    const p = f.cam.project(n.lat, n.lon);
    if (p.x < -60 || p.x > f.w + 60 || p.y < -60 || p.y > f.h + 60) return;
    const sel = f.selectedNavId === n.id;
    const a = sel ? 1 : 0.85;
    ctx.save();
    ctx.translate(p.x, p.y);

    if (n.type === "ndb") {
      // NDB: stippled concentric dots (the classic "spray").
      ctx.fillStyle = TEAL + (a * 0.7) + ")";
      for (let ring = 3; ring <= 7; ring += 2) {
        const dots = ring * 3;
        for (let i = 0; i < dots; i++) {
          const ang = (i / dots) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(Math.cos(ang) * ring, Math.sin(ang) * ring, 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      // VOR family: a hexagon with a compass rose + north index.
      const rose = 24;
      const north = this.northAngle(f, n.lat, n.lon);
      ctx.strokeStyle = TEAL + (a * 0.55) + ")";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, rose, 0, Math.PI * 2);
      ctx.stroke();
      // Ticks every 30°, longer at the cardinals, oriented to true north.
      for (let deg = 0; deg < 360; deg += 30) {
        const ang = north + deg * (Math.PI / 180);
        const long = deg % 90 === 0;
        const r0 = rose - (long ? 6 : 3);
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0);
        ctx.lineTo(Math.cos(ang) * rose, Math.sin(ang) * rose);
        ctx.stroke();
      }
      // North arrowhead.
      ctx.fillStyle = TEAL + (a * 0.8) + ")";
      ctx.beginPath();
      const nx = Math.cos(north) * rose, ny = Math.sin(north) * rose;
      const tx = -Math.sin(north), ty = Math.cos(north);
      ctx.moveTo(nx, ny);
      ctx.lineTo(nx - Math.cos(north) * 5 + tx * 3, ny - Math.sin(north) * 5 + ty * 3);
      ctx.lineTo(nx - Math.cos(north) * 5 - tx * 3, ny - Math.sin(north) * 5 - ty * 3);
      ctx.closePath();
      ctx.fill();
      // Hexagon station symbol.
      this.hexagon(ctx, 7, TEAL + a + ")", n.type === "vortac");
    }

    if (sel) {
      ctx.strokeStyle = "rgba(255,210,120,0.95)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, n.type === "ndb" ? 12 : 30, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // Ident chip just below the symbol.
    ctx.font = "700 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    const w = ctx.measureText(n.ident).width + 8;
    const cy = p.y + (n.type === "ndb" ? 14 : 32);
    ctx.fillStyle = "rgba(8,18,24,0.6)";
    roundRect(ctx, p.x - w / 2, cy - 7, w, 14, 3);
    ctx.fill();
    ctx.fillStyle = TEAL + "0.95)";
    ctx.fillText(n.ident, p.x, cy);
  }

  private hexagon(ctx: CanvasRenderingContext2D, r: number, stroke: string, vortac: boolean): void {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    // Centre dot.
    ctx.fillStyle = stroke;
    ctx.beginPath();
    ctx.arc(0, 0, 1.4, 0, Math.PI * 2);
    ctx.fill();
    // VORTAC: three little TACAN "ears" on alternate faces.
    if (vortac) {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 - Math.PI / 6;
        const x = Math.cos(a) * (r + 2.5), y = Math.sin(a) * (r + 2.5);
        ctx.fillRect(x - 1.4, y - 1.4, 2.8, 2.8);
      }
    }
  }

  private drawFix(ctx: CanvasRenderingContext2D, x: number, y: number, name: string, sel: boolean): void {
    // Named fix: a small open triangle.
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = TEAL + (sel ? 1 : 0.8) + ")";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(5.5, 4); ctx.lineTo(-5.5, 4);
    ctx.closePath();
    ctx.stroke();
    if (sel) {
      ctx.strokeStyle = "rgba(255,210,120,0.95)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    ctx.font = "600 9px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = TEAL + "0.9)";
    ctx.fillText(name, x + 8, y + 1);
  }

  private drawDetail(f: FrameContext): void {
    const id = f.selectedNavId!;
    const n = findNavaid(id);
    const fx = !n ? findFix(id) : undefined;
    if (!n && !fx) return; // a final is selected — ProcedureLayer draws that card
    const lat = n ? n.lat : fx!.lat;
    const lon = n ? n.lon : fx!.lon;
    const p = f.cam.project(lat, lon);

    const lines: string[] = [];
    if (n) {
      lines.push(`${n.ident} · ${n.name}`);
      lines.push(typeLabel(n.type));
      if (n.freqMHz) lines.push(`${n.freqMHz.toFixed(2)} MHz`);
      if (n.freqKHz) lines.push(`${n.freqKHz} kHz`);
    } else {
      lines.push(`${fx!.name} · fix`);
      if (fx!.note) lines.push(fx!.note);
    }
    drawCard(f.ctx, f, p.x + 16, p.y - 10, lines);
  }
}

function typeLabel(t: Navaid["type"]): string {
  return t === "vortac" ? "VORTAC" : t === "vor-dme" ? "VOR-DME" : t === "vor" ? "VOR" : t === "tacan" ? "TACAN" : "NDB";
}

// Shared compact detail card (also used by the procedure layer).
export function drawCard(ctx: CanvasRenderingContext2D, f: FrameContext, x: number, y: number, lines: string[]): void {
  ctx.save();
  ctx.font = "12px system-ui, sans-serif";
  const lh = 16, padX = 10, padY = 8;
  let w = 0;
  for (let i = 0; i < lines.length; i++) {
    ctx.font = i === 0 ? "600 12px system-ui, sans-serif" : "12px system-ui, sans-serif";
    w = Math.max(w, ctx.measureText(lines[i]).width);
  }
  const cw = w + padX * 2, ch = lines.length * lh + padY * 2;
  // Keep the card on-screen.
  let cx = x, cy = y;
  if (cx + cw > f.w - 6) cx = x - cw - 32;
  if (cy + ch > f.h - 6) cy = f.h - 6 - ch;
  if (cy < 6) cy = 6;
  roundRect(ctx, cx, cy, cw, ch, 7);
  ctx.fillStyle = "rgba(10,16,22,0.82)";
  ctx.fill();
  ctx.strokeStyle = "rgba(120,214,235,0.45)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  for (let i = 0; i < lines.length; i++) {
    ctx.font = i === 0 ? "600 12px system-ui, sans-serif" : "12px system-ui, sans-serif";
    ctx.fillStyle = i === 0 ? "rgba(232,244,250,0.98)" : "rgba(176,206,218,0.9)";
    ctx.fillText(lines[i], cx + padX, cy + padY + i * lh);
  }
  ctx.restore();
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
