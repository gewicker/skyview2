// Spotlight: auto-feature the nearest aircraft to the spotlight point (default:
// home), hold it briefly so it doesn't flicker, ring it, and show a compact placard
// with closest-point-of-approach anticipation (when/how near it'll pass). The
// signature SkyView touch.
import type { Layer, FrameContext, Visible } from "./types";
import { getPhoto } from "./photos";
import { sunPosition, altAz } from "./sun";

const DEG = Math.PI / 180;
const R_MI = 3958.8;
const KT_MS = 0.514444;
const HOLD_MS = 6000;
const RING_CYAN: [number, number, number] = [57, 194, 216];
const RING_GOLD: [number, number, number] = [255, 184, 92];

export class SpotlightLayer implements Layer {
  readonly name = "spotlight";
  private hex = "";
  private until = 0;
  private sunAt = 0;
  private sunAlt = 45;
  private golden = 0; // 0..1, peaks as the sun crosses the horizon

  // Recompute the golden-hour factor every ~20 s (sun moves slowly).
  private updateGolden(f: FrameContext): void {
    const wall = Date.now();
    if (wall - this.sunAt < 20000) return;
    this.sunAt = wall;
    const date = new Date(wall + (f.cfg.skyTimeOffsetMin || 0) * 60000);
    this.sunAlt = altAz(sunPosition(date), f.cfg.centerLat, f.cfg.centerLon).alt;
    this.golden = this.sunAlt < 8 && this.sunAlt > -6 ? clamp(1 - Math.abs(this.sunAlt) / 7, 0, 1) : 0;
  }

  private ring(a: number): string {
    const c = lerpRGB(RING_CYAN, RING_GOLD, this.golden);
    return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;
  }

  draw(f: FrameContext): void {
    this.updateGolden(f);
    const sLat = f.cfg.spotlightLat ?? f.cfg.centerLat;
    const sLon = f.cfg.spotlightLon ?? f.cfg.centerLon;
    const radius = f.cfg.spotlightRadiusMi || 15;

    // The trigger ring around home, labelled in NM — the card only appears for an
    // aircraft inside it, and clears once it leaves.
    if (f.cfg.showSpotlight) this.drawRing(f, sLat, sLon, radius);

    // A manual tap selection wins over the auto-feature (and works even when the
    // auto-spotlight is off), as long as the aircraft is still on screen.
    if (f.selectedHex) {
      const sel = f.aircraft.find((a) => a.hex === f.selectedHex);
      if (sel) {
        const ctx = f.ctx;
        const p = f.cam.project(sel.lat, sel.lon);
        const pulse = 0.5 + 0.5 * Math.sin(f.t * 3);
        ctx.save();
        ctx.strokeStyle = this.ring(0.45 + 0.4 * pulse);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 18 + 4 * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        // The rich tap card (DOM) owns the details for a tapped aircraft; we only
        // ring it here. The canvas placard is reserved for the auto-feature.
        return;
      }
    }

    // During golden hour, auto-feature even if the spotlight is otherwise off — it's
    // the prettiest light to catch an aircraft in.
    if (!f.cfg.showSpotlight && this.golden < 0.15) return;
    const now = f.t * 1000;

    // Nearest within radius.
    let best: Visible | null = null;
    let bestD = Infinity;
    for (const a of f.aircraft) {
      const d = distMiles(sLat, sLon, a.lat, a.lon);
      if (d <= radius && d < bestD) { bestD = d; best = a; }
    }

    // Hold the current target while it's still in range; otherwise adopt the nearest.
    const cur = this.hex ? f.aircraft.find((a) => a.hex === this.hex) ?? null : null;
    let target: Visible | null;
    if (cur && distMiles(sLat, sLon, cur.lat, cur.lon) <= radius && now < this.until) {
      target = cur;
    } else if (best) {
      target = best;
      this.hex = best.hex;
      this.until = now + HOLD_MS;
    } else {
      target = null;
      this.hex = "";
    }
    if (!target) return;

    const ctx = f.ctx;
    const p = f.cam.project(target.lat, target.lon);

    // Pulsing ring.
    const pulse = 0.5 + 0.5 * Math.sin(f.t * 3);
    ctx.save();
    ctx.strokeStyle = this.ring(0.35 + 0.4 * pulse);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 16 + 4 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    this.drawPlacard(f, target, sLat, sLon);
  }

