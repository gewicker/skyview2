// Route-shape reveal for the SELECTED bus only (never ambient): a dashed line tracing the trip's
// actual road shape, with a dot at each terminus — the bus-equivalent of FerryRouteLayer/RouteLayer.
// Appears on tap, clears on deselect. Free: reuses the decoded polyline livebuses already builds for
// road-snap pacing (busShapePath), so there's no extra geometry. Only buses with a usable shape get a
// line; velocity-fallback buses (no shape) simply draw nothing (the bead + card still carry them).
import type { Layer, FrameContext } from "./types";
import { liveBuses, busShapePath } from "./livebuses";

const BUS = "150,130,235";   // periwinkle violet — matches the local-route bead
const RAPID = "224,96,86";   // RapidRide brand red — matches the branded bead

export class BusRouteLayer implements Layer {
  readonly name = "bus-route";

  draw(f: FrameContext): void {
    if (!f.cfg.showBuses) return;
    const id = f.selectedBusId;
    if (!id) return;
    const pts = busShapePath(id);
    if (!pts || pts.length < 2) return; // no usable shape for this bus
    const bus = liveBuses().find((b) => b.id === id);
    const col = bus?.rapidRide ? RAPID : BUS;

    const ctx = f.ctx;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // The full route shape as a faint dashed line, projected vertex-by-vertex (one selected route, so
    // the per-frame projection is cheap; no decimation needed).
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(${col},0.5)`;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = f.cam.project(pts[i].lat, pts[i].lon);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // A small filled dot at each terminus of the shape (only if on/near screen).
    this.terminus(f, pts[0], col);
    this.terminus(f, pts[pts.length - 1], col);
    ctx.restore();
  }

  private terminus(f: FrameContext, pt: { lat: number; lon: number }, col: string): void {
    const p = f.cam.project(pt.lat, pt.lon);
    if (p.x < -40 || p.x > f.w + 40 || p.y < -40 || p.y > f.h + 40) return;
    const ctx = f.ctx;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${col},0.9)`;
    ctx.fill();
  }
}
