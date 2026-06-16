// Night airport lighting (shown only when the sun is below the horizon, and only at
// airport-scale zoom): on the runway end(s) with arriving traffic, warm edge-light strings,
// a green threshold bar + red far-end bar, and the iconic sequenced approach "rabbit"
// strobing inbound — plus a soft landing-light glow on aircraft established on final.
// Drawn beneath the atmosphere dimming wash, so at night/lights-out it stays subdued and
// never lights the room. Active-runway only (keyed off real arriving traffic).
import type { Layer, FrameContext, Visible } from "./types";
import { AIRPORTS } from "./airports";
import { sunAltitude } from "./sun";

const DEG = Math.PI / 180;
const MI = 1609.34;
const SHOW_PXNM = 140; // px-per-nm threshold (airport-scale zoom)

interface ActiveEnd {
  thr: [number, number]; // landing threshold (near)
  far: [number, number]; // opposite end
  course: number;        // landing course, deg
  widthFt: number;
  planes: Visible[];      // aircraft established on final to this end
}

export class NightLightsLayer implements Layer {
  readonly name = "night-lights";
  private sunAt = 0;
  private sunAlt = 90;

  draw(f: FrameContext): void {
    if (!f.cfg.showAirport) return;
    // Night gate — recompute the sun altitude every ~30 s.
    const wall = Date.now();
    if (wall - this.sunAt > 30000) {
      this.sunAt = wall;
      this.sunAlt = sunAltitude(f.cfg.centerLat, f.cfg.centerLon, new Date(wall + (f.cfg.skyTimeOffsetMin || 0) * 60000));
    }
    // Night factor (0 day → 1 night), smooth through twilight — fades the runway/approach
    // lights in at dusk and out at dawn instead of a hard switch.
    const nf = Math.max(0, Math.min(1, (3 - this.sunAlt) / 9));
    if (nf < 0.04) return; // full daylight

    const perNM = pxPerNM(f);
    if (perNM < SHOW_PXNM) return; // only when the airport is large enough to read

    const active = this.activeEnds(f.aircraft);
    if (!active.length) return;

    const ctx = f.ctx;
    ctx.save();
    ctx.globalAlpha = nf; // additive lights scale with the night factor
    ctx.globalCompositeOperation = "lighter";
    for (const e of active) this.drawEnd(f, ctx, e, perNM);
    ctx.restore();
  }

  // Runway ends with an aircraft on final (low, aligned, inbound) — the active landing ends.
  private activeEnds(aircraft: Visible[]): ActiveEnd[] {
    const out: ActiveEnd[] = [];
    for (const ap of AIRPORTS) {
      for (const rw of ap.runways) {
        const c = bearing(rw.le, rw.he);
        const ends = [
          { thr: rw.le, far: rw.he, course: c },
          { thr: rw.he, far: rw.le, course: (c + 180) % 360 },
        ];
        for (const e of ends) {
          const ux = Math.sin(e.course * DEG), uy = Math.cos(e.course * DEG);
          const cosLat = Math.cos(e.thr[0] * DEG);
          const planes: Visible[] = [];
          for (const a of aircraft) {
            if (a.onGround || a.altBaro == null || a.altBaro > 5000) continue;
            const east = (a.lon - e.thr[1]) * cosLat * 111320;
            const north = (a.lat - e.thr[0]) * 110540;
            const dist = -(east * ux + north * uy); // metres before the threshold
            if (dist < 150 || dist > 8 * MI) continue;
            if (Math.abs(east * uy - north * ux) > 0.5 * MI) continue; // lateral
            if (a.track != null && Math.abs(((a.track - e.course + 540) % 360) - 180) > 28) continue;
            planes.push(a);
          }
          if (planes.length) out.push({ thr: e.thr, far: e.far, course: e.course, widthFt: rw.widthFt, planes });
        }
      }
    }
    return out;
  }

  private drawEnd(f: FrameContext, ctx: CanvasRenderingContext2D, e: ActiveEnd, perNM: number): void {
    const a = f.cam.project(e.thr[0], e.thr[1]); // landing threshold
    const b = f.cam.project(e.far[0], e.far[1]); // far end
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    const halfW = Math.max(2, (e.widthFt / 6076) * perNM / 2);

    // Edge lights — warm strings down both sides.
    const n = 22;
    for (let i = 0; i <= n; i++) {
      const cx = a.x + dx * (i / n), cy = a.y + dy * (i / n);
      dot(ctx, cx + nx * halfW, cy + ny * halfW, 1.3, "rgba(255,221,150,0.85)");
      dot(ctx, cx - nx * halfW, cy - ny * halfW, 1.3, "rgba(255,221,150,0.85)");
    }
    // Threshold (green) at the landing end; runway-end (red) at the far end.
    for (let j = -3; j <= 3; j++) {
      dot(ctx, a.x + nx * halfW * j / 3, a.y + ny * halfW * j / 3, 1.7, "rgba(90,255,150,0.9)");
      dot(ctx, b.x + nx * halfW * j / 3, b.y + ny * halfW * j / 3, 1.7, "rgba(255,85,72,0.9)");
    }

    // Approach "rabbit": flashers stepping out from the threshold, one pulse travelling IN.
    const RAB = 14, stepNM = 0.06;
    const phase = Math.floor((f.t * 18) % RAB); // ~1.3 sequences/sec
    for (let i = 1; i <= RAB; i++) {
      const d = i * stepNM * perNM;
      const cx = a.x - ux * d, cy = a.y - uy * d; // outward along the approach
      const lit = RAB - i === phase;              // pulse moves toward the threshold
      dot(ctx, cx, cy, lit ? 2.7 : 1.3, lit ? "rgba(255,255,255,0.95)" : "rgba(210,228,255,0.16)");
    }

    // Aircraft landing-light glow on final.
    for (const p of e.planes) {
      const pp = f.cam.project(p.lat, p.lon);
      const g = ctx.createRadialGradient(pp.x, pp.y, 0, pp.x, pp.y, 15);
      g.addColorStop(0, "rgba(255,250,222,0.5)");
      g.addColorStop(1, "rgba(255,250,222,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(pp.x, pp.y, 15, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: string): void {
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function pxPerNM(f: FrameContext): number {
  const a = f.cam.project(f.cfg.centerLat, f.cfg.centerLon);
  const n = f.cam.project(f.cfg.centerLat + 1 / 60, f.cfg.centerLon); // ~1 NM north
  return Math.hypot(n.x - a.x, n.y - a.y);
}

function bearing(le: readonly [number, number], he: readonly [number, number]): number {
  const p1 = le[0] * DEG, p2 = he[0] * DEG, dl = (he[1] - le[1]) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / DEG) % 360 + 360) % 360;
}
