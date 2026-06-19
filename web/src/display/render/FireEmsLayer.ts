// Live Fire/EMS 911 incidents as SUBORDINATE ground markers — a place where something is happening,
// not a moving contact. Drawn in the ground tier (registered UNDER the vessel/car wash, transit, and
// aircraft) so a plane always paints on top; source-over only (no additive glow), no near-white core,
// a dark keyline to separate from the water, and severity-graded dimming so routine aid calls recede
// to a soft civic haze while only a genuine major incident gets a touch more presence. A one-time
// arrival ripple (suppressed at night), a slow breath on the single worst fire, and a 45-min fade.
// See docs/FIRE-EMS-DESIGN.md.
import type { Layer, FrameContext } from "./types";
import { startLiveFire, fireIncidents, LIFETIME_MIN, type Incident, type IncidentCat } from "./livefire";
import { coreDim, nightF } from "./night";

const CAP = 24;
const FADE_START_MIN = 30;
const ARRIVAL_CUE_S = 1.2;
const BREATH_HZ = 0.13;

// SYMBOL-led marker (docs/FIRE-EMS-ICONS.md): the colored disc demotes to a small backing DOT and a
// bold category SYMBOL (flame / cross / impact / bell) is the primary read — shape carries meaning,
// hue is CVD reinforcement. Smaller overall than before. `dot` = backing radius, `r` = outer halo,
// `sym` = symbol scale (half-height). Still source-over, no near-white core, drawn under all traffic.
const CAT: Record<IncidentCat, { rgb: string; core: number; ring: number; dot: number; r: number; sym: number; sev: number }> = {
  major:   { rgb: "226,120,78",  core: 0.50, ring: 0.92, dot: 5.5, r: 9.5, sym: 7.0, sev: 3000 }, // ember flame — the only category granted extra presence
  vehicle: { rgb: "212,168,104", core: 0.42, ring: 0.82, dot: 5.0, r: 9.0, sym: 6.0, sev: 200 },  // amber-tan impact mark
  medical: { rgb: "166,154,200", core: 0.38, ring: 0.78, dot: 5.0, r: 9.0, sym: 6.0, sev: 20 },   // mauve-grey cross (NOT red)
  alarm:   { rgb: "142,156,174", core: 0.30, ring: 0.60, dot: 4.5, r: 8.5, sym: 5.5, sev: 5 },    // grey-blue bell, dimmest
};

export class FireEmsLayer implements Layer {
  readonly name = "fire-ems";

  draw(f: FrameContext): void {
    if (!f.cfg.showFireEms) return;
    startLiveFire();
    let incs = fireIncidents();
    if (!incs.length) return;
    const ctx = f.ctx, w = f.w, h = f.h, now = Date.now();
    const hLat = f.cfg.centerLat, hLon = f.cfg.centerLon, cosH = Math.cos(hLat * Math.PI / 180);

    // Priority for the cap: severity, then recency, then proximity to home (BusLayer's nearest-home
    // logic extended with severity + age). Keep the highest-scoring CAP; drop the rest silently.
    const score = (i: Incident) => {
      const ageFrac = Math.min(1, (now - i.time) / 60000 / LIFETIME_MIN);
      const dx = (i.lon - hLon) * cosH, dy = i.lat - hLat;
      const distN = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 0.6); // ~normalised to ~40mi
      return CAT[i.cat].sev + (1 - ageFrac) * 100 + (1 - distN) * 10;
    };
    if (incs.length > CAP) incs = incs.slice().sort((a, b) => score(b) - score(a)).slice(0, CAP);

    // The single most-severe active fire gets the only motion (a slow breath) — and only by day.
    const muted = nightF() > 0.55;
    let topFire = "";
    let topScore = -1;
    for (const i of incs) if (i.cat === "major") { const s = score(i); if (s > topScore) { topScore = s; topFire = i.id; } }

