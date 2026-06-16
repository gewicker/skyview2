// Atmosphere: auto day/night dimming + golden-hour warm tint, driven by the real
// local sun altitude (sun.ts). A true terminator line is invisible across a ~22-mile
// local map (the whole area is day or night together), so the "terminator" here is a
// smooth full-field dim through twilight plus a warm wash when the sun is low.
//
// monitorMode acts as an override on top of the automatic curve:
//   day       — always bright (ignore auto night dim)
//   night     — auto dim, moderate night floor
//   lightsout — auto dim, deep night floor (default kiosk)
//   red       — red night-vision wash + dim
// cfg.brightness scales the whole thing. Drawn last, over everything.
import type { Layer, FrameContext } from "./types";
import { sunPosition, altAz, isLightsOut } from "./sun";

export class AtmosphereLayer implements Layer {
  readonly name = "atmosphere";
  private at = 0;
  private alt = 45; // cached sun altitude, deg
  private az = 180; // cached sun azimuth, deg
  private lightsOut = false;

  draw(f: FrameContext): void {
    // Recompute the sun every ~20 s (it moves ~0.08°/min).
    const wall = Date.now();
    if (wall - this.at > 20000) {
      this.at = wall;
      const date = new Date(wall + (f.cfg.skyTimeOffsetMin || 0) * 60000);
      const aa = altAz(sunPosition(date), f.cfg.centerLat, f.cfg.centerLon);
      this.alt = aa.alt;
      this.az = aa.az;
      this.lightsOut = isLightsOut(f.cfg.centerLat, f.cfg.centerLon, f.cfg.lightsOutHour ?? 23, date);
    }
    const ctx = f.ctx, w = f.w, h = f.h;
    const mode = f.cfg.monitorMode || "night";

    // Lights-out (bedtime→sunrise): a dim, warm "ember" night view — easy by a bed.
    // Multiply by amber to drop the blue light (melatonin/night-vision friendly, like
    // red but calmer), then dim hard so aircraft glow as faint embers over a near-black
    // map. Stays VISIBLE. A ceiling projector (if configured) additionally powers off.
    if (mode === "lightsout" && this.lightsOut) {
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = "rgba(255,96,28,1)";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
      const d = clamp(0.5 + (1 - clamp(f.cfg.brightness ?? 1, 0, 1)) * 0.42, 0.5, 0.9);
      ctx.fillStyle = `rgba(8,2,0,${d.toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      return;
    }

    // --- automatic dim from sun altitude --------------------------------- //
    // 1 at full day, 0 in deep night; smooth across twilight (+6° → −8°).
    const dayFrac = clamp((this.alt + 8) / 14, 0, 1);
    let dim: number;
    if (mode === "day") dim = 0;
    else {
      const nightFloor = mode === "lightsout" ? 0.82 : mode === "red" ? 0.7 : 0.55;
      dim = nightFloor * (1 - dayFrac);
    }
    // Manual brightness trims further (never brightens past auto).
    dim = clamp(dim + (1 - clamp(f.cfg.brightness ?? 1, 0, 1)) * 0.7, 0, 0.92);

    // --- golden-hour warm wash ------------------------------------------- //
    // Strongest as the sun crosses the horizon; fades out by ~8° up / ~6° down.
    const golden = this.alt < 8 && this.alt > -6 ? clamp(1 - Math.abs(this.alt) / 7, 0, 1) : 0;
    if (golden > 0 && mode !== "red") {
      ctx.save();
      ctx.globalCompositeOperation = "soft-light";
      // Bias the warmth toward the horizon where the sun sits (E at dawn, W at dusk).
      const fromEast = this.az < 180;
      const g = ctx.createLinearGradient(fromEast ? 0 : w, 0, fromEast ? w : 0, h);
      g.addColorStop(0, `rgba(255,150,60,${(0.5 * golden).toFixed(3)})`);
      g.addColorStop(0.6, `rgba(255,120,80,${(0.22 * golden).toFixed(3)})`);
      g.addColorStop(1, "rgba(120,90,140,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // --- dimming overlay -------------------------------------------------- //
    if (dim > 0.001) {
      ctx.save();
      // Cool deep-blue night, warmer at dusk so it doesn't read as a flat gray.
      const tint = golden > 0.2 ? "10,8,16" : "2,4,10";
      ctx.fillStyle = `rgba(${tint},${dim.toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // --- red night-vision wash ------------------------------------------- //
    if (mode === "red") {
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = "rgba(255,40,30,0.78)";
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
