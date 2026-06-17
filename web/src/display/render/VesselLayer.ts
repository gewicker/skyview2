// Synthetic marine-vessel traffic on Puget Sound. Cool steel-cyan oriented HULLS (distinct
// from the warm aircraft glyphs and the round highway dots) gliding along bundled ferry +
// shipping lanes, with a faint additive wake. Ferries read pre-attentively as "the big boat"
// (1.3× + a warm bow light) and are the one vessel type that earns a name tag — the Sound's
// landmarks. Everything else is label-free ambient life. Vessels sit above the fog (opaque
// hull + dark edge keeps them legible inside a fog bank) and below the trails/aircraft, and
// the night dimming is applied globally by AtmosphereLayer. Off by default.
import type { Layer, FrameContext } from "./types";
import { LANES, lanePeriod, laneAt, type Lane } from "./vessels";
import { shade, softContactShadow } from "./aircraftGlyph";
import type { RGB } from "./colors";

const HULL_L = 9;       // px, along course (bow at +x in glyph frame)
const HULL_W = 3.5;     // px, beam
const HULL: RGB = [120, 180, 205]; // steel cyan — the water family
const MAX_FERRY_LABELS = 6;
const col = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

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
    ctx.rotate(ang); // bow (+x) points along travel

    // Contact shadow — same recipe as aircraft/cars, hull footprint (long axis +x). Seats
    // the hull on the water, rhyming with the plane's shadow on the ground.
    softContactShadow(ctx, L / 2, W / 2);

    // Wake — a faint additive bow-wave V (port + starboard divergence), length by class.
    const wake = (lane.ferry ? 16 : 12) * intensity;
    if (wake > 2) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `rgba(150,200,220,${(0.12 * intensity).toFixed(3)})`;
      ctx.lineWidth = 0.8;
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-L / 2, sgn * W * 0.1);
        ctx.lineTo(-L / 2 - wake, sgn * W * 0.55);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Hull — elongated lozenge with the shared lateral top-left gradient (lit steel body),
    // not a flat fill. Lateral axis is y (perpendicular to course).
    ctx.save();
    ctx.globalAlpha = hullA;
    const g = ctx.createLinearGradient(0, -W / 2, 0, W / 2);
    g.addColorStop(0, col(shade(HULL, -0.3), 1));
    g.addColorStop(0.32, col(shade(HULL, 0.34), 1));
    g.addColorStop(0.58, col(shade(HULL, 0.1), 1));
    g.addColorStop(1, col(shade(HULL, -0.42), 1));
    ctx.beginPath();
    ctx.moveTo(L / 2, 0);     // bow
    ctx.lineTo(0, W / 2);     // port mid
    ctx.lineTo(-L / 2, 0);    // stern
    ctx.lineTo(0, -W / 2);    // starboard mid
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0,0,0,0.4)"; // dark edge keeps it legible inside fog
    ctx.stroke();

    // Bridge superstructure — a bright painted block aft of midships: gives an unambiguous
    // bow/stern read and the vessel's "windshield-band" equivalent.
    ctx.fillStyle = col(shade(HULL, 0.5), 0.7);
    roundRect(ctx, -L * 0.34, -W * 0.26, L * 0.22, W * 0.52, 0.6 * s);
    ctx.fill();

    // Specular glint (bridge highlight) — identical treatment to the aircraft crown.
    ctx.fillStyle = col(shade(HULL, 0.82), 0.6);
    ctx.beginPath();
    ctx.arc(-L * 0.18, -W * 0.12, 0.16 * W + 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Ferry bow light — warm dot (the vessel's one warm accent, dimmer than any aircraft lamp).
    if (lane.ferry) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.beginPath();
      ctx.arc(L / 2, 0, 1.6, 0, 6.283);
      ctx.fillStyle = "rgba(255,200,120,0.9)";
      ctx.fill();
      ctx.restore();
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
