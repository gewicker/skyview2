// Planned-route reveal for the SELECTED aircraft only (never ambient): a dashed cyan great-circle
// from the aircraft's current position to its destination — the REMAINING path ahead of the glyph
// (the trail already owns where it's been), plus a ring at the destination. A deliberate cue that
// appears on tap and clears on deselect. Free: uses the destination coords we already enrich.
import type { Layer, FrameContext } from "./types";

const DEG = Math.PI / 180;

export class RouteLayer implements Layer {
  readonly name = "route";

  draw(f: FrameContext): void {
    const hex = f.selectedHex;
    if (!hex) return;
    const a = f.aircraft.find((x) => x.hex === hex);
    if (!a || a.destLat == null || a.destLon == null || a.lat == null || a.lon == null) return;

    const ctx = f.ctx;
    ctx.save();
    // Dashed great-circle ahead of the aircraft → destination.
    const pts = greatCircle(a.lat, a.lon, a.destLat, a.destLon, 48);
    ctx.setLineDash([7, 6]);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(91,184,255,0.45)";
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = f.cam.project(pts[i][0], pts[i][1]);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Destination ring (only if on/near screen).
    const d = f.cam.project(a.destLat, a.destLon);
    if (d.x > -60 && d.x < f.w + 60 && d.y > -60 && d.y < f.h + 60) {
      ctx.strokeStyle = "rgba(91,184,255,0.95)";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(d.x, d.y, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "rgba(91,184,255,0.95)";
      ctx.beginPath(); ctx.arc(d.x, d.y, 2, 0, Math.PI * 2); ctx.fill();
      if (a.destination) {
        ctx.font = "600 10px system-ui, sans-serif";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(8,12,18,0.85)";
        ctx.strokeText(a.destination, d.x + 9, d.y);
        ctx.fillStyle = "rgba(244,246,249,0.96)";
        ctx.fillText(a.destination, d.x + 9, d.y);
      }
    }
    ctx.restore();
  }
}

// Points along the great circle between two lat/lons (slerp on the sphere), so the planned path
// curves correctly over long legs instead of drawing a straight rhumb line on the projection.
function greatCircle(lat1: number, lon1: number, lat2: number, lon2: number, n: number): [number, number][] {
  const p1 = lat1 * DEG, l1 = lon1 * DEG, p2 = lat2 * DEG, l2 = lon2 * DEG;
  const dd = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (!(dd > 1e-9)) return [[lat1, lon1], [lat2, lon2]];
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const fr = i / n;
    const A = Math.sin((1 - fr) * dd) / Math.sin(dd), B = Math.sin(fr * dd) / Math.sin(dd);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    out.push([Math.atan2(z, Math.hypot(x, y)) / DEG, Math.atan2(y, x) / DEG]);
  }
  return out;
}
