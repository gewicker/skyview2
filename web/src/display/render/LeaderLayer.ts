// Velocity vector (the ATC "speed leader"): a line off the nose whose LENGTH is how far the
// aircraft travels in TPRED seconds — so a fast jet's vector visibly reaches much further ahead
// than a slow regional's, making speed readable at a glance without reading the number. Width +
// opacity also ramp with speed, and a small arrowhead marks the tip/heading. Drawn under the
// glyphs, gated on cfg.showRelative. Only when the aircraft transmits track + a real groundspeed.
import type { Layer, FrameContext } from "./types";
import { altRamp, hexRGB, type RGB } from "./colors";

const DEG = Math.PI / 180;
const KT_MS = 0.514444;
const TPRED = 45; // seconds of prediction; vector length = distance covered in this time

export class LeaderLayer implements Layer {
  readonly name = "leaders";

  draw(f: FrameContext): void {
    if (f.cfg.showTraffic === false) return; // master traffic toggle
    if (!f.cfg.showRelative || f.interacting) return;
    const ctx = f.ctx;
    const flat = hexRGB(f.cfg.palette.glyph || "#ff9a3c");
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const a of f.aircraft) {
      if (a.onGround || a.track == null || a.gs == null || a.gs < 40) continue; // no taxi vectors
      const distM = a.gs * KT_MS * TPRED;
      const br = a.track * DEG;
      const dLat = (distM * Math.cos(br)) / 110540;
      const dLon = (distM * Math.sin(br)) / (111320 * Math.cos(a.lat * DEG));
      const p0 = f.cam.project(a.lat, a.lon);
      const pe = f.cam.project(a.lat + dLat, a.lon + dLon); // projecting keeps direction correct under rotation
      const dx = pe.x - p0.x, dy = pe.y - p0.y;
      const len = Math.hypot(dx, dy) || 1;
      // Soft clamp the SCREEN length: full up to 120 px (so normal traffic spreads proportionally),
      // gently compressed beyond, hard max 170 — a hypersonic outlier can't streak across the panel.
      let L = len <= 120 ? len : 120 + (len - 120) * 0.25;
      if (L > 170) L = 170;
      const ux = dx / len, uy = dy / len;
      const p1 = { x: p0.x + ux * L, y: p0.y + uy * L };
      // Speed tier 0→1 across 60→420 kt drives width + opacity (length is the primary cue).
      const s = Math.max(0, Math.min(1, (a.gs - 60) / 360));
      const sel = a.hex === f.selectedHex;
      const rgb: RGB = f.cfg.altitudeColor ? altRamp(a.altBaro ?? 0) : flat;
      ctx.strokeStyle = `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},${(0.3 + 0.35 * s).toFixed(3)})`;
      ctx.lineWidth = 1.2 + 1.6 * s + (sel ? 0.6 : 0);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
      // Arrowhead at the tip — two short strokes back at ±28° from the heading.
      const dir = Math.atan2(uy, ux), AH = 6, a1 = dir + Math.PI - 28 * DEG, a2 = dir + Math.PI + 28 * DEG;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p1.x + Math.cos(a1) * AH, p1.y + Math.sin(a1) * AH);
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p1.x + Math.cos(a2) * AH, p1.y + Math.sin(a2) * AH);
      ctx.stroke();
    }
    ctx.restore();
  }
}
