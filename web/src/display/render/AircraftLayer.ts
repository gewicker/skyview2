// Aircraft layer: a type-accurate silhouette per aircraft (rotated to track,
// altitude-coloured via the rich ramp, spinning props/rotors) with a compact
// multi-line label, and the home beacon. Ground traffic is deliberately subdued and
// shrunk so a busy airport reads as one glowing mass (overlapping additive halos)
// rather than a clutter of bright glyphs + labels.
import type { Layer, FrameContext, Visible } from "./types";
import type { Config } from "@shared/types";
import { classifyGlyph, GLYPH_SCALE, drawGlyphStatic, drawGlyphSpinners, hasSpinners, lightAnchors, type LightAnchors, type GlyphKind } from "./aircraftGlyph";
import { getGlyphSprite } from "./glyphCache";
import { altRamp, hexRGB, type RGB } from "./colors";
import { AIRPORTS } from "./airports";
import { SEAPLANE_BASES } from "./seaplane";
import { arrivalField } from "./ApproachLayer";
import { sunAltitude } from "./sun";

// Time-of-day night factor (0 in daylight → 1 at full night), smooth through twilight.
// Aircraft + runway lights scale to this so they fade in at dusk like the real thing.
function nightFactor(sunAltDeg: number): number {
  const f = (3 - sunAltDeg) / 9; // 0 at +3°, 1 at −6°
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

const DEG = Math.PI / 180;
const LINE_H = 14;
const GROUND_RGB: RGB = [200, 122, 60]; // subdued warm — ground/apron
const MORPH_MS = 1000;    // glyph crossfade between ground chevron and airborne silhouette
const FLOURISH_MS = 2200; // one-time touchdown ripple+smoke / liftoff glow+streak (longer = easier to catch)

// Label widths were measured for every line of every aircraft every frame; the strings only
// change ~1 Hz (and labels use one fixed font here), so cache them.
const _labelW = new Map<string, number>();
function measureLabel(ctx: CanvasRenderingContext2D, s: string): number {
  let w = _labelW.get(s);
  if (w === undefined) {
    w = ctx.measureText(s).width;
    if (_labelW.size > 1000) _labelW.clear();
    _labelW.set(s, w);
  }
  return w;
}

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

// Physically landing at a local field ⇒ established on its final by glidepath/alignment
// physics (shared with the approach tag), NOT nearest-centroid. So a SEA arrival reads
// "→ SEA" instead of "→ BFI" (Boeing Field sits under SEA's north approach), and a plane
// merely transiting low near a field no longer gets a false destination.
function arrivingLocal(a: Visible): string | null {
  const m = arrivalField(a);
  return m ? m.iata : null;
}

// Low + clearly climbing + close to a local field ⇒ just departed there. Used only to
// catch the bogus "→ SEA" the route DB shows for a SEA departure (you don't fly to the
// field you just left); we suppress the destination rather than assert a wrong one.
function departingLocal(a: Visible): string | null {
  if (a.onGround || a.altBaro == null || a.altBaro > 10000) return null;
  if (a.baroRate == null || a.baroRate < 200) return null; // must be clearly climbing
  return nearestLocalField(a, 6);
}

// Bearing (0 = N, 90 = E, matching the ADS-B `track` convention) from the aircraft's recent
// motion trail — the direction it's ACTUALLY moving. Used to point ground chevrons, where the
// reported track is frequently null or stale. Walks back over the last few trail points until
// it finds enough displacement to define a heading; returns null if there isn't any.
function motionHeading(a: Visible): number | null {
  const tr = a.trail;
  if (!tr || tr.length < 2) return null;
  const p1 = tr[tr.length - 1];
  // Walk back over the last few points to the first that is clearly beyond GPS noise (~10 m).
  // A lower gate would let jitter set the heading, spinning the chevron frame-to-frame.
  for (let i = tr.length - 2; i >= 0 && i >= tr.length - 6; i--) {
    const p0 = tr[i];
    const north = p1.lat - p0.lat;
    const east = (p1.lon - p0.lon) * Math.cos(p1.lat * DEG);
    if (Math.hypot(north, east) * 111320 >= 10) return (Math.atan2(east, north) * 180) / Math.PI;
  }
  return null; // not enough real motion — leave the heading to the caller (reported track)
}


export class AircraftLayer implements Layer {
  readonly name = "aircraft";
  private sunAt = 0;
  private autoNf = 0;     // sun-based night factor (recomputed every ~20 s)
  private nf = 0;         // effective night factor after the lights mode
  private lightsOn = true; // false when lights mode is "off"

  draw(f: FrameContext): void {
    const ctx = f.ctx;
    const wall = Date.now();
    if (wall - this.sunAt > 20000) {
      this.sunAt = wall;
      this.autoNf = nightFactor(sunAltitude(f.cfg.centerLat, f.cfg.centerLon, new Date(wall + (f.cfg.skyTimeOffsetMin || 0) * 60000)));
    }
    // Lights mode: "auto" follows the sun, "on" forces full night lighting, "off" hides them.
    const lmode = f.cfg.lightsMode || "auto";
    this.lightsOn = lmode !== "off";
    this.nf = lmode === "on" ? 1 : lmode === "off" ? 0 : this.autoNf;
    // Airborne aircraft read at the configured size; ground traffic is drawn as crisp little
    // chevrons/dots (see drawGroundMarker) so a busy ramp reads as distinct aircraft.
    // ZOOM COUPLING: glyphs are a fixed pixel size, so when you zoom in on a single aircraft
    // it stays tiny and reads as a featureless dot. Grow them with the map zoom — bounded and
    // quantised (so the sprite cache doesn't churn) — so a zoomed-in plane becomes a detailed
    // silhouette while a zoomed-out busy sky stays compact.
    const base = (f.cfg.glyphSizePx ?? 18) * 0.85;
    const zk = Math.min(2.6, Math.max(1, Math.pow((f.view.mapZoom || 1) / 2.2, 0.5)));
    const zq = Math.round(zk * 4) / 4;
    ctx.save();
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.textBaseline = "middle";

    const jobs: LabelJob[] = [];
    for (const a of f.cfg.showTraffic === false ? [] : f.aircraft) {
      // On-ground when the feed says so, OR a near-stationary aircraft with no meaningful
      // altitude — Boeing test/ferry flights (e.g. BOE123) often omit the on-ground flag, which
      // left a 1-kt ramped jet drawn as an airborne silhouette.
      const ground = !!a.onGround ||
        (a.gs != null && a.gs < 4 && (a.altBaro == null || a.altBaro < 1200));
      const p = f.cam.project(a.lat, a.lon);
      const kind = classifyGlyph(a);
      const full = base * GLYPH_SCALE[kind] * zq;
      const glyphS = ground ? full * 0.5 : full;       // small footprint on the ground
      const glowS = ground ? full * 0.85 : full;        // glow stays sized so clusters merge
      const rgb: RGB = !f.cfg.altitudeColor
        ? hexRGB(f.cfg.palette.glyph || "#ff9a3c")
        : ground ? GROUND_RGB : altRamp(a.altBaro ?? 0);

      // Takeoff/landing morph: crossfade + scale between the ground chevron and the
      // airborne silhouette over MORPH_MS, so a departure grows up off the surface and an
      // arrival settles onto it instead of popping.
      const tAge = a.transitAge;
      const tp = tAge != null && tAge >= 0 && tAge < MORPH_MS ? tAge / MORPH_MS : 1;
      const morphing = tp < 1;

      ctx.save();
      ctx.translate(p.x, p.y);
      // Heading the glyph points: airborne uses the reported track (reliable from ADS-B
      // velocity); on the GROUND the reported track is often null/stale, so the chevron is
      // pointed along the ACTUAL recent direction of travel derived from the motion trail.
      let headingDeg = a.track ?? 0;
      if (ground) {
        const mh = motionHeading(a);
        if (mh != null) headingDeg = mh;
      }
      ctx.rotate((headingDeg + (f.cfg.mapRotationDeg ?? 0)) * DEG);
      if (ground) {
        if (morphing && a.transitGround === true) {
          this.airborne(f, kind, rgb, glyphS, glowS, 1 - tp, seedFor(a.hex), 1 + 0.25 * (1 - tp));
          drawGroundMarker(ctx, kind, rgb, base, a.gs ?? 0, a.hex === f.selectedHex, tp, 0.6 + 0.4 * tp);
        } else {
          drawGroundMarker(ctx, kind, rgb, base, a.gs ?? 0, a.hex === f.selectedHex);
        }
      } else {
        if (morphing && a.transitGround === false) {
          drawGroundMarker(ctx, kind, rgb, base, a.gs ?? 0, a.hex === f.selectedHex, 1 - tp, 1);
          // Rotation/lift-off pop: grow in with a mid-morph scale overshoot.
          this.airborne(f, kind, rgb, glyphS, glowS, tp, seedFor(a.hex), 0.6 + 0.4 * tp + 0.2 * Math.sin(tp * Math.PI));
        } else {
          this.airborne(f, kind, rgb, glyphS, glowS, 1, seedFor(a.hex), 1);
        }
      }
      // Landing light: on final to a PREDICTED runway, the nose light comes on — a warm forward
      // beam that brightens as it nears the predicted touchdown (day + night, brighter at night).
      if (!ground && this.lightsOn && arrivingLocal(a)) {
        const altF = a.altBaro ?? 3000;
        const close = Math.max(0.3, Math.min(1, 1 - (altF - 200) / 2800)); // brighter lower/closer
        const flick = 0.9 + 0.1 * Math.sin(f.t * 26 + seedFor(a.hex));
        const shimmer = 1 + 0.06 * Math.sin(f.t * 40 + seedFor(a.hex) * 7); // faint HID-through-haze scintillation
        const amp = close * flick * shimmer * (0.75 + 0.25 * this.nf); // strong by day, fuller at night
        ctx.globalCompositeOperation = "lighter";
        const ny = lightAnchors(kind).noseY * glyphS; // beam leaves the true nose tip
        const reach = glyphS * (3.2 + 3.0 * close);   // longer throw as it nears touchdown
        const halfW = glyphS * (0.28 + 0.45 * close); // tight at the nose, blooming on short final
        const throat = glyphS * 0.12;                 // the beam has width at its source
        // Warm forward beam: a real beam with a throat, fanning out and reaching further low.
        const g = ctx.createLinearGradient(0, ny, 0, ny - reach);
        g.addColorStop(0, `rgba(255,249,206,${(0.9 * amp).toFixed(3)})`);
        g.addColorStop(0.5, `rgba(255,248,210,${(0.30 * amp).toFixed(3)})`);
        g.addColorStop(1, "rgba(255,248,210,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(-throat, ny);
        ctx.lineTo(-halfW, ny - reach);
        ctx.lineTo(halfW, ny - reach);
        ctx.lineTo(throat, ny);
        ctx.closePath();
        ctx.fill();
        // Bright lamp at the nose + a hot white core, so the source reads as a sharp point.
        lamp(ctx, 0, ny, 2.4 + close * 1.8, `rgba(255,251,224,${(0.95 * amp).toFixed(3)})`);
        lamp(ctx, 0, ny, 1.0 + close * 0.7, `rgba(255,255,255,${(0.95 * amp).toFixed(3)})`);
        ctx.globalCompositeOperation = "source-over";
      }
      // Speed-reactive streak during a takeoff/landing event — a bright tapered bloom behind
      // the glyph (rotated frame, +y = aft): grows on the takeoff roll, shrinks on the rollout.
      if (!ground && tAge != null && tAge >= 0 && tAge < FLOURISH_MS) {
        const phase = tAge / FLOURISH_MS;
        const accel = a.transitGround === false ? phase : 1 - phase;
        const len = (8 + (a.gs ?? 0) * 0.12) * accel;
        if (len > 2) {
          ctx.globalCompositeOperation = "lighter";
          const g = ctx.createLinearGradient(0, glyphS * 0.3, 0, glyphS * 0.3 + len);
          g.addColorStop(0, `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},0.5)`);
          g.addColorStop(1, `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},0)`);
          ctx.strokeStyle = g;
          ctx.lineCap = "round";
          ctx.lineWidth = glyphS * 0.5;
          ctx.beginPath(); ctx.moveTo(0, glyphS * 0.3); ctx.lineTo(0, glyphS * 0.3 + len); ctx.stroke();
          ctx.globalCompositeOperation = "source-over";
        }
      }
      ctx.restore();

      // Labels: airborne always; ground only when explicitly selected (declutters airports).
      // Collected now, then density-limited + decluttered + drawn in one pass below.
      if (!ground || a.hex === f.selectedHex) {
        const lines = labelLines(a, f.cfg);
        if (lines.length) {
          let w = 0;
          for (const l of lines) w = Math.max(w, measureLabel(ctx, l));
          const dist = (a.lat - f.cfg.centerLat) ** 2 + (a.lon - f.cfg.centerLon) ** 2;
          // Place the card on the side AWAY from the screen centre, so a busy approach line
          // (usually crossing the middle) gets cards fanned outward instead of stacked in one
          // crowded column that buries the data.
          const onRight = p.x > f.w * 0.5;
          const ax = onRight ? p.x - glyphS - 8 - (w + 8) : p.x + glyphS + 8;
          jobs.push({
            hex: a.hex, lines, ax, ay: p.y, drawY: p.y,
            w: w + 8, h: lines.length * LINE_H + 2, dist,
          });
        }
      }
    }

    drawLabels(ctx, jobs, f);
    ctx.restore();

    // Takeoff/landing flourish: a one-time cue anchored at the event location (which the
    // glyph has since flown on from). Only active for ~FLOURISH_MS after the event.
    for (const a of f.cfg.showTraffic === false ? [] : f.aircraft) {
      const age = a.transitAge;
      if (age == null || age < 0 || age >= FLOURISH_MS || a.transitLat == null || a.transitLon == null) continue;
      const q = f.cam.project(a.transitLat, a.transitLon);
      const fk = classifyGlyph(a);
      const mode: FlourishMode = fk === "helicopter" ? "heli"
        : nearSeaplaneBase(a.transitLat, a.transitLon) ? "water" : "runway";
      drawFlourish(ctx, q.x, q.y, age / FLOURISH_MS, a.transitGround === true, ((a.track ?? 0) + (f.cfg.mapRotationDeg ?? 0)) * DEG, mode);
    }

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

  // Airborne glyph: additive glow (skipped mid-gesture) + the cached silhouette sprite +
  // any prop/rotor spinners. `fade`/`scale` drive the takeoff/landing morph.
  private airborne(
    f: FrameContext, kind: ReturnType<typeof classifyGlyph>, rgb: RGB,
    glyphS: number, glowS: number, fade: number, seed: number, scale: number,
  ): void {
    const ctx = f.ctx;
    ctx.save();
    if (fade < 1) ctx.globalAlpha = fade;
    if (scale !== 1) ctx.scale(scale, scale);
    if (!f.interacting) {
      // Jewel/beacon glow: a wide faint halo, a mid ring, then a tight BRIGHTENED core, so
      // each aircraft reads as a crisp luminous point instead of a soft blob.
      ctx.globalCompositeOperation = "lighter";
      const r0 = rgb[0] | 0, r1 = rgb[1] | 0, r2 = rgb[2] | 0;
      // Soft luminous presence only — must NOT whiten/wash the (earthy) fill or drown the nav
      // lights. Keep the core in the fill HUE (small +15 lift, low alpha), not a white-hot dot.
      ctx.fillStyle = `rgba(${r0},${r1},${r2},0.045)`;
      ctx.beginPath(); ctx.arc(0, 0, glowS * 1.9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(${r0},${r1},${r2},0.08)`;
      ctx.beginPath(); ctx.arc(0, 0, glowS * 0.95, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(${Math.min(255, r0 + 15)},${Math.min(255, r1 + 15)},${Math.min(255, r2 + 15)},0.15)`;
      ctx.beginPath(); ctx.arc(0, 0, glowS * 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
    const sprite = getGlyphSprite(kind, rgb, 1, glyphS, f.dpr);
    ctx.drawImage(sprite.canvas, -sprite.half, -sprite.half, sprite.half * 2, sprite.half * 2);
    if (hasSpinners(kind)) drawGlyphSpinners(ctx, kind, glyphS, rgb, 1, f.t, seed);
    if (this.lightsOn) drawNavLights(ctx, glyphS, lightAnchors(kind), seed, f.t, this.nf);
    ctx.restore();
  }
}

type FlourishMode = "runway" | "water" | "heli";

// One-time takeoff/landing flourish in screen space, themed by how the aircraft operates:
//  • runway — tire sparks/smoke (landing) or dust kick + warm liftoff flash (takeoff).
//  • water  — cool-white SPRAY fan + V WAKE (floatplanes on the lakes).
//  • heli   — rotor DOWNWASH rings (vertical ops; no runway roll/streak).
// fp is 0→1 over FLOURISH_MS.
function drawFlourish(ctx: CanvasRenderingContext2D, x: number, y: number, fp: number, landing: boolean, screenHdg: number, mode: FlourishMode = "runway"): void {
  const fx = Math.sin(screenHdg), fy = -Math.cos(screenHdg); // forward (nose) direction, screen
  const px = Math.cos(screenHdg), py = Math.sin(screenHdg);  // perpendicular (gear straddle)
  const gear = 7;
  ctx.save();
  if (mode === "heli") {
    // Rotor downwash: concentric ground rings pushed outward — same family for set-down/lift-off.
    const e = 1 - (1 - fp) * (1 - fp);
    for (let i = 0; i < 3; i++) {
      const rr = 5 + i * 7 + e * 20;
      const aa = (1 - fp) * (0.3 - i * 0.08);
      if (aa <= 0) continue;
      ctx.strokeStyle = `rgba(198,205,214,${aa.toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    return;
  }
  if (mode === "water") {
    // Floatplane: cool-white spray fan forward+outboard, then a V wake trailing aft.
    const e = 1 - (1 - fp) * (1 - fp);
    ctx.globalCompositeOperation = "lighter";
    for (const sgn of [-1, 1]) {
      const sx = x + fx * e * 8 + px * sgn * (4 + e * 9);
      const sy = y + fy * e * 8 + py * sgn * (4 + e * 9);
      ctx.fillStyle = `rgba(222,240,247,${((1 - fp) * 0.42).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(sx, sy, 2 + e * 7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    for (const sgn of [-1, 1]) {
      const wx = x - fx * (6 + e * 16) + px * sgn * (2 + e * 12);
      const wy = y - fy * (6 + e * 16) + py * sgn * (2 + e * 12);
      ctx.strokeStyle = `rgba(180,212,224,${((1 - fp) * 0.3).toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(wx, wy); ctx.stroke();
    }
    ctx.restore();
    return;
  }
  if (landing) {
    // Touchdown sparks at the two main gear — a bright cool-white hit, fires first, fast decay.
    const tp = fp / 0.18;
    if (tp > 0 && tp < 1) {
      const e = 1 - (1 - tp) * (1 - tp), sa = 1 - tp;
      ctx.globalCompositeOperation = "lighter";
      for (const sgn of [-1, 1]) {
        const gx = x + px * sgn * gear, gy = y + py * sgn * gear;
        ctx.fillStyle = `rgba(225,245,255,${(sa * 0.8).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(gx, gy, 2 + e * 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,${(sa * 0.9).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(gx, gy, 1.4 + e * 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    }
    // Tire spray — warm-gray rubber smoke blown forward + outboard from each gear, dissipating.
    const pp = (fp - 0.06) / 0.5;
    if (pp > 0 && pp < 1) {
      const e = 1 - (1 - pp) * (1 - pp);
      for (const sgn of [-1, 1]) {
        const gx = x + fx * e * 10 + px * sgn * (gear + e * 6);
        const gy = y + fy * e * 10 + py * sgn * (gear + e * 6);
        ctx.fillStyle = `rgba(210,206,198,${((1 - pp) * 0.34).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(gx, gy, 2.5 + e * 7, 0, Math.PI * 2); ctx.fill();
      }
    }
  } else {
    const e = 1 - (1 - fp) * (1 - fp);
    // Backward dust kick (2 puffs aft) as it accelerates away down the runway.
    for (const sgn of [-1, 1]) {
      const gx = x - fx * (5 + e * 10) + px * sgn * 4;
      const gy = y - fy * (5 + e * 10) + py * sgn * 4;
      ctx.fillStyle = `rgba(205,200,190,${((1 - fp) * 0.3).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(gx, gy, 3 + e * 9, 0, Math.PI * 2); ctx.fill();
    }
    // Warm liftoff flash at the unstick point.
    const r = 5 + e * 22;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,200,120,${((1 - fp) * 0.45).toFixed(3)})`);
    g.addColorStop(1, "rgba(255,180,100,0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.restore();
}

// A transit (takeoff/landing) within ~1.3 mi of a seaplane base counts as a WATER op — used
// to theme the flourish (spray/wake) for floatplanes operating on the lakes.
function nearSeaplaneBase(lat: number, lon: number): boolean {
  for (const b of SEAPLANE_BASES) {
    const d = Math.hypot((lat - b.lat) * 69, (lon - b.lon) * 69 * Math.cos(b.lat * DEG));
    if (d < 1.3) return true;
  }
  return false;
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
  let callsignOnly: LabelJob[] = [];
  if (dens === "adaptive") {
    // Density-adaptive tiers: the busier the sky, the fewer FULL cards — which is what
    // frees the visual budget for the ambient layers underneath. Beyond the full tier a
    // handful collapse to a faded callsign-only line; the rest keep glyph+trail, no text.
    const N = jobs.length;
    const base = Math.max(1, f.cfg.nearestN ?? 8);
    let K = N <= 12 ? base : N <= 25 ? Math.round(base * 0.6) : 3;
    K = Math.min(K, N);
    const sorted = [...jobs].sort((a, b) => a.dist - b.dist);
    chosen = sorted.slice(0, K);
    callsignOnly = sorted.slice(K, K + Math.min(6, N - K));
    if (f.selectedHex && !chosen.some((j) => j.hex === f.selectedHex)) {
      const sel = jobs.find((j) => j.hex === f.selectedHex);
      if (sel) { chosen.push(sel); callsignOnly = callsignOnly.filter((j) => j.hex !== f.selectedHex); }
    }
  } else if (dens !== "all") {
    const n = dens === "nearestOnly" ? 1 : Math.max(1, f.cfg.nearestN ?? 8);
    chosen = [...jobs].sort((a, b) => a.dist - b.dist).slice(0, n);
    if (f.selectedHex && !chosen.some((j) => j.hex === f.selectedHex)) {
      const sel = jobs.find((j) => j.hex === f.selectedHex);
      if (sel) chosen.push(sel);
    }
  }

  // Callsign-only tier: a single faded line at the glyph, no plate, fading with distance
  // from home — distant ambient traffic dims its text without vanishing. Drawn first so the
  // full cards sit on top.
  if (callsignOnly.length) {
    const maxg = Math.max(0.01, (f.cfg.radiusMiles ?? 22) / 69); // ~degrees
    for (const j of callsignOnly) {
      const gd = Math.sqrt(j.dist);
      const fade = Math.max(0.6, Math.min(1, 1 - gd / maxg));
      drawCallsign(ctx, j.lines[0], j.ax, j.ay, 0.7 * fade);
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
  // Soft BORDERLESS scrim for structure + legibility over bright imagery. A hard bordered/outlined
  // rect reads as SELECTION (house rule); this is just a low-contrast backing with no edge, so it
  // gives the label a clean card shape without competing with the selection ring.
  const sx = x - 6, sy = top - LINE_H / 2 - 1, sw = maxW + 12, sh = n * LINE_H + 2, r = 5;
  ctx.beginPath();
  ctx.moveTo(sx + r, sy);
  ctx.arcTo(sx + sw, sy, sx + sw, sy + sh, r);
  ctx.arcTo(sx + sw, sy + sh, sx, sy + sh, r);
  ctx.arcTo(sx, sy + sh, sx, sy, r);
  ctx.arcTo(sx, sy, sx + sw, sy, r);
  ctx.closePath();
  ctx.fillStyle = "rgba(12,18,28,0.46)";
  ctx.fill();
  ctx.lineJoin = "round";
  for (let i = 0; i < n; i++) {
    const y = top + i * LINE_H;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.strokeText(lines[i], x, y);
    ctx.fillStyle = i === 0 ? "rgba(242,246,251,0.99)" : "rgba(208,217,228,0.93)";
    ctx.fillText(lines[i], x, y);
  }
}

// Callsign-only label for the mid tier: just the primary line, no plate, alpha-faded.
function drawCallsign(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, alpha: number): void {
  if (!text) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "rgba(226,233,243,0.96)";
  ctx.fillText(text, x, y);
  ctx.restore();
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

// Ground traffic marker, drawn in the already-rotated frame so "up" (−y) is the aircraft's
// track. A TAXIING aircraft now gets a compact top-view SILHOUETTE (higher fidelity than the
// old chevron) sized by its kind and oriented along travel; a PARKED one (≈stationary) stays a
// small dot so a dense ramp doesn't mush. Muted (GROUND_RGB) + a thin dark edge for legibility.
function drawGroundMarker(ctx: CanvasRenderingContext2D, kind: GlyphKind, rgb: RGB, base: number, gs: number, sel: boolean, fade = 1, scale = 1): void {
  const b = base * scale;
  ctx.save();
  if (fade < 1) ctx.globalAlpha = fade;
  ctx.lineJoin = "round";
  // EVERY on-ground aircraft is the same compact silhouette — no dot/glyph split (that read as
  // inconsistent at a busy ramp). Parked (gs<3) draws a touch smaller + dimmer to declutter dense
  // ramps, but it's the same shape as a taxiing one. Oriented along travel (ctx already rotated).
  const moving = gs >= 3;
  const s = Math.max(5, b * (moving ? 0.5 : 0.42) * GLYPH_SCALE[kind]);
  drawGlyphStatic(ctx, kind, s, rgb, moving ? 0.96 : 0.82);
  if (sel) {
    ctx.strokeStyle = "rgba(255,210,120,0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, s + 5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function lamp(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: string): void {
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// External lights on an airborne aircraft, MOUNTED on the real airframe via per-kind anchors
// (`a`): red (port) + green (starboard) ride the true swept wingtips, white sits on the tail
// cone, a red anti-collision beacon SWEEPS like a rotating lens, and white xenon STROBES
// double-flash off the wingtips. Seeded per aircraft so the sky twinkles out of sync. `nf` is
// the night factor (0 day → 1 night); colours run day+night and bloom brighter after dusk.
function drawNavLights(ctx: CanvasRenderingContext2D, glyphS: number, a: LightAnchors, seed: number, t: number, nf: number): void {
  const lvl = 0.18 + 0.82 * nf; // steady lights nearly vanish by day (were 0.5 = sub-2px daytime noise), bloom at night
  const wx = a.wingX * glyphS, wy = a.wingY * glyphS;
  // Light dot radii SCALE with the glyph (was a constant 1.3px that vanished at small size and
  // never grew when zoomed in). lr ≈ a wingtip-lens size proportional to the airframe.
  const lr = Math.max(1.1, glyphS * 0.12);
  // Position lights (steady). Warm-red port / cool-green starboard read as a temperature pair
  // even at 1px; warm-white tail. Drawn over the map (source-over).
  lamp(ctx, -wx, wy, lr, `rgba(255,42,38,${(0.95 * lvl).toFixed(3)})`);             // port (red)
  lamp(ctx, wx, wy, lr, `rgba(40,235,90,${(0.95 * lvl).toFixed(3)})`);              // starboard (green)
  lamp(ctx, 0, a.tailY * glyphS, lr * 0.85, `rgba(255,247,235,${(0.85 * lvl).toFixed(3)})`); // tail (warm white)
  ctx.globalCompositeOperation = "lighter";
  // Red beacon: a rotating lens crossing the line of sight — fast rise, slow fall, dark half.
  const bp = (t * 0.85 + seed) % 1;
  const b = bp < 0.55 ? Math.pow(Math.max(0, Math.sin(bp * Math.PI * 2)), 3) : 0;
  if (b > 0.002) lamp(ctx, 0, a.beaconY * glyphS, lr * 0.95 + b * lr * 1.1, `rgba(255,40,32,${(0.34 * b * lvl).toFixed(3)})`);
  // White wingtip strobes: real double-flash (~1.1 s), with a hot capacitor-dump overshoot on
  // the leading frame of each flash and a faint xenon-blue ring, then snap to baseline.
  const ph = (t * 0.9 + seed) % 1;
  if (ph < 0.04 || (ph > 0.1 && ph < 0.14)) {
    const lead = ph < 0.012 || (ph > 0.1 && ph < 0.112);
    const sbase = Math.max(2.6, glyphS * 0.22); // flash floor enlarged so the double-flash is catchable across a room
    const sr = lead ? sbase * 1.25 : sbase;
    const sa = (lead ? 0.95 : 0.3 + 0.65 * nf).toFixed(3);
    lamp(ctx, -wx, wy, sr, `rgba(255,255,255,${sa})`);
    lamp(ctx, wx, wy, sr, `rgba(255,255,255,${sa})`);
    if (lead) {
      lamp(ctx, -wx, wy, sbase * 1.7, "rgba(200,225,255,0.5)");
      lamp(ctx, wx, wy, sbase * 1.7, "rgba(200,225,255,0.5)");
    }
  }
  ctx.globalCompositeOperation = "source-over";
}

function seedFor(hex: string): number {
  let s = 0;
  for (let i = 0; i < hex.length; i++) s = (s + hex.charCodeAt(i)) % 628;
  return s / 100;
}
