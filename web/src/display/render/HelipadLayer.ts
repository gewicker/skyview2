// Hospital medevac heliports (HELIPADS): the real aeronautical "H"-in-circle heliport symbol with a
// small medical-cross badge, revealed as you zoom into the city. Subordinate ground furniture — drawn
// UNDER all traffic so the medevac helicopter parked on the pad stays the brighter, live element
// (brightness law). Calm: no animation, no additive glow; near-white passes through coreDim() at night.
import type { Layer, FrameContext } from "./types";
import { HELIPADS, type Helipad } from "./helipads";
import { coreDim } from "./night";

const SHOW_SYMBOL_PXMI = 120; // reveal the pad symbol once zoomed past the wide ambient view
const SHOW_LABEL_PXMI = 260;  // add the (short) name a little closer in
const FULL_NAME_PXMI = 560;   // full name only when zoomed right in on the block

const RING = "120,160,178"; // low-chroma cyan chart furniture (matches the seaplane anchor disc)
const MARK = "198,224,236"; // bright chart line for the "H"
const MED = "228,96,86";    // muted medical red for the cross badge (reads as hospital, off the aircraft palette)

export class HelipadLayer implements Layer {
  readonly name = "helipads";

  draw(f: FrameContext): void {
    const h0 = f.cam.project(f.cfg.centerLat, f.cfg.centerLon);
    const h1 = f.cam.project(f.cfg.centerLat + 1 / 69, f.cfg.centerLon);
    const pxPerMile = Math.hypot(h1.x - h0.x, h1.y - h0.y) || 1;
    if (pxPerMile < SHOW_SYMBOL_PXMI) return;
    const cd = coreDim();
    f.ctx.save();
    for (const hp of HELIPADS) this.drawPad(f, hp, pxPerMile, cd);
    f.ctx.restore();
  }

  private drawPad(f: FrameContext, hp: Helipad, pxPerMile: number, cd: number): void {
    const ctx = f.ctx;
    const p = f.cam.project(hp.lat, hp.lon);
    if (p.x < -40 || p.x > f.w + 40 || p.y < -40 || p.y > f.h + 40) return;
    ctx.save();
    ctx.translate(p.x, p.y);

    // Disc (chart furniture).
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(20,40,52,0.55)";
    ctx.fill();
    ctx.strokeStyle = `rgba(${RING},0.82)`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // "H" — the heliport symbol.
    ctx.strokeStyle = `rgba(${MARK},${(0.92 * cd).toFixed(3)})`;
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-2.6, -3.4); ctx.lineTo(-2.6, 3.4); // left post
    ctx.moveTo(2.6, -3.4); ctx.lineTo(2.6, 3.4);   // right post
    ctx.moveTo(-2.6, 0); ctx.lineTo(2.6, 0);       // crossbar
    ctx.stroke();

    // Medical-cross badge at the upper-right — marks it a hospital pad.
    ctx.save();
    ctx.translate(7.5, -7.5);
    ctx.fillStyle = `rgba(${MED},0.92)`;
    ctx.fillRect(-2.1, -0.7, 4.2, 1.4); // horizontal arm
    ctx.fillRect(-0.7, -2.1, 1.4, 4.2); // vertical arm
    ctx.restore();
    ctx.restore();

    // Name label, revealed in two steps so the default city view stays calm.
    if (pxPerMile > SHOW_LABEL_PXMI) {
      const label = pxPerMile > FULL_NAME_PXMI ? hp.name : hp.short;
      ctx.font = "600 10px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(8,12,18,0.85)";
      ctx.strokeText(label, p.x + 12, p.y);
      ctx.fillStyle = `rgba(214,230,240,${(0.9 * cd).toFixed(3)})`;
      ctx.fillText(label, p.x + 12, p.y);
    }
  }
}
