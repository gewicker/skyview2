// Aircraft layer: a type-accurate silhouette per aircraft (rotated to track,
// altitude-coloured, spinning props/rotors) with a compact multi-line label driven
// by cfg.showFields, and the home beacon.
import type { Layer, FrameContext, Visible } from "./types";
import type { Config } from "@shared/types";
import { classifyGlyph, GLYPH_SCALE, drawAircraftGlyph } from "./aircraftGlyph";

const DEG = Math.PI / 180;
const LINE_H = 13;

export class AircraftLayer implements Layer {
  readonly name = "aircraft";

  draw(f: FrameContext): void {
    const ctx = f.ctx;
    const base = (f.cfg.glyphSizePx ?? 18) * 0.5;
    ctx.save();
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "middle";

    for (const a of f.aircraft) {
      const p = f.cam.project(a.lat, a.lon);
      const kind = classifyGlyph(a);
      const s = base * GLYPH_SCALE[kind];
      const rgb = f.cfg.altitudeColor ? altRGB(a.altBaro) : hexRGB(f.cfg.palette.glyph || "#ff9a3c");

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(((a.track ?? 0) + (f.cfg.mapRotationDeg ?? 0)) * DEG);
      // Luminous halo: two additive discs (cheap, no per-frame gradient) so each
      // plane glows like neon — v1's "living art" look. Skipped during a gesture.
      if (!f.interacting) {
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},0.09)`;
        ctx.beginPath();
        ctx.arc(0, 0, s * 2.0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},0.13)`;
        ctx.beginPath();
        ctx.arc(0, 0, s * 1.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
      }
      drawAircraftGlyph(ctx, kind, s, rgb, 1, f.t, seedFor(a.hex));
      ctx.restore();

      const lines = labelLines(a, f.cfg);
      if (lines.length) drawLabel(ctx, lines, p.x + s + 8, p.y);
    }
    ctx.restore();

    // Home beacon: a glowing, pulsing marker labelled HOME.
    const home = f.cam.project(f.cfg.centerLat, f.cfg.centerLon);
    const accent = f.cfg.palette.accent || "#39c2d8";
    const pulse = 0.5 + 0.5 * Math.sin(f.t * 2.2);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(57,194,216,0.18)";
    ctx.beginPath();
    ctx.arc(home.x, home.y, 13 + 3 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(home.x, home.y, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(home.x, home.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(223,231,242,0.92)";
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("HOME", home.x, home.y - 16);
    ctx.textAlign = "left";
    ctx.restore();
  }
}

function drawLabel(ctx: CanvasRenderingContext2D, lines: string[], x: number, cy: number): void {
  const n = lines.length;
  let maxW = 0;
  for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width);
  const top = cy - ((n - 1) * LINE_H) / 2;
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

function altRGB(alt?: number | null): [number, number, number] {
  if (alt == null) return [154, 163, 178];
  const t = Math.max(0, Math.min(1, alt / 40000));
  return [Math.round(255 * (1 - t) + 90 * t), Math.round(150 * (1 - t) + 170 * t), Math.round(60 * (1 - t) + 255 * t)];
}

function hexRGB(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 154, 60];
}

function seedFor(hex: string): number {
  let s = 0;
  for (let i = 0; i < hex.length; i++) s = (s + hex.charCodeAt(i)) % 628;
  return s / 100;
}
