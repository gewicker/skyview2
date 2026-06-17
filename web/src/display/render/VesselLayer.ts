// Synthetic marine-vessel traffic on Puget Sound. Cool steel-cyan oriented HULLS (distinct
// from the warm aircraft glyphs and the round highway dots) gliding along bundled ferry +
// shipping lanes, with a faint additive wake. Ferries read pre-attentively as "the big boat"
// (1.3× + a warm bow light) and are the one vessel type that earns a name tag — the Sound's
// landmarks. Everything else is label-free ambient life. Vessels sit above the fog (opaque
// hull + dark edge keeps them legible inside a fog bank) and below the trails/aircraft, and
// the night dimming is applied globally by AtmosphereLayer. Off by default.
import type { Layer, FrameContext } from "./types";
import { LANES, lanePeriod, laneAt, type Lane } from "./vessels";

const HULL_L = 9;       // px, along course
const HULL_W = 3.5;     // px, beam
const MAX_FERRY_LABELS = 6;

export class VesselLayer implements Layer {
  readonly name = "vessel";

  draw(f: FrameContext): void {
    if (!f.cfg.showVessels) return;
    const intensity = f.cfg.vesselIntensity ?? 0.7;
    if (intensity < 0.02) return;
    const ambient = f.cfg.ambientMode !== false;
    const ctx = f.ctx;
    let ferryLabels = 0;

    for (const lane of LANES) {
      const period = lanePeriod(lane);
      if (period <= 0) continue;
      for (let k = 0; k < lane.count; k++) {
        const seed = (k + 0.5) / lane.count + lane.id.length * 0.137;
        let u: number, dir: number;
        if (lane.ferry) {
          const q = ((f.t / period + seed) % 2 + 2) % 2; // there-and-back
          u = q < 1 ? q : 2 - q;
          dir = q < 1 ? 1 : -1;
        } else {
          u = ((f.t / period + seed) % 1 + 1) % 1;        // one-way loop
          dir = 1;
        }
        const pos = laneAt(lane, u);
        const ahead = laneAt(lane, Math.max(0, Math.min(1, u + 0.02 * dir)));
        const p = f.cam.project(pos.lat, pos.lon);
        if (p.x < -20 || p.x > f.w + 20 || p.y < -20 || p.y > f.h + 20) continue;
        const pa = f.cam.project(ahead.lat, ahead.lon);
        const ang = Math.atan2(pa.y - p.y, pa.x - p.x);
        const labelThis = lane.ferry && lane.name &&
          (ambient ? ferryLabels < MAX_FERRY_LABELS : true);
        this.drawVessel(ctx, p.x, p.y, ang, lane, intensity, !!labelThis);
        if (labelThis) ferryLabels++;
      }
    }
  }

  private drawVessel(
    ctx: CanvasRenderingContext2D, x: number, y: number, ang: number,
    lane: Lane, intensity: number, label: boolean,
  ): void {
    const s = lane.ferry ? 1.3 : 1;
    const L = HULL_L * s, W = HULL_W * s;
    const hullA = Math.min(0.85, 0.85 * intensity);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);

    // Wake — short additive taper behind the stern, length tied to vessel class.
    const wake = (lane.ferry ? 16 : 12) * intensity;
    if (wake > 2) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.beginPath();
      ctx.moveTo(-L / 2, 0);
      ctx.lineTo(-L / 2 - wake, W * 0.45);
      ctx.lineTo(-L / 2 - wake, -W * 0.45);
      ctx.closePath();
      ctx.fillStyle = `rgba(150,200,220,${(0.10 * intensity).toFixed(3)})`;
      ctx.fill();
      ctx.restore();
    }

    // Hull — an elongated lozenge pointing along course (distinct from the aircraft chevron).
    ctx.beginPath();
    ctx.moveTo(L / 2, 0);     // bow
    ctx.lineTo(0, W / 2);     // port mid
    ctx.lineTo(-L / 2, 0);    // stern
    ctx.lineTo(0, -W / 2);    // starboard mid
    ctx.closePath();
    ctx.fillStyle = `rgba(120,180,205,${hullA.toFixed(3)})`;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0,0,0,0.4)"; // dark edge keeps it legible inside fog
    ctx.stroke();

    // Ferry bow light — warm dot so it reads as "the big boat" at a glance.
    if (lane.ferry) {
      ctx.beginPath();
      ctx.arc(L / 2, 0, 1.6, 0, 6.283);
      ctx.fillStyle = "rgba(255,200,120,0.9)";
      ctx.fill();
    }
    ctx.restore();

    // Name tag (unrotated) — ferries only, the Sound's landmarks.
    if (label) {
      ctx.save();
      ctx.font = "500 10px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const tx = x + 9, ty = y - 9;
      const tw = ctx.measureText(lane.name).width;
      ctx.fillStyle = "rgba(8,20,28,0.66)";
      roundRect(ctx, tx - 4, ty - 8, tw + 8, 16, 4);
      ctx.fill();
      ctx.fillStyle = "rgba(180,215,230,0.95)";
      ctx.fillText(lane.name, tx, ty);
      ctx.restore();
    }
  }
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
