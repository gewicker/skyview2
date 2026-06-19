// Live buses as small periwinkle-violet beads — real transit, so they sit just below trains and
// ABOVE the synthetic car/vessel wash (measured out-reads modeled), but well below aircraft (no
// additive glow, no strobe — those are aircraft-only). Violet is clear of the rail jade, the
// aircraft cyan/amber, the gold home beacon and the amber/magenta congestion ramp. Ambient: no
// labels until tapped. Capped to the nearest N and dimmed when zoomed way out so "all buses"
// stays calm instead of becoming a swarm.
import type { Layer, FrameContext } from "./types";
import { startLiveBuses, tickLiveBuses, liveBuses } from "./livebuses";
import { coreDim } from "./night";

const BUS = "150,130,235";    // periwinkle violet — regular Metro / ST routes
const RAPID = "224,96,86";    // RapidRide brand red — the frequent network reads apart from local buses
const WATERTAXI = "150,205,242"; // steel-cyan ferry hull — KC Water Taxi reads as marine, not road
const CAP = 50;               // max beads drawn per frame (nearest home wins) — trimmed for calm (design audit v5)

export class BusLayer implements Layer {
  readonly name = "buses";

  draw(f: FrameContext): void {
    if (!f.cfg.showBuses) return;
    startLiveBuses();
    tickLiveBuses(f.dt);
    let buses = liveBuses();
    if (!buses.length) return;

    // Cap to the nearest-to-home so a busy day doesn't swarm the map.
    if (buses.length > CAP) {
      const hx = f.cfg.centerLat, hy = f.cfg.centerLon;
      buses = buses
        .slice()
        .sort((a, b) => ((a.lat - hx) ** 2 + (a.lon - hy) ** 2) - ((b.lat - hx) ** 2 + (b.lon - hy) ** 2))
        .slice(0, CAP);
    }
    // Full strength at metro zoom (~1); dim toward 0.45 when zoomed way out so it doesn't pepper.
    const mz = f.view.mapZoom || 1;
    const zoomMul = Math.max(0.45, Math.min(1, 0.45 + 0.55 * ((mz - 0.6) / 0.4)));

    const ctx = f.ctx, w = f.w, h = f.h;
    ctx.save();
    ctx.lineCap = "round";
    for (const t of buses) {
      const p = f.cam.project(t.lat, t.lon);
      if (p.x < -15 || p.x > w + 15 || p.y < -15 || p.y > h + 15) continue;
      const a = t.fade * zoomMul;

      // King County Water Taxi: a small steel-cyan marine bead (rare; a simple distinct dot, no
      // road-bus chip/tail) so it reads as a vessel sitting apart from the violet/red road buses.
      if (t.waterTaxi) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${WATERTAXI},${0.16 * a})`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${WATERTAXI},${0.9 * a})`;
        ctx.fill();
        continue;
      }

      const col = t.rapidRide ? RAPID : BUS; // RapidRide branded red; local routes violet
      // short comet tail from the lagging anchor
      const ap = f.cam.project(t.alat, t.alon);
      const grad = ctx.createLinearGradient(ap.x, ap.y, p.x, p.y);
      grad.addColorStop(0, `rgba(${col},0)`);
      grad.addColorStop(1, `rgba(${col},${0.45 * a})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ap.x, ap.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      // soft halo (plain source-over — NO additive glow; that's aircraft-only)
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${col},${0.18 * a})`;
      ctx.fill();
      // a small bus CHIP oriented to heading (a stubby vehicle, not a dot) with a bright
      // windshield core at the front. Heading from screen motion; level when stopped.
      const dx = p.x - ap.x, dy = p.y - ap.y;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(dx * dx + dy * dy > 0.8 ? Math.atan2(dy, dx) : 0);
      ctx.fillStyle = `rgba(${col},${0.88 * a})`;
      ctx.fillRect(-2.2, -1.5, 4.4, 3.0);
      ctx.beginPath();
      ctx.arc(1.3, 0, 1.0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(238,234,255,${(0.95 * a * coreDim()).toFixed(3)})`;
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
}
