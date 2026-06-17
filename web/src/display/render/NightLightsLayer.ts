// Aviation-accurate night airport lighting for all nearby fields (KSEA/KBFI/KRNT/KPAE).
// Shown only when the sun is below the horizon and only at airport-scale zoom. Every lit
// runway end always shows its edge lights, a green threshold bar, and REIL strobes where
// installed; the runway END being landed on (aircraft on final) lights its real approach
// system — ALSF-2 / MALSR / MALSF — with the iconic sequenced "rabbit" running inbound,
// the 1000 ft decision bar, ALSF-2 red side rows, and centerline / touchdown-zone lights on
// the precision (SEA/PAE) runways. Per-end systems come from LIGHTING in airports.ts.
// Drawn beneath the atmosphere dimming wash so it stays subdued and never lights the room.
import type { Layer, FrameContext, Visible } from "./types";
import { AIRPORTS, LIGHTING, type ALSType } from "./airports";
import { sunAltitude } from "./sun";

const DEG = Math.PI / 180;
const MI = 1609.34;
const FT_PER_NM = 6076.12;
const SHOW_PXNM = 140; // px-per-nm threshold (airport-scale zoom)

type Pt = { x: number; y: number };

// Approach-light geometry per ALS type, in feet from the threshold along the approach:
// steady centerline bars, the 1000 ft decision crossbar, ALSF-2 red side rows, sequenced
// flashers ("rabbit", ordered inner→outer; lit outer-first so the pulse runs to the threshold).
interface ALSGeom { bars: number[]; decision: boolean; sideRows: number[]; flashers: number[] }
function alsGeom(t: ALSType): ALSGeom | null {
  switch (t) {
    case "ALSF2": return { bars: range(100, 2400, 100), decision: true, sideRows: range(100, 900, 100), flashers: range(1000, 2400, 100) };
    case "MALSR": return { bars: range(200, 1400, 200), decision: true, sideRows: [], flashers: [1600, 1800, 2000, 2200, 2400] };
    case "MALSF": return { bars: [200, 400, 600, 800], decision: false, sideRows: [], flashers: [1000, 1200, 1400] };
    case "MALS": return { bars: range(200, 1400, 200), decision: false, sideRows: [], flashers: [] };
    default: return null; // REIL / NONE — no approach bar system
  }
}
function range(a: number, b: number, step: number): number[] {
  const out: number[] = [];
  for (let v = a; v <= b + 0.001; v += step) out.push(v);
  return out;
}

export class NightLightsLayer implements Layer {
  readonly name = "night-lights";
  private sunAt = 0;
  private sunAlt = 90;

