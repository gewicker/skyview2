// Live WA State Ferries as cool steel-blue markers gliding the Sound, each trailing a soft white
// wake (from the lagging anchor). Real marine traffic — sits in the ground tier below aircraft, no
// additive glow / strobe (aircraft-only). Steel blue is clear of the rail jade, bus violet,
// aircraft cyan/amber, and the gold home beacon. Label-free until tapped.
import type { Layer, FrameContext } from "./types";
import { startLiveFerries, tickLiveFerries, liveFerries, ferryTerminals } from "./liveferries";

const HULL = "140,195,235"; // brighter steel-cyan so it stands off the teal water

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
    for (const v of ferries) {
      const p = f.cam.project(v.lat, v.lon);
      if (p.x < -16 || p.x > w + 16 || p.y < -16 || p.y > h + 16) continue;
      const a = v.fade;
      const ap = f.cam.project(v.alat, v.alon);
      const dx = p.x - ap.x, dy = p.y - ap.y;
      const moving = !v.atDock && dx * dx + dy * dy > 1.5; // heading derived from screen motion (rotation-proof)
      const ang = moving ? Math.atan2(dy, dx) : 0;
      // wake from the lagging anchor (only underway)
      if (moving) {
        const grad = ctx.createLinearGradient(ap.x, ap.y, p.x, p.y);
        grad.addColorStop(0, "rgba(225,238,248,0)");
        grad.addColorStop(1, `rgba(225,238,248,${0.45 * a})`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(ap.x, ap.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      // soft halo (depth without glow)
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${HULL},${0.2 * a})`;
      ctx.fill();
      // a boat HULL — pointed bow toward travel (flat-stern; oriented from motion, level when docked)
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(8, 0);       // bow
      ctx.lineTo(1.5, -3.4);
      ctx.lineTo(-6, -2.8);   // stern
      ctx.lineTo(-6, 2.8);
      ctx.lineTo(1.5, 3.4);
      ctx.closePath();
      ctx.fillStyle = `rgba(${HULL},${0.95 * a})`;
      ctx.fill();
      // bright deckhouse core — the "there's a boat here" point
      ctx.beginPath();
      ctx.arc(-0.5, 0, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(238,246,252,${0.98 * a})`;
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
}
