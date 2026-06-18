// Live WA State Ferries as cool steel-blue markers gliding the Sound, each trailing a speed-scaled
// V-wake astern (length, spread, and flow-rate grow with speed). Real marine traffic — sits in the
// ground tier below aircraft, no additive glow / strobe (aircraft-only). Steel blue is clear of the rail jade, bus violet,
// aircraft cyan/amber, and the gold home beacon. Label-free until tapped.
import type { Layer, FrameContext } from "./types";
import { startLiveFerries, tickLiveFerries, liveFerries, ferryTerminals } from "./liveferries";

const HULL = "150,205,242";     // steel-cyan, nudged cooler+lighter off the teal water
const HULL_EDGE = "8,14,22";    // dark keyline so the boat separates from water by an edge, not hue alone

export class FerryLayer implements Layer {
  readonly name = "ferries";

  draw(f: FrameContext): void {
    if (!f.cfg.showFerries) return;
    startLiveFerries();
    tickLiveFerries(f.dt);
    const ctx = f.ctx, w = f.w, h = f.h;
    ctx.save();
    ctx.lineCap = "round";

    // Terminal anchors — subordinate dock markers (under the vessels). Small ringed squares so
    // they read as fixed infrastructure, not traffic. Drawn even when no vessel is underway.
    for (const t of ferryTerminals()) {
      const p = f.cam.project(t.lat, t.lon);
      if (p.x < -8 || p.x > w + 8 || p.y < -8 || p.y > h + 8) continue;
      ctx.fillStyle = `rgba(${HULL},0.20)`;
      ctx.strokeStyle = `rgba(${HULL},0.5)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(p.x - 2.6, p.y - 2.6, 5.2, 5.2);
      ctx.fill();
      ctx.stroke();
    }

    const ferries = liveFerries();
    const t = f.t;
    for (const v of ferries) {
      const p = f.cam.project(v.lat, v.lon);
      if (p.x < -28 || p.x > w + 28 || p.y < -28 || p.y > h + 28) continue;
      const a = v.fade;
      const ap = f.cam.project(v.alat, v.alon);
      const dx = p.x - ap.x, dy = p.y - ap.y;
      const moving = !v.atDock && dx * dx + dy * dy > 1.5; // heading derived from screen motion (rotation-proof)
      const ang = moving ? Math.atan2(dy, dx) : 0;
      const s01 = Math.min(1.2, Math.max(0, v.speed / 18)); // speed vs ~cruise (≈18 kt)

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(ang);

      // Speed-scaled V-wake astern: length + spread grow with speed, and the foam "flows" aft via an
      // animated dash offset whose rate also scales with speed — so a faster boat plainly reads as
      // faster. Calm by design (a slow scroll, no strobe). Drawn under the hull.
      if (moving && s01 > 0.05) {
        const len = 12 + 34 * s01;  // px of wake astern
        const spread = 3 + 5 * s01; // half-width of the V at its tail
        const stern = -8;
        ctx.lineCap = "round";
        ctx.lineWidth = 1.6;
        ctx.setLineDash([5, 5]);
        ctx.lineDashOffset = -((t * (20 + 60 * s01)) % 10); // flow aft, faster when faster
        for (const sgn of [-1, 1]) {
          const g = ctx.createLinearGradient(stern, 0, stern - len, sgn * spread);
          g.addColorStop(0, `rgba(228,240,250,${0.5 * a})`);
          g.addColorStop(1, "rgba(228,240,250,0)");
          ctx.strokeStyle = g;
          ctx.beginPath();
          ctx.moveTo(stern, 0);
          ctx.lineTo(stern - len, sgn * spread);
          ctx.stroke();
        }
        // soft centerline froth
        const cg = ctx.createLinearGradient(stern, 0, stern - len * 0.8, 0);
        cg.addColorStop(0, `rgba(228,240,250,${0.4 * a})`);
        cg.addColorStop(1, "rgba(228,240,250,0)");
        ctx.strokeStyle = cg;
        ctx.beginPath();
        ctx.moveTo(stern, 0);
        ctx.lineTo(stern - len * 0.8, 0);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }

      // soft halo (depth without glow) — wider so the boat reads at a glance across the Sound
      ctx.beginPath();
      ctx.arc(0, 0, 13, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${HULL},${0.22 * a})`;
      ctx.fill();

      // a boat HULL — pointed bow toward travel (flat-stern). ~1.3x larger than before for presence.
      ctx.beginPath();
      ctx.moveTo(10.5, 0);     // bow
      ctx.lineTo(2, -4.4);
      ctx.lineTo(-7.8, -3.6);  // stern
      ctx.lineTo(-7.8, 3.6);
      ctx.lineTo(2, 4.4);
      ctx.closePath();
      ctx.fillStyle = `rgba(${HULL},${0.98 * a})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${HULL_EDGE},${0.55 * a})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // bright deckhouse core — the "there's a boat here" point
      ctx.beginPath();
      ctx.arc(-0.5, 0, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(238,246,252,${0.99 * a})`;
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
}