  draw(f: FrameContext): void {
    if (!f.cfg.showAirport) return;
    const wall = Date.now();
    if (wall - this.sunAt > 30000) {
      this.sunAt = wall;
      this.sunAlt = sunAltitude(f.cfg.centerLat, f.cfg.centerLon, new Date(wall + (f.cfg.skyTimeOffsetMin || 0) * 60000));
    }
    // Night factor (0 day → 1 night), smooth through twilight — fades the whole scene in.
    const nf = Math.max(0, Math.min(1, (3 - this.sunAlt) / 9));
    if (nf < 0.04) return;

    const perNM = pxPerNM(f);
    if (perNM < SHOW_PXNM) return; // only when the airport is large enough to read

    const ftToPx = perNM / FT_PER_NM;
    const ms = f.t * 1000;
    const { active, planes } = this.onFinal(f.aircraft);

    const ctx = f.ctx;
    ctx.save();
    ctx.globalAlpha = nf;                       // every lamp scales with the night factor
    ctx.globalCompositeOperation = "lighter";   // additive bloom (no shadowBlur on the Pi)

    for (const ap of AIRPORTS) {
      const lk = LIGHTING[ap.icao] || {};
      for (const rw of ap.runways) {
        const le = f.cam.project(rw.le[0], rw.le[1]);
        const he = f.cam.project(rw.he[0], rw.he[1]);
        if (offscreen(le, he, f)) continue;
        const halfW = Math.max(2, (rw.widthFt / FT_PER_NM) * perNM / 2);
        this.edges(ctx, le, he, halfW, lk[rw.leIdent]?.edge ?? "MIRL");
        this.end(ctx, le, he, halfW, lk[rw.leIdent], active.has(`${ap.icao}/${rw.leIdent}`), ftToPx, ms);
        this.end(ctx, he, le, halfW, lk[rw.heIdent], active.has(`${ap.icao}/${rw.heIdent}`), ftToPx, ms);
      }
    }

    // Warm landing-light glow on aircraft established on final.
    for (const p of planes) {
      const pp = f.cam.project(p.lat, p.lon);
      const g = ctx.createRadialGradient(pp.x, pp.y, 0, pp.x, pp.y, 15);
      g.addColorStop(0, "rgba(255,250,222,0.5)");
      g.addColorStop(1, "rgba(255,250,222,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(pp.x, pp.y, 15, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // Runway edge light strings down both sides (HIRL brighter than MIRL). Drawn once per runway.
  private edges(ctx: CanvasRenderingContext2D, A: Pt, B: Pt, halfW: number, edge: string): void {
    const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const hi = edge === "HIRL";
    const r = hi ? 1.4 : 1.1, al = hi ? 0.9 : 0.62;
    const col = `rgba(255,221,150,${al})`;
    const n = 22;
    for (let i = 0; i <= n; i++) {
      const cx = A.x + dx * (i / n), cy = A.y + dy * (i / n);
      dot(ctx, cx + nx * halfW, cy + ny * halfW, r, col);
      dot(ctx, cx - nx * halfW, cy - ny * halfW, r, col);
    }
  }

  // One runway end: green threshold bar + REIL always; full approach system when it's the
  // active landing end. `T` is this end's threshold, `F` the far end.
  private end(ctx: CanvasRenderingContext2D, T: Pt, F: Pt, halfW: number, lit: { als: ALSType; reil: boolean; centerline: boolean; tdz: boolean } | undefined, active: boolean, ftToPx: number, ms: number): void {
    if (!lit) return;
    const dx = F.x - T.x, dy = F.y - T.y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;          // runway direction (threshold → far)
    const ax = -ux, ay = -uy;                    // approach axis (outward from threshold)
    const lx = uy, ly = -ux;                     // lateral (perpendicular)
    const at = (along: number, lat: number): Pt => ({
      x: T.x + ax * along * ftToPx + lx * lat * ftToPx,
      y: T.y + ay * along * ftToPx + ly * lat * ftToPx,
    });

    // Green threshold bar (every lit end).
    for (let j = -3; j <= 3; j++) dot(ctx, T.x + lx * halfW * j / 3, T.y + ly * halfW * j / 3, 1.7, "rgba(40,255,120,0.9)");

    // REIL — two synchronized white strobes just outboard of the threshold corners, ~2 Hz in unison.
    if (lit.reil && (ms % 500) < 120) {
      const off = halfW + 4;
      dot(ctx, T.x + lx * off, T.y + ly * off, 3.0, "rgba(255,255,255,0.98)");
      dot(ctx, T.x - lx * off, T.y - ly * off, 3.0, "rgba(255,255,255,0.98)");
    }

    if (!active) return;

    const g = alsGeom(lit.als);
    if (g) {
      for (const along of g.bars) dot(ctx, at(along, 0).x, at(along, 0).y, 1.4, "rgba(255,250,235,0.85)");
      if (g.decision) for (let lat = -40; lat <= 40; lat += 10) { const p = at(1000, lat); dot(ctx, p.x, p.y, 1.5, "rgba(255,250,235,0.9)"); }
      for (const along of g.sideRows) { // ALSF-2 red side rows (inner 1000 ft), deliberately dim
        const p1 = at(along, 37.5), p2 = at(along, -37.5);
        dot(ctx, p1.x, p1.y, 1.2, "rgba(255,55,55,0.6)");
        dot(ctx, p2.x, p2.y, 1.2, "rgba(255,55,55,0.6)");
      }
      const N = g.flashers.length;
      if (N) {
        const phase = (ms % 500) / 500; // one inward sweep every 500 ms (~2 Hz)
        for (let k = 0; k < N; k++) {   // k = 0 is the OUTERMOST flasher → fires first
          const along = g.flashers[N - 1 - k];
          const lit2 = phase >= k / N && phase < k / N + 0.06;
          const p = at(along, 0);
          if (lit2) dot(ctx, p.x, p.y, 2.7, "rgba(255,255,255,0.97)");
        }
      }
    }

    // Centerline + touchdown-zone lights on the runway itself (precision ends), drawn back
    // from the threshold ONTO the pavement (negative-along), capped near the far end.
    if (lit.centerline || lit.tdz) {
      const maxPx = len * 0.6; // don't run past ~60% of the runway
      const step = 120 * ftToPx;
      const count = Math.min(28, Math.floor(maxPx / Math.max(1, step)));
      for (let i = 0; i < count; i++) {
        const onto = (i + 1) * 120;
        if (lit.centerline) { const p = at(-onto, 0); dot(ctx, p.x, p.y, 1.2, "rgba(245,248,255,0.7)"); }
        if (lit.tdz && i < 8) { // touchdown-zone bars flank the centerline near the threshold
          const a1 = at(-onto, 18), a2 = at(-onto, -18);
          dot(ctx, a1.x, a1.y, 1.0, "rgba(245,248,255,0.55)");
          dot(ctx, a2.x, a2.y, 1.0, "rgba(245,248,255,0.55)");
        }
      }
    }
  }

  // Active landing ends (aircraft low, aligned, inbound) + the planes on final (for the glow).
  private onFinal(aircraft: Visible[]): { active: Set<string>; planes: Visible[] } {
    const active = new Set<string>();
    const planes: Visible[] = [];
    for (const ap of AIRPORTS) {
      for (const rw of ap.runways) {
        const c = bearing(rw.le, rw.he);
        const ends = [
          { id: rw.leIdent, thr: rw.le, course: c },
          { id: rw.heIdent, thr: rw.he, course: (c + 180) % 360 },
        ];
        for (const e of ends) {
          const ux = Math.sin(e.course * DEG), uy = Math.cos(e.course * DEG);
          const cosLat = Math.cos(e.thr[0] * DEG);
          let hit = false;
          for (const a of aircraft) {
            if (a.onGround || a.altBaro == null || a.altBaro > 5000) continue;
            const east = (a.lon - e.thr[1]) * cosLat * 111320;
            const north = (a.lat - e.thr[0]) * 110540;
            const dist = -(east * ux + north * uy); // metres before the threshold
            if (dist < 150 || dist > 8 * MI) continue;
            if (Math.abs(east * uy - north * ux) > 0.5 * MI) continue; // lateral
            if (a.track != null && Math.abs(((a.track - e.course + 540) % 360) - 180) > 28) continue;
            hit = true;
            planes.push(a);
          }
          if (hit) active.add(`${ap.icao}/${e.id}`);
        }
      }
    }
    return { active, planes };
  }
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: string): void {
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// Both runway ends off the same side of the viewport (with margin) ⇒ skip the whole runway.
function offscreen(a: Pt, b: Pt, f: FrameContext): boolean {
  const m = 80;
  return (a.x < -m && b.x < -m) || (a.x > f.w + m && b.x > f.w + m) ||
    (a.y < -m && b.y < -m) || (a.y > f.h + m && b.y > f.h + m);
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
