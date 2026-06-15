// Aircraft glyphs + labels. A directional dart per aircraft (rotated to track,
// altitude-coloured) with a compact multi-line label driven by cfg.showFields:
// callsign, type, altitude, speed, destination. (Type-accurate silhouettes come
// with the glyph dataset; collision-avoided label layout is a later pass.)
import type { Layer, FrameContext, Visible } from "./types";
import type { Config } from "@shared/types";

const DEG = Math.PI / 180;
const LINE_H = 13;

export class AircraftLayer implements Layer {
  readonly name = "aircraft";

  draw(f: FrameContext): void {
    const ctx = f.ctx;
    const size = (f.cfg.glyphSizePx ?? 18) * 0.6;
    ctx.save();
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "middle";

    for (const a of f.aircraft) {
      const p = f.cam.project(a.lat, a.lon);
      const color = f.cfg.altitudeColor ? altColor(a.altBaro) : (f.cfg.palette.glyph || "#ff9a3c");

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(((a.track ?? 0) + (f.cfg.mapRotationDeg ?? 0)) * DEG);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(size * 0.6, size * 0.75);
      ctx.lineTo(0, size * 0.35);
      ctx.lineTo(-size * 0.6, size * 0.75);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      const lines = labelLines(a, f.cfg);
      if (lines.length) drawLabel(ctx, lines, p.x + size + 6, p.y);
    }
    ctx.restore();

    // Home beacon.
    const home = f.cam.project(f.cfg.centerLat, f.cfg.centerLon);
    ctx.save();
    ctx.strokeStyle = f.cfg.palette.accent || "#39c2d8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(home.x, home.y, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawLabel(ctx: CanvasRenderingContext2D, lines: string[], x: number, cy: number): void {
  const n = lines.length;
  let maxW = 0;
  for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width);
  const top = cy - ((n - 1) * LINE_H) / 2;
  // Subtle plate for legibility over busy map.
  ctx.fillStyle = "rgba(6,10,16,0.5)";
  roundRect(ctx, x - 4, top - LINE_H / 2 - 1, maxW + 8, n * LINE_H + 2, 4);
  ctx.fill();
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i === 0 ? "rgba(236,241,248,0.96)" : "rgba(190,200,214,0.82)";
    ctx.fillText(lines[i], x, top + i * LINE_H);
  }
}

function labelLines(a: Visible, cfg: Config): string[] {
  const sf = cfg.showFields;
  const lines: string[] = [];
  const primary = sf.flight && a.flight ? a.flight : sf.registration && a.registration ? a.registration : "";
  if (primary) lines.push(primary);
  const parts: string[] = [];
  if (sf.type && a.typeName) parts.push(a.typeName);
  if (sf.altitude) {
    if (a.onGround) parts.push("GND");
    else if (a.altBaro != null) parts.push(Math.round(a.altBaro).toLocaleString() + " ft");
  }
  if (sf.speed && a.gs != null) parts.push(Math.round(a.gs) + " kt");
  if (parts.length) lines.push(parts.join("  ·  "));
  if (sf.destination && a.destination) lines.push("→ " + a.destination);
  return lines;
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

function altColor(alt?: number | null): string {
  if (alt == null) return "#9aa3b2";
  const t = Math.max(0, Math.min(1, alt / 40000));
  const r = Math.round(255 * (1 - t) + 90 * t);
  const g = Math.round(150 * (1 - t) + 170 * t);
  const b = Math.round(60 * (1 - t) + 255 * t);
  return `rgb(${r},${g},${b})`;
}
