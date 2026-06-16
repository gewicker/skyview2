// Airport overlay: GPS-accurate runway diagrams (width-true pavement, centerline,
// threshold "piano-key" markings, and runway designators) drawn at true position from
// the verified thresholds in airports.ts, plus optional extended approach centerlines.
// Taxiways/aprons aren't bundled (the satellite basemap shows those photographically);
// this complements the imagery and gives the dark/wire styles real runway shapes.
import type { Layer, FrameContext } from "./types";
import { AIRPORTS } from "./airports";

export class AirportsLayer implements Layer {
  readonly name = "airports";

  draw(f: FrameContext): void {
    if (!f.cfg.showAirport && !f.cfg.showApproaches) return;
    const ctx = f.ctx;
    // px per (statute) mile from the home reference — for runway width + approach length.
    const h0 = f.cam.project(f.cfg.centerLat, f.cfg.centerLon);
    const h1 = f.cam.project(f.cfg.centerLat + 1 / 69, f.cfg.centerLon);
    const pxPerMile = Math.hypot(h1.x - h0.x, h1.y - h0.y) || 1;

    ctx.save();
    ctx.lineCap = "butt";
    for (const ap of AIRPORTS) {
      for (const rw of ap.runways) {
        const a = f.cam.project(rw.le[0], rw.le[1]); // low-numbered threshold
        const b = f.cam.project(rw.he[0], rw.he[1]); // high-numbered threshold
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;   // along centerline (le→he)
        const nx = -uy, ny = ux;              // perpendicular (half-width direction)

        if (f.cfg.showApproaches) {
          const ext = 5 * pxPerMile; // ~5 mi final
          ctx.strokeStyle = "rgba(120,190,215,0.22)";
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 6]);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y); ctx.lineTo(a.x - ux * ext, a.y - uy * ext);
          ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + ux * ext, b.y + uy * ext);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        if (f.cfg.showAirport) {
          const halfW = Math.max(1.4, (rw.widthFt / 5280) * pxPerMile / 2);

          // Pavement (width-true rectangle) with a crisp edge.
          ctx.beginPath();
          ctx.moveTo(a.x + nx * halfW, a.y + ny * halfW);
          ctx.lineTo(b.x + nx * halfW, b.y + ny * halfW);
          ctx.lineTo(b.x - nx * halfW, b.y - ny * halfW);
          ctx.lineTo(a.x - nx * halfW, a.y - ny * halfW);
          ctx.closePath();
          ctx.fillStyle = "rgba(86,116,136,0.20)";
          ctx.fill();
          ctx.strokeStyle = "rgba(176,214,234,0.6)";
          ctx.lineWidth = 1;
          ctx.stroke();

          if (halfW > 2.4) {
            // Dashed centerline.
            ctx.save();
            ctx.setLineDash([Math.max(4, halfW * 1.2), Math.max(5, halfW * 1.4)]);
            ctx.strokeStyle = "rgba(236,243,249,0.5)";
            ctx.lineWidth = Math.max(0.8, halfW * 0.14);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            ctx.restore();
            // Threshold "piano keys" at each end.
            threshold(ctx, a, ux, uy, nx, ny, halfW);
            threshold(ctx, b, -ux, -uy, nx, ny, halfW);
          }
          if (halfW > 3.2) {
            // Runway designators, read along the landing direction, kept upright.
            const ang = Math.atan2(dy, dx);
            designator(ctx, a.x + ux * halfW * 3, a.y + uy * halfW * 3, ang, rw.leIdent, halfW);
            designator(ctx, b.x - ux * halfW * 3, b.y - uy * halfW * 3, ang + Math.PI, rw.heIdent, halfW);
          }
        }
      }
    }
    ctx.restore();
  }
}

// A few longitudinal stripes just inside a threshold (the "piano keys"). dx,dy points
// inward (threshold → runway centre); nx,ny is the across-width direction.
function threshold(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, dx: number, dy: number, nx: number, ny: number, halfW: number): void {
  ctx.strokeStyle = "rgba(245,250,255,0.7)";
  ctx.lineWidth = Math.max(0.8, halfW * 0.16);
  const slen = halfW * 1.0, inset = halfW * 0.3, gap = halfW * 0.5;
  for (let i = -2; i <= 2; i++) {
    const ox = nx * i * gap, oy = ny * i * gap;
    const sx = p.x + ox + dx * inset, sy = p.y + oy + dy * inset;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + dx * slen, sy + dy * slen);
    ctx.stroke();
  }
}

// Runway number, rotated along the centerline and flipped to stay legible on screen.
function designator(ctx: CanvasRenderingContext2D, x: number, y: number, readAng: number, text: string, halfW: number): void {
  let a = readAng;
  if (Math.cos(a) < -0.01) a += Math.PI; // keep upright (don't render mirrored/upside down)
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.font = `700 ${Math.round(Math.min(15, Math.max(9, halfW * 1.5)))}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(236,244,250,0.92)";
  ctx.strokeStyle = "rgba(8,16,24,0.55)";
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.strokeText(text, 0, 0);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}
