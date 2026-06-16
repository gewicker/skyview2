// Aircraft layer: a type-accurate silhouette per aircraft (rotated to track,
// altitude-coloured via the rich ramp, spinning props/rotors) with a compact
// multi-line label, and the home beacon. Ground traffic is deliberately subdued and
// shrunk so a busy airport reads as one glowing mass (overlapping additive halos)
// rather than a clutter of bright glyphs + labels.
import type { Layer, FrameContext, Visible } from "./types";
import type { Config } from "@shared/types";
import { classifyGlyph, GLYPH_SCALE, drawGlyphSpinners, hasSpinners } from "./aircraftGlyph";
import { getGlyphSprite } from "./glyphCache";
import { altRamp, hexRGB, type RGB } from "./colors";
import { AIRPORTS } from "./airports";

const DEG = Math.PI / 180;
const LINE_H = 14;
const GROUND_RGB: RGB = [200, 122, 60]; // subdued warm — ground/apron

// Reference point (runway-threshold centroid) + IATA for each local field. ADS-B
// never transmits destination; the callsign→route DB (adsbdb) gives the scheduled
// route, which is frequently the wrong leg for an arrival. A low, descending aircraft
// within a few miles of a local field is physically landing there — we trust that.
const LOCAL_FIELDS = AIRPORTS.map((ap) => {
  let la = 0, lo = 0, n = 0;
  for (const rw of ap.runways) { la += rw.le[0] + rw.he[0]; lo += rw.le[1] + rw.he[1]; n += 2; }
  return { iata: ap.iata, lat: la / n, lon: lo / n };
});

// Nearest local field within `maxMi`, or null. Shared by the arrival/departure tests.
function nearestLocalField(a: Visible, maxMi: number): string | null {
  let best = Infinity, iata: string | null = null;
  for (const fld of LOCAL_FIELDS) {
    const cos = Math.cos(fld.lat * DEG);
    const d = Math.hypot((a.lat - fld.lat) * 69, (a.lon - fld.lon) * 69 * cos);
    if (d < best) { best = d; iata = fld.iata; }
  }
  return best <= maxMi ? iata : null; // statute miles
}

// Low + clearly descending + close to a local field ⇒ physically landing there.
function arrivingLocal(a: Visible): string | null {
  if (a.onGround || a.altBaro == null || a.altBaro > 5000) return null;
  if (a.baroRate == null || a.baroRate > -200) return null; // must be clearly descending
  return nearestLocalField(a, 7);
}

// Low + clearly climbing + close to a local field ⇒ just departed there. Used only to
// catch the bogus "→ SEA" the route DB shows for a SEA departure (you don't fly to the
// field you just left); we suppress the destination rather than assert a wrong one.
function departingLocal(a: Visible): string | null {
  if (a.onGround || a.altBaro == null || a.altBaro > 10000) return null;
  if (a.baroRate == null || a.baroRate < 200) return null; // must be clearly climbing
  return nearestLocalField(a, 6);
}

export class AircraftLayer implements Layer {
  readonly name = "aircraft";