  // The configurable trigger ring around the spotlight point (home), labelled in NM.
  private drawRing(f: FrameContext, sLat: number, sLon: number, radiusMi: number): void {
    const ctx = f.ctx;
    const c = f.cam.project(sLat, sLon);
    const n = f.cam.project(sLat + 1 / 69, sLon); // 1 statute mile north
    const pxPerMile = Math.hypot(n.x - c.x, n.y - c.y);
    if (!(pxPerMile > 0)) return;
    const r = radiusMi * pxPerMile;
    if (r < 14 || r > Math.hypot(f.w, f.h) * 1.2) return; // skip if too small / way off-screen
    ctx.save();
    ctx.strokeStyle = this.ring(0.26);
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 8]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    const nm = Math.round(radiusMi * 0.8689); // statute mi → nautical mi
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const ly = Math.max(16, Math.min(c.y - r - 4, f.h - 8)); // keep the label on-screen
    ctx.fillStyle = this.ring(0.66);
    ctx.fillText(`${nm} NM`, Math.max(24, Math.min(c.x, f.w - 24)), ly);
    ctx.restore();
  }

  private drawPlacard(f: FrameContext, a: Visible, sLat: number, sLon: number): void {
    const ctx = f.ctx;
    const d = distMiles(sLat, sLon, a.lat, a.lon);
    const brg = bearingDeg(sLat, sLon, a.lat, a.lon);
    const lines: string[] = [];
    lines.push(a.flight || a.registration || a.hex.toUpperCase());
    if (a.airline) lines.push(a.airline);
    const sub: string[] = [];
    if (a.typeName) sub.push(a.typeName);
    if (a.onGround) sub.push("on ground");
    else if (a.altBaro != null) sub.push(Math.round(a.altBaro).toLocaleString() + " ft");
    if (sub.length) lines.push(sub.join("  ·  "));
    // Vertical rate from the radio.
    const vr = vrateLabel(a);
    if (vr) lines.push(vr);
    // The ambient placard stays glanceable — autopilot intent / QNH / look-angle AND
    // the (adsbdb, crowd-sourced, unreliable) origin→destination route live on the tap
    // card instead. Keep just identity, altitude, distance, CPA here.
    lines.push(`${d.toFixed(1)} mi ${compass(brg)}`);
    const cpa = closestApproach(a, sLat, sLon);
    if (cpa && cpa.etaSec > 2 && cpa.etaSec < 600 && cpa.minMi < d) {
      lines.push(`closest ~${cpa.minMi.toFixed(1)} mi in ${Math.round(cpa.etaSec)}s`);
    }
    // Identity from the radio: squawk, tail number, ICAO type code.
    const id: string[] = [];
    if (a.squawk) id.push(`sqwk ${a.squawk}`);
    if (a.registration) id.push(a.registration);
    if (a.typeCode) id.push(a.typeCode);
    if (id.length) lines.push(id.join("  ·  "));

    const photo = getPhoto(a.hex, a.registration);
    ctx.save();
    ctx.font = "12px system-ui, sans-serif";
    ctx.textBaseline = "top";
    const padX = 12, padY = 10, lh = 17;
    let textW = 0;
    for (const l of lines) textW = Math.max(textW, ctx.measureText(l).width);

    const photoW = 240, photoH = 135;
    const w = Math.max(textW + padX * 2, photo ? photoW : 0);
    const photoBlock = photo ? photoH : 0;
    const h = photoBlock + lines.length * lh + padY * 2;
    const x = f.w - w - 18, y = 18; // top-right

    // Card + clip.
    ctx.save();
    roundRect(ctx, x, y, w, h, 8);
    ctx.clip();
    ctx.fillStyle = "rgba(8,12,18,0.72)";
    ctx.fillRect(x, y, w, h);
    if (photo) {
      const iw = photo.naturalWidth || photoW, ih = photo.naturalHeight || photoH;
      const s = Math.max(w / iw, photoH / ih);
      const dw = iw * s, dh = ih * s;
      ctx.drawImage(photo, x + (w - dw) / 2, y + (photoH - dh) / 2, dw, dh);
      ctx.fillStyle = "rgba(8,12,18,0.35)"; // tone the photo into the dark UI
      ctx.fillRect(x, y, w, photoH);
    }
    ctx.restore();

    // Border + text below the photo.
    ctx.strokeStyle = "rgba(57,194,216,0.5)";
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, w, h, 8);
    ctx.stroke();
    const ty = y + photoBlock + padY;
    for (let i = 0; i < lines.length; i++) {
      const cyan = lines[i].startsWith("closest");
      ctx.fillStyle = i === 0 ? "rgba(238,243,250,0.98)" : cyan ? "rgba(57,194,216,0.95)" : "rgba(196,205,219,0.85)";
      ctx.font = i === 0 || cyan ? "600 12px system-ui, sans-serif" : "12px system-ui, sans-serif";
      ctx.fillText(lines[i], x + padX, ty + i * lh);
    }
    ctx.restore();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function lerpRGB(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// Vertical rate as an arrow + ft/min, rounded to 100 fpm; "level" inside ±100.
function vrateLabel(a: Visible): string | null {
  if (a.onGround || a.baroRate == null) return null;
  const r = Math.round(a.baroRate / 100) * 100;
  if (Math.abs(r) < 100) return "level";
  return (r > 0 ? "↑ " : "↓ ") + Math.abs(r).toLocaleString() + " fpm";
}

function closestApproach(a: Visible, sLat: number, sLon: number): { minMi: number; etaSec: number } | null {
  if (a.gs == null || a.track == null) return null;
  const east = (a.lon - sLon) * Math.cos(sLat * DEG) * 111320;
  const north = (a.lat - sLat) * 110540;
  const spd = a.gs * KT_MS;
  const ve = spd * Math.sin(a.track * DEG);
  const vn = spd * Math.cos(a.track * DEG);
  const vv = ve * ve + vn * vn;
  if (vv <= 0) return null;
  const tc = -(east * ve + north * vn) / vv;
  if (tc <= 0) return null;
  const ce = east + ve * tc, cn = north + vn * tc;
  return { minMi: Math.hypot(ce, cn) / 1609.34, etaSec: tc };
}

function distMiles(la1: number, lo1: number, la2: number, lo2: number): number {
  const p1 = la1 * DEG, p2 = la2 * DEG;
  const dp = (la2 - la1) * DEG, dl = (lo2 - lo1) * DEG;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_MI * Math.asin(Math.min(1, Math.sqrt(x)));
}

function bearingDeg(la1: number, lo1: number, la2: number, lo2: number): number {
  const p1 = la1 * DEG, p2 = la2 * DEG, dl = (lo2 - lo1) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  let b = (Math.atan2(y, x) / DEG) % 360;
  if (b < 0) b += 360;
  return b;
}

function compass(deg: number): string {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
