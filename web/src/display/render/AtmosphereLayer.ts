// Atmosphere: auto day/night dimming + golden-hour warm tint, driven by the real
// local sun altitude (sun.ts). A true terminator line is invisible across a ~22-mile
// local map (the whole area is day or night together), so the "terminator" here is a
// smooth full-field dim through twilight plus a warm wash when the sun is low.
//
// monitorMode acts as an override on top of the automatic curve:
//   day       — always bright (ignore auto night dim)
//   night     — auto dim, moderate night floor (gradual by sun)
//   lightsout — LIVELY all evening (a conversation piece), then a dim, VISIBLE red
//               night view (v1-style) from the bedtime hour until sunrise. A manual
//               "mute now" (cfg.muteUntil) brings it forward; auto-clears at sunrise.
//   red       — visible red night-vision wash, always on
// cfg.brightness scales the whole thing. Drawn last, over everything.
import type { Layer, FrameContext } from "./types";
import { sunPosition, altAz, isLightsOut } from "./sun";

export class AtmosphereLayer implements Layer {
  readonly name = "atmosphere";
  private at = 0;
  private alt = 45; // cached sun altitude, deg
  private az = 180; // cached sun azimuth, deg
  private lightsOut = false;
  private grad: CanvasGradient | null = null; // cached golden-hour gradient
  private gradKey = "";

  draw(f: FrameContext): void {
    // Exception: when an aircraft is tapped, suspend ALL dimming/red so the contact and
    // its card show in full colour — even during the bedtime/red night. Returns to the
    // night look automatically once it's deselected (or despawns off-screen).
    if (f.selectedHex) return;

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
    // Mute now: manual override (button) — forces the night view immediately, but only
    // while it's actually dark, so it auto-clears at sunrise regardless of the timer.
    const manualMute = (f.cfg.muteUntil ?? 0) > wall && this.alt < 0;
    // Visible red night-vision view (v1-style) — stays READABLE by a bed, not black.
    // Used for the manual "red" mode and for the lights-out night/mute window.
    if (mode === "red" || (mode === "lightsout" && (this.lightsOut || manualMute))) {
      redNight(ctx, w, h);
      return;
    }

    // --- automatic dim from sun altitude --------------------------------- //
    // 1 at full day, 0 in deep night; smooth across twilight (+6° → −8°).
    const dayFrac = clamp((this.alt + 8) / 14, 0, 1);
    let dim: number;
    // Lights-out stays fully LIVELY all evening (it mutes via the amber block above at
    // bedtime, not gradually) — only "night" mode dims gradually by the sun.
    if (mode === "day" || mode === "lightsout") dim = 0;
    // Only "night" reaches here (day/lightsout = 0 above; red/lights-out returned early).
    else dim = 0.55 * (1 - dayFrac);
    // Manual brightness trims further (never brightens past auto).
    dim = clamp(dim + (1 - clamp(f.cfg.brightness ?? 1, 0, 1)) * 0.7, 0, 0.92);

    // --- golden-hour warm wash ------------------------------------------- //
    // Strongest as the sun crosses the horizon; fades out by ~8° up / ~6° down.
    const golden = this.alt < 8 && this.alt > -6 ? clamp(1 - Math.abs(this.alt) / 7, 0, 1) : 0;
    if (golden > 0) {
      // Bias the warmth toward the horizon where the sun sits (E at dawn, W at dusk).
      const fromEast = this.az < 180;
      // Cache the gradient — golden only changes every ~20 s, so rebuilding it per frame
      // (createLinearGradient + 3 stops on the top full-screen layer) was pure waste.
      const key = `${w}|${h}|${fromEast}|${golden.toFixed(2)}`;
      if (key !== this.gradKey || !this.grad) {
        const g = ctx.createLinearGradient(fromEast ? 0 : w, 0, fromEast ? w : 0, h);
        g.addColorStop(0, `rgba(255,150,60,${(0.5 * golden).toFixed(3)})`);
        g.addColorStop(0.6, `rgba(255,120,80,${(0.22 * golden).toFixed(3)})`);
        g.addColorStop(1, "rgba(120,90,140,0)");
        this.grad = g;
        this.gradKey = key;
      }
      ctx.save();
      ctx.globalCompositeOperation = "soft-light";
      ctx.fillStyle = this.grad;
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

  }
}

// Visible red night-vision wash (v1-style): multiply to red (drops blue/green light)
// then a LIGHT dim so aircraft + the airport glow stay clearly readable by a bed. The
// brightness slider trims further. Deliberately not near-black.
function redNight(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save();
  // After-bedtime view: multiply to red (keeps red luminance so aircraft still glow),
  // then a FIXED moderate dim — dark enough not to light the room, but planes/airport
  // glow stay visible. Independent of the day Brightness slider so the vibrant evening
  // isn't affected. (Tune the 0.5 if it needs to be darker/lighter.)
  ctx.globalCompositeOperation = "multiply";
  // Red night-vision tint (keeps red luminance so planes glow).
  ctx.fillStyle = "rgba(255,95,68,1)";
  ctx.fillRect(0, 0, w, h);
  // Darken by MULTIPLY (not a flat black blend) so contrast is preserved — the map goes
  // near-black while bright aircraft/airport glow stay punchy. Doesn't light the room.
  ctx.fillStyle = "rgba(120,120,120,1)";
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