    const mz = f.view.mapZoom || 1;
    const zoomMul = Math.max(0.5, Math.min(1, 0.5 + 0.5 * ((mz - 0.6) / 0.4)));
    const cm = coreDim();
    const nf = nightF();

    ctx.save();
    ctx.lineCap = "round";
    for (const inc of incs) {
      const p = f.cam.project(inc.lat, inc.lon);
      if (p.x < -16 || p.x > w + 16 || p.y < -16 || p.y > h + 16) continue;
      const c = CAT[inc.cat];
      const ageMin = (now - inc.firstSeen) / 60000; // time on screen (dispatch time lags ~30-60 min)
      // Lifetime fade: full for the first 30 min, smoothstep to 0 over the final 15.
      let life = 1;
      if (ageMin > FADE_START_MIN) { const u = Math.min(1, (ageMin - FADE_START_MIN) / (LIFETIME_MIN - FADE_START_MIN)); life = 1 - u * u * (3 - 2 * u); }
      const ageFrac = Math.min(1, ageMin / LIFETIME_MIN);
      const vis = life * (0.85 + 0.15 * (1 - ageFrac)) * zoomMul; // presence factor (recency reads as faint brightness)
      const dim = vis * cm; // hue elements also dim with the room at night
      if (dim <= 0.01) continue;
      const breath = (inc.id === topFire && !muted) ? 0.86 + 0.14 * Math.sin(f.t * 2 * Math.PI * BREATH_HZ) : 1;

      // Soft outer halo (source-over, never additive) — smaller now, just depth.
      const halo = ctx.createRadialGradient(p.x, p.y, c.dot * 0.5, p.x, p.y, c.r);
      halo.addColorStop(0, `rgba(${c.rgb},${(0.18 * c.core * dim * breath).toFixed(3)})`);
      halo.addColorStop(1, `rgba(${c.rgb},0)`);
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(p.x, p.y, c.r, 0, Math.PI * 2); ctx.fill();

      // Small solid backing dot — the plate the symbol sits on (NOT the primary read anymore).
      ctx.fillStyle = `rgba(${c.rgb},${(c.core * dim * breath).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, c.dot, 0, Math.PI * 2); ctx.fill();

      // Bold dark keyline on the dot edge — contrast, not brightness (gentle night floor).
      ctx.strokeStyle = `rgba(6,12,20,${(0.7 * vis * (0.85 + 0.15 * (1 - nf))).toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, c.dot, 0, Math.PI * 2); ctx.stroke();

      // Thin hue lip just outside the keyline — the crisp colored locus.
      ctx.strokeStyle = `rgba(${c.rgb},${(c.ring * dim * breath).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, c.dot + 1.3, 0, Math.PI * 2); ctx.stroke();

      // PRIMARY READ: the category SYMBOL on top of the dot (shape carries meaning; hue reinforces).
      drawSymbol(ctx, p.x, p.y, inc.cat, c.rgb, c.sym, Math.min(0.98, c.ring * dim + 0.14), vis);

      // One-time arrival ripple — a single raindrop, day only, for incidents that arrived AFTER the
      // initial backlog load (inc.cue). Tied to firstSeen, not dispatch time (the feed lags 30-60 min,
      // so a dispatch-age gate would never fire).
      if (f.cfg.fireEmsArrivalCue && !muted && inc.cue) {
        const since = (now - inc.firstSeen) / 1000;
        if (since >= 0 && since < ARRIVAL_CUE_S) {
          const u = since / ARRIVAL_CUE_S;
          ctx.strokeStyle = `rgba(${c.rgb},${(0.5 * (1 - u) * dim).toFixed(3)})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(p.x, p.y, c.r + u * c.r * 2.2, 0, Math.PI * 2); ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
}

// The category SYMBOL is the primary read (shape carries meaning, color reinforces). Each is drawn
// with a dark under-stroke/under-plate first so it survives the teal water by CONTRAST, then the hue
// pass — the same keyline law that saved the disc, now applied to the glyph. No white (the flame's
// faint ember tongue is the only lifted-light pixel). See docs/FIRE-EMS-ICONS.md.
function drawSymbol(ctx: CanvasRenderingContext2D, x: number, y: number, cat: IncidentCat, rgb: string, s: number, as: number, vis: number): void {
  const dark = `rgba(6,12,20,${(0.6 * vis).toFixed(3)})`;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (cat === "major") {
    flamePath(ctx, x, y, s);
    ctx.lineWidth = 1.6; ctx.strokeStyle = dark; ctx.stroke();
    ctx.fillStyle = `rgba(${rgb},${as.toFixed(3)})`; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y + s * 0.34, s * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,196,128,${(as * 0.55).toFixed(3)})`; ctx.fill(); // ember tongue (not white)
  } else if (cat === "medical") {
    const al = s * 0.85, aw = s * 0.3;
    ctx.fillStyle = dark;
    roundRect(ctx, x - aw - 0.8, y - al - 0.8, (aw + 0.8) * 2, (al + 0.8) * 2, aw * 0.6); ctx.fill();
    roundRect(ctx, x - al - 0.8, y - aw - 0.8, (al + 0.8) * 2, (aw + 0.8) * 2, aw * 0.6); ctx.fill();
    ctx.fillStyle = `rgba(${rgb},${as.toFixed(3)})`;
    roundRect(ctx, x - aw, y - al, aw * 2, al * 2, aw * 0.6); ctx.fill();
    roundRect(ctx, x - al, y - aw, al * 2, aw * 2, aw * 0.6); ctx.fill();
  } else if (cat === "vehicle") {
    impactPath(ctx, x, y, s);
    ctx.lineWidth = 3.0; ctx.strokeStyle = dark; ctx.stroke();
    impactPath(ctx, x, y, s);
    ctx.lineWidth = 1.8; ctx.strokeStyle = `rgba(${rgb},${as.toFixed(3)})`; ctx.stroke();
  } else { // alarm — bell
    bellPath(ctx, x, y, s);
    ctx.lineWidth = 1.6; ctx.strokeStyle = dark; ctx.stroke();
    ctx.fillStyle = `rgba(${rgb},${as.toFixed(3)})`; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y + s * 0.72, s * 0.22, 0, Math.PI * 2);
    ctx.strokeStyle = dark; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = `rgba(${rgb},${as.toFixed(3)})`; ctx.fill();
  }
  ctx.restore();
}

function flamePath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x + s * 0.78, y - s * 0.18, x + s * 0.52, y + s * 0.5);
  ctx.quadraticCurveTo(x + s * 0.4, y + s * 0.95, x, y + s * 0.95);
  ctx.quadraticCurveTo(x - s * 0.4, y + s * 0.95, x - s * 0.52, y + s * 0.4);
  ctx.quadraticCurveTo(x - s * 0.52, y, x - s * 0.13, y - s * 0.36);
  ctx.quadraticCurveTo(x, y, x, y - s);
  ctx.closePath();
}

function impactPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x - s * 0.9, y + s * 0.5);
  ctx.lineTo(x, y - s * 0.2);
  ctx.lineTo(x + s * 0.9, y + s * 0.5);
  ctx.moveTo(x, y - s * 0.45); ctx.lineTo(x, y - s * 0.95);
  ctx.moveTo(x - s * 0.4, y - s * 0.45); ctx.lineTo(x - s * 0.62, y - s * 0.85);
  ctx.moveTo(x + s * 0.4, y - s * 0.45); ctx.lineTo(x + s * 0.62, y - s * 0.85);
}

function bellPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x - s * 0.62, y + s * 0.45);
  ctx.quadraticCurveTo(x - s * 0.62, y - s * 0.5, x, y - s * 0.7);
  ctx.quadraticCurveTo(x + s * 0.62, y - s * 0.5, x + s * 0.62, y + s * 0.45);
  ctx.lineTo(x - s * 0.62, y + s * 0.45);
  ctx.closePath();
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
