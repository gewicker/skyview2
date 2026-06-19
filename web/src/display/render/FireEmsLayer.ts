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

// One restrained, low-chroma family, clear of every other semantic hue (see palette doc).
// Presence comes from a SOLID disc + a bold dark keyline (contrast on teal), not from alpha on a
// soft cloud (the design-consult lesson, docs/FIRE-EMS-VISIBILITY.md). `core` = flat disc alpha,
// `ring` = hue lip alpha, `disc` = solid radius, `r` = outer halo radius. Still source-over, no
// near-white core, drawn under all traffic — so the eye goes to aircraft first.
const CAT: Record<IncidentCat, { rgb: string; core: number; ring: number; disc: number; r: number; sev: number }> = {
  major:   { rgb: "224,116,76",  core: 0.62, ring: 0.95, disc: 8, r: 12, sev: 3000 }, // ember — the only category granted extra presence
  vehicle: { rgb: "210,166,100", core: 0.50, ring: 0.85, disc: 7, r: 11, sev: 200 },  // earthy amber-tan
  medical: { rgb: "162,150,196", core: 0.42, ring: 0.80, disc: 7, r: 11, sev: 20 },   // mauve-grey (NOT red — no scanner feel)
  alarm:   { rgb: "138,152,170", core: 0.32, ring: 0.62, disc: 6, r: 10, sev: 5 },    // grey-blue, the dimmest
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

      // Soft outer halo (source-over, never additive) — a gentle lift off the basemap.
      const halo = ctx.createRadialGradient(p.x, p.y, c.disc * 0.5, p.x, p.y, c.r);
      halo.addColorStop(0, `rgba(${c.rgb},${(0.22 * c.core * dim * breath).toFixed(3)})`);
      halo.addColorStop(1, `rgba(${c.rgb},0)`);
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(p.x, p.y, c.r, 0, Math.PI * 2); ctx.fill();

      // Solid flat disc — the mass that reads at a glance (earth-tone, capped well below aircraft/transit whites).
      ctx.fillStyle = `rgba(${c.rgb},${(c.core * dim * breath).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, c.disc, 0, Math.PI * 2); ctx.fill();

      // Bold dark keyline ON the disc edge — contrast, not brightness, so it survives the teal water
      // and keeps its rim even when dimmed overnight (gentle night floor, not full coreDim).
      ctx.strokeStyle = `rgba(6,12,20,${(0.7 * vis * (0.85 + 0.15 * (1 - nf))).toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, c.disc, 0, Math.PI * 2); ctx.stroke();

      // Thin hue lip just outside the keyline — the crisp locus.
      ctx.strokeStyle = `rgba(${c.rgb},${(c.ring * dim * breath).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, c.disc + 1.5, 0, Math.PI * 2); ctx.stroke();

      // Inner category mark over the solid center (shape = category for day/CVD legibility).
      drawMark(ctx, p.x, p.y, inc.cat, c.rgb, Math.min(0.98, c.ring * dim + 0.12));

      // One-time arrival ripple — a single raindrop, day only, and only for a genuinely FRESH
      // dispatch (so the initial load of a backlog of old-but-just-fetched incidents doesn't ripple).
      if (f.cfg.fireEmsArrivalCue && !muted && (now - inc.time) / 60000 < 8) {
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

// Small inner marks: a flame notch (major), a plus (medical), a slash (vehicle), none (alarm).
function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, cat: IncidentCat, rgb: string, a: number): void {
  if (cat === "alarm") return;
  ctx.strokeStyle = `rgba(${rgb},${a.toFixed(3)})`;
  ctx.fillStyle = `rgba(${rgb},${a.toFixed(3)})`;
  ctx.lineWidth = 1.4;
  if (cat === "medical") {
    ctx.beginPath(); ctx.moveTo(x - 2.5, y); ctx.lineTo(x + 2.5, y); ctx.moveTo(x, y - 2.5); ctx.lineTo(x, y + 2.5); ctx.stroke();
  } else if (cat === "vehicle") {
    ctx.beginPath(); ctx.moveTo(x - 2.5, y + 2); ctx.lineTo(x + 2.5, y - 2); ctx.stroke();
  } else { // major — a small upward flame notch
    ctx.beginPath();
    ctx.moveTo(x, y - 3.2); ctx.lineTo(x + 2.2, y + 2); ctx.lineTo(x - 2.2, y + 2); ctx.closePath();
    ctx.fill();
  }
}
