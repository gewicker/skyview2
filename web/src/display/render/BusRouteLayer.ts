// Route reveal for the SELECTED bus only (never ambient): the road AHEAD — the slice of the trip
// shape from the bus to its destination terminus — drawn as a tapered, directionally-FLOWING line
// that ends in a named stop. The bus-space twin of the aircraft RouteLayer (which draws the path
// ahead to the destination, never the whole flown route). See docs/BUS-ROUTE-DESIGN.md.
//
// Three coordinated pieces:
//   • a dark underglow so the line lifts off the ambient car-wash on shared downtown corridors;
//   • a flowing dashed line, BRIGHT at the bus → DIM at the destination (a gradient taper), with the
//     dashes marching toward the destination at the bus's live estimated speed — so a bus stuck in
//     traffic visibly crawls and a moving bus streams (a free, live congestion read). Frozen during
//     gestures (perf, matches the bead tails);
//   • a destination ring + the headsign label (the same text the tap card shows).
// Buses with no road-snapped shape (velocity fallback) get no line — busAhead returns null.
import type { Layer, FrameContext } from "./types";
import { liveBuses, busAhead } from "./livebuses";
import { coreDim } from "./night";

const BUS = "150,130,235";   // periwinkle violet — matches the local-route bead
const RAPID = "224,96,86";   // RapidRide brand red — matches the branded bead
const DASH = 20;             // dash period (px) — wrap the flow phase to this multiple

export class BusRouteLayer implements Layer {
  readonly name = "bus-route";
  private phase = 0; // marching-dash offset (px), advanced by the bus's speed, frozen mid-gesture

  draw(f: FrameContext): void {
    if (!f.cfg.showBuses) return;
    const id = f.selectedBusId;
    if (!id) return;
    const ahead = busAhead(id);
    if (!ahead || ahead.pts.length < 2) return;
    const bus = liveBuses().find((b) => b.id === id);
    const col = bus?.rapidRide ? RAPID : BUS;

    // Project the ahead-path once.
    const pp = ahead.pts.map((p) => f.cam.project(p.lat, p.lon));
    const a = pp[0], z = pp[pp.length - 1];

    const ctx = f.ctx;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(pp[0].x, pp[0].y);
      for (let i = 1; i < pp.length; i++) ctx.lineTo(pp[i].x, pp[i].y);
    };

    // (1) Dark underglow — corridor lift (separates the bright core from the ambient wash beneath).
    ctx.strokeStyle = "rgba(8,12,18,0.5)";
    ctx.lineWidth = 4;
    trace();
    ctx.stroke();

    // (2) Flowing, tapered line: gradient bright→dim along the path; dashes march to the destination
    // at the bus's live speed (px/s ∝ sVel, capped). Stopped bus → still dashes (the congestion cue).
    const pxPerSec = Math.min(40, Math.max(0, ahead.sVel) * 1.6);
    if (!f.interacting) this.phase = (this.phase + pxPerSec * Math.max(0, f.dt)) % DASH;
    // Gradient bright-at-bus → dim-at-destination. When the endpoints coincide on screen (bus at its
    // terminus, or sub-pixel when zoomed way out) a zero-length gradient renders as the LAST stop
    // (dim) — so fall back to a flat bright stroke instead (bug scrub v6 P2-1).
    if (Math.hypot(z.x - a.x, z.y - a.y) < 1) {
      ctx.strokeStyle = `rgba(${col},0.7)`;
    } else {
      const grad = ctx.createLinearGradient(a.x, a.y, z.x, z.y);
      grad.addColorStop(0, `rgba(${col},0.7)`);
      grad.addColorStop(1, `rgba(${col},0.22)`);
      ctx.strokeStyle = grad;
    }
    ctx.lineWidth = 2.5;
    ctx.setLineDash([10, 10]);
    ctx.lineDashOffset = -this.phase; // negative → dashes travel bus → destination
    trace();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    // (3) Destination terminus + headsign label (only if on/near screen).
    if (z.x > -60 && z.x < f.w + 60 && z.y > -60 && z.y < f.h + 60) {
      ctx.strokeStyle = `rgba(${col},0.95)`;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(z.x, z.y, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(${col},0.95)`;
      ctx.beginPath(); ctx.arc(z.x, z.y, 2, 0, Math.PI * 2); ctx.fill();
      const label = bus?.headsign ? `→ ${bus.headsign}` : "";
      if (label) {
        ctx.font = "600 10px system-ui, sans-serif";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(8,12,18,0.85)";
        ctx.strokeText(label, z.x + 9, z.y);
        ctx.fillStyle = `rgba(238,242,251,${(0.96 * coreDim()).toFixed(3)})`;
        ctx.fillText(label, z.x + 9, z.y);
      }
    }
    ctx.restore();
  }
}
