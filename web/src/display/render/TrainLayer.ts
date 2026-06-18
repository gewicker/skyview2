// Link trains on the map. Two sources, one layer:
//   • LIVE (preferred): real GPS positions from the OBA feed (livetrains.ts) — drawn as
//     a SOLID, full-saturation bead with a bright near-white core and a comet tail. The
//     measured core is what makes a live train read as "confirmed presence."
//   • SIMULATED (fallback): timetable-driven trains (trains.ts) — drawn as a HOLLOW,
//     ~35%-desaturated bead (a plausible guess, not a measurement). Shown only for a line
//     that has NO live train right now, so the moment the feed lights up a line, its
//     scheduled beads stand down and the real ones take over (reads as an upgrade).
// Both stay subordinate to aircraft; tinted by official line color (1 Line green / 2 Line
// blue). A dropping live train desaturates then fades (the feed's stale grammar).
import type { Layer, FrameContext } from "./types";
import { simTrains, nowMinLocal } from "./trains";
import { startLiveTrains, tickLiveTrains, liveTrains, liveLineSet } from "./livetrains";

// Official Link line colors (match the OBA route colors + the rider mental model).
const LINE_RGB: Record<string, [number, number, number]> = {
  "1": [40, 129, 63],  // 1 Line green (28813F)
  "2": [0, 124, 173],  // 2 Line blue  (007CAD)
};

type RGB3 = [number, number, number];

// Blend an rgb toward its luma (grey) by k (0..1).
function desat(rgb: RGB3, k: number): RGB3 {
  const [r, g, b] = rgb;
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  return [r + (y - r) * k, g + (y - g) * k, b + (y - b) * k];
}

function lerp3(a: RGB3, b: RGB3, t: number): RGB3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
const LATE_RGB: RGB3 = [255, 150, 90];   // running late → warm coral (earthier than aircraft amber)
const EARLY_RGB: RGB3 = [180, 210, 255]; // running early → cool ice

// Tint a train by its schedule deviation (seconds) — the system's punctuality as color temperature.
// A gentle tint (cap 50% toward the target) so it reads as warmth/coolness, never a category flip.
function lateTint(rgb: RGB3, devSec: number): RGB3 {
  const k = Math.max(-1, Math.min(1, devSec / 300)); // ±5 min = full
  if (k > 0) return lerp3(rgb, LATE_RGB, k * 0.5);
  if (k < 0) return lerp3(rgb, EARLY_RGB, -k * 0.5);
  return rgb;
}
const rgbStr = (c: [number, number, number]) => `${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])}`;

export class TrainLayer implements Layer {
  readonly name = "trains";

  draw(f: FrameContext): void {
    if (!f.cfg.showRail) return;              // trains ride with the rail toggle
    startLiveTrains();                        // idempotent — begin polling /api/rail
    tickLiveTrains(f.dt);                     // ease live positions toward the latest poll
    const ctx = f.ctx, w = f.w, h = f.h;
    const onScreen = (x: number, y: number) => x >= -20 && x <= w + 20 && y >= -20 && y <= h + 20;

    ctx.save();
    ctx.lineCap = "round";

    // --- LIVE trains: solid, full-saturation beads with a measured core ----------------- //
    const live = liveTrains();
    for (const t of live) {
      const p = f.cam.project(t.lat, t.lon);
      if (!onScreen(p.x, p.y)) continue;
      const baseRgb: RGB3 = LINE_RGB[t.line] ?? ([120, 160, 190] as RGB3);
      const c = desat(lateTint(baseRgb, t.devSec), (1 - t.fade) * 0.6); // lateness tint, then fade-grey
      const base = rgbStr(c);
      const a = t.fade;
      // comet tail from the lagging anchor
      const ap = f.cam.project(t.alat, t.alon);
      const grad = ctx.createLinearGradient(ap.x, ap.y, p.x, p.y);
      grad.addColorStop(0, `rgba(${base},0)`);
      grad.addColorStop(1, `rgba(${base},${0.55 * a})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(ap.x, ap.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      // soft glow
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${base},${0.22 * a})`;
      ctx.fill();
      // solid bead
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${base},${0.95 * a})`;
      ctx.fill();
      // bright measured core
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(232,246,255,${0.98 * a})`;
      ctx.fill();
    }

    // --- SIMULATED trains: hollow scheduled beads, only where there's no live coverage --- //
    const covered = liveLineSet();
    const sim = simTrains(nowMinLocal());
    for (const t of sim) {
      if (covered.has(t.line.id)) continue;   // live trains own this line right now
      const p = f.cam.project(t.lat, t.lon);
      if (!onScreen(p.x, p.y)) continue;
      const tp = f.cam.project(t.tlat, t.tlon);
      const base = rgbStr(desat(t.line.rgb, 0.35)); // scheduled => ~35% desaturated
      const grad = ctx.createLinearGradient(tp.x, tp.y, p.x, p.y);
      grad.addColorStop(0, `rgba(${base},0)`);
      grad.addColorStop(1, `rgba(${base},0.5)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tp.x, tp.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      // hollow ring (no filled core) marks "scheduled, not live"
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${base},0.75)`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    ctx.restore();
  }
}