  draw(f: FrameContext): void {
    const ctx = f.ctx;
    // Airborne aircraft read larger (0.75×) so they stand out on a small panel; ground
    // traffic is drawn as crisp little chevrons/dots (see drawGroundMarker) so a busy
    // ramp reads as distinct aircraft instead of one orange blob.
    const base = (f.cfg.glyphSizePx ?? 18) * 0.75;
    ctx.save();
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.textBaseline = "middle";

    const jobs: LabelJob[] = [];
    for (const a of f.aircraft) {
      const ground = !!a.onGround;
      const p = f.cam.project(a.lat, a.lon);
      const kind = classifyGlyph(a);
      const full = base * GLYPH_SCALE[kind];
      const glyphS = ground ? full * 0.5 : full;       // small footprint on the ground
      const glowS = ground ? full * 0.85 : full;        // glow stays sized so clusters merge
      const alpha = ground ? 0.42 : 1;                  // dim individually; sum into a mass
      const rgb: RGB = !f.cfg.altitudeColor
        ? hexRGB(f.cfg.palette.glyph || "#ff9a3c")
        : ground ? GROUND_RGB : altRamp(a.altBaro ?? 0);

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(((a.track ?? 0) + (f.cfg.mapRotationDeg ?? 0)) * DEG);
      if (ground) {
        // Crisp heading-aware chevron (taxiing) or a small dot (parked) — no additive
        // glow, so individual surface aircraft stay distinct instead of blurring together.
        drawGroundMarker(ctx, base, a.gs ?? 0, a.hex === f.selectedHex);
      } else {
        if (!f.interacting) {
          ctx.globalCompositeOperation = "lighter";
          ctx.fillStyle = `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},0.09)`;
          ctx.beginPath();
          ctx.arc(0, 0, glowS * 2.0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},0.13)`;
          ctx.beginPath();
          ctx.arc(0, 0, glowS * 1.15, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalCompositeOperation = "source-over";
        }
        const sprite = getGlyphSprite(kind, rgb, alpha, glyphS, f.dpr);
        ctx.drawImage(sprite.canvas, -sprite.half, -sprite.half, sprite.half * 2, sprite.half * 2);
        if (hasSpinners(kind)) drawGlyphSpinners(ctx, kind, glyphS, rgb, alpha, f.t, seedFor(a.hex));
      }
      ctx.restore();

      // Labels: airborne always; ground only when explicitly selected (declutters airports).
      // Collected now, then density-limited + decluttered + drawn in one pass below.
      if (!ground || a.hex === f.selectedHex) {
        const lines = labelLines(a, f.cfg);
        if (lines.length) {
          let w = 0;
          for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
          const dist = (a.lat - f.cfg.centerLat) ** 2 + (a.lon - f.cfg.centerLon) ** 2;
          jobs.push({
            hex: a.hex, lines, ax: p.x + glyphS + 8, ay: p.y, drawY: p.y,
            w: w + 8, h: lines.length * LINE_H + 2, dist,
          });
        }
      }
    }

    drawLabels(ctx, jobs, f);
    ctx.restore();

    // Home beacon (respects the Home toggle). Gold so it stands out from the cyan UI
    // accents and the altitude-coloured traffic.
    if (!f.cfg.showHome) return;
    const home = f.cam.project(f.cfg.centerLat, f.cfg.centerLon);
    const accent = "#ffc83c";
    const pulse = 0.5 + 0.5 * Math.sin(f.t * 2.2);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(255,200,70,0.22)";
    ctx.beginPath();
    ctx.arc(home.x, home.y, 13 + 3 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(home.x, home.y, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(home.x, home.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(223,231,242,0.92)";
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("HOME", home.x, home.y - 16);
    ctx.textAlign = "left";
    ctx.restore();
  }
}

interface LabelJob {
  hex: string; lines: string[]; ax: number; ay: number; drawY: number;
  w: number; h: number; dist: number;
}

// Pick which aircraft get labels (by density), then push overlapping label boxes
// apart vertically so a busy arrival bank stays readable. A thin leader connects a
// label back to its glyph when it had to be nudged.
function drawLabels(ctx: CanvasRenderingContext2D, jobs: LabelJob[], f: FrameContext): void {
  if (!jobs.length) return;
  const dens = f.cfg.labelDensity;
  let chosen = jobs;
  if (dens !== "all") {
    const n = dens === "nearestOnly" ? 1 : Math.max(1, f.cfg.nearestN ?? 8);
    chosen = [...jobs].sort((a, b) => a.dist - b.dist).slice(0, n);
    if (f.selectedHex && !chosen.some((j) => j.hex === f.selectedHex)) {
      const sel = jobs.find((j) => j.hex === f.selectedHex);
      if (sel) chosen.push(sel);
    }
  }

  // Greedy vertical separation: process top→down, push each below any it overlaps.
  chosen.sort((a, b) => a.drawY - b.drawY);
  for (let i = 0; i < chosen.length; i++) {
    for (let k = 0; k < i; k++) {
      const A = chosen[i], B = chosen[k];
      const dx = Math.abs(A.ax - B.ax);
      if (dx < Math.max(A.w, B.w) && Math.abs(A.drawY - B.drawY) < (A.h + B.h) / 2 + 3) {
        A.drawY = B.drawY + (B.h + A.h) / 2 + 3;
      }
    }
  }

  for (const j of chosen) {
    if (Math.abs(j.drawY - j.ay) > 2) {
      ctx.strokeStyle = "rgba(150,165,185,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(j.ax - 2, j.ay);
      ctx.lineTo(j.ax, j.drawY);
      ctx.stroke();
    }
    drawLabel(ctx, j.lines, j.ax, j.drawY, j.w - 8);
  }
}

function drawLabel(ctx: CanvasRenderingContext2D, lines: string[], x: number, cy: number, maxW: number): void {
  const n = lines.length;
  const top = cy - ((n - 1) * LINE_H) / 2;
  // Soft translucent slate plate (not pure black) with a hairline border. The
  // per-line dark outline below carries the contrast, so the box can stay light.
  roundRect(ctx, x - 5, top - LINE_H / 2 - 2, maxW + 10, n * LINE_H + 4, 5);
  ctx.fillStyle = "rgba(26,34,48,0.5)";
  ctx.fill();
  ctx.strokeStyle = "rgba(160,178,200,0.22)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.lineJoin = "round";
  for (let i = 0; i < n; i++) {
    const y = top + i * LINE_H;
    // Cheap dark outline (no shadowBlur — too slow on the Pi) so text stays crisp.
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.strokeText(lines[i], x, y);
    ctx.fillStyle = i === 0 ? "rgba(242,246,251,0.99)" : "rgba(208,217,228,0.93)";
    ctx.fillText(lines[i], x, y);
  }
}

function labelLines(a: Visible, cfg: Config): string[] {
  const sf = cfg.showFields;
  const lines: string[] = [];
  const primary = sf.flight && a.flight ? a.flight : sf.registration && a.registration ? a.registration : "";
  if (primary) lines.push(primary);
  const parts: string[] = [];
  if (sf.type && a.typeName) parts.push(a.typeName);
  // Compact vertical-rate arrow (climb/descent) shown on every airborne label.
  const arrow = !a.onGround && a.baroRate != null ? (a.baroRate >= 150 ? " ↑" : a.baroRate <= -150 ? " ↓" : "") : "";
  if (sf.altitude) {
    if (a.onGround) parts.push("GND");
    else if (a.altBaro != null) parts.push(Math.round(a.altBaro).toLocaleString() + " ft" + arrow);
  } else if (arrow) {
    parts.push(arrow.trim());
  }
  if (sf.speed && a.gs != null) parts.push(Math.round(a.gs) + " kt");
  if (parts.length) lines.push(parts.join("  ·  "));
  if (sf.destination) {
    // Physical reality beats the unreliable route DB. If it's landing at a local field,
    // say so. Otherwise show the route destination — unless that destination is the very
    // field it's departing (a bogus "→ SEA" on a SEA climb-out), in which case suppress.
    const arr = arrivingLocal(a);
    if (arr) lines.push("→ " + arr);
    else if (a.destination && a.destination !== departingLocal(a)) lines.push("→ " + a.destination);
  }
  return lines;
}

// Ground traffic marker, drawn in the already-rotated frame so "up" (−y) is the
// aircraft's track. A taxiing aircraft gets a crisp directional chevron; a parked one
// (≈stationary) a small dot. Muted amber + a thin dark edge keeps each one legible on
// the bright apron without the old additive-glow blob.
function drawGroundMarker(ctx: CanvasRenderingContext2D, base: number, gs: number, sel: boolean): void {
  const fill = sel ? "rgba(255,201,120,0.98)" : "rgba(212,150,86,0.95)";
  ctx.lineJoin = "round";
  if (gs >= 3) {
    const r = Math.max(4.5, base * 0.42), w = r * 0.7;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(w, r * 0.72);
    ctx.lineTo(0, r * 0.28);
    ctx.lineTo(-w, r * 0.72);
    ctx.closePath();
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = fill;
    ctx.fill();
  } else {
    const r = Math.max(2.4, base * 0.22);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (sel) {
    ctx.strokeStyle = "rgba(255,210,120,0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, (gs >= 3 ? base * 0.42 : base * 0.22) + 5, 0, Math.PI * 2);
    ctx.stroke();
  }
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

function seedFor(hex: string): number {
  let s = 0;
  for (let i = 0; i < hex.length; i++) s = (s + hex.charCodeAt(i)) % 628;
  return s / 100;
}
