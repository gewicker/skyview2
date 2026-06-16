// Heading ticks: a short line off the nose showing the radio-reported ground track.
// ONLY drawn when the aircraft actually transmits track + groundspeed (no track = no
// tick), and capped to a small on-screen length so it reads as a heading indicator,
// not a long predictor. Drawn under the glyphs. Gated on cfg.showRelative.
import type { Layer, FrameContext } from "./types";
import { altRamp, hexRGB, type RGB } from "./colors";

const DEG = Math.PI / 180;
const KT_MS = 0.514444;
const LEAD_SEC = 18;     // direction sample; length is capped below
const MAX_LEN_PX = 30;   // cap so even fast jets get a short tick, not a streak

export class LeaderLayer implements Layer {
  readonly name = "leaders";

  draw(f: FrameContext): void {
    if (!f.cfg.showRelative || f.interacting) return;
    const ctx = f.ctx;
    const flat = hexRGB(f.cfg.palette.glyph || "#ff9a3c");
    ctx.save();
    ctx.lineCap = "round";
    for (const a of f.aircraft) {
      // No radio track (or it's basically stationary) → no heading tick at all.
      if (a.onGround || a.track == null || a.gs == null || a.gs < 30) continue;
      const distM = a.gs * KT_MS * LEAD_SEC;
      const br = a.track * DEG;
      const dLat = (distM * Math.cos(br)) / 110540;
      const dLon = (distM * Math.sin(br)) / (111320 * Math.cos(a.lat * DEG));
      const p0 = f.cam.project(a.lat, a.lon);
      let p1 = f.cam.project(a.lat + dLat, a.lon + dLon);
      // Cap the on-screen length (projecting through the camera keeps the direction
      // correct under map rotation; we just shorten the magnitude).
      const dx = p1.x - p0.x, dy = p1.y - p0.y;
      const len = Math.hypot(dx, dy);
      if (len > MAX_LEN_PX) { const s = MAX_LEN_PX / len; p1 = { x: p0.x + dx * s, y: p0.y + dy * s }; }
      const rgb: RGB = f.cfg.altitudeColor ? altRamp(a.altBaro ?? 0) : flat;
      // Solid stroke (no per-frame gradient alloc) — it's a short tick, doesn't need a fade.
      ctx.strokeStyle = `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},0.45)`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    ctx.restore();
  }
}
