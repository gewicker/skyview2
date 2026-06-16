// Per-aircraft motion model. v1's smoothing, faithfully: each fix is stamped with
// its arrival time, the display renders ~1.15 s in the PAST, and positions are
// INTERPOLATED between the two bracketing real fixes (not extrapolated from "now").
// That's what makes 1 Hz traffic glide instead of snap. History lives here on the
// client; the server keeps none.
import type { Aircraft, Config } from "@shared/types";
import type { Sample, Visible } from "./types";

const RENDER_DELAY_MS = 1500; // render ~1.5 s in the past: more headroom so typical tracks
                              // stay BETWEEN two real fixes (interpolating) instead of extrapolating
const MAX_EXTRAP_MS = 1200;   // hard cap on forward dead-reckoning — bounds the snap-back
                              // ("rubberband") when a late fix lands behind the guess

interface Track {
  latest: Aircraft;
  hist: Sample[];
  lastSeen: number;
  rLat?: number; // smoothed (low-pass) render position + the render-clock it's valid at
  rLon?: number;
  rT?: number;
  prevGround?: boolean; // onGround state tracking for takeoff/landing detection
  groundSince?: number; // when the current onGround state began (debounces threshold flicker)
  transitAt?: number;   // Date.now of the last real onGround flip
  transitGround?: boolean; // the NEW state at that flip (true = landed, false = took off)
  transitLat?: number;
  transitLon?: number;
}

const SMOOTH_TAU = 0.22; // s — low-pass time constant; damps the per-fix kink & GPS jitter

export class TrackStore {
  private tracks = new Map<string, Track>();

  /** Ingest a snapshot: stamp each fix with arrival time, dedupe repeats. */
  ingest(list: Aircraft[]): void {
    const now = Date.now();
    for (const a of list) {
      if (a.lat == null || a.lon == null) continue;
      let tr = this.tracks.get(a.hex);
      if (!tr) {
        tr = { latest: a, hist: [], lastSeen: now };
        this.tracks.set(a.hex, tr);
      }
      tr.latest = a;
      tr.lastSeen = now;
      // Takeoff/landing detection: a real onGround flip after the previous state was held
      // a while (so threshold flicker on slow/low traffic doesn't trigger a false event).
      const isGround = !!a.onGround;
      if (tr.prevGround === undefined) { tr.prevGround = isGround; tr.groundSince = now; }
      else if (isGround !== tr.prevGround) {
        if (now - (tr.groundSince ?? now) > 4000) {
          tr.transitAt = now; tr.transitGround = isGround; tr.transitLat = a.lat; tr.transitLon = a.lon;
        }
        tr.prevGround = isGround; tr.groundSince = now;
      }
      const last = tr.hist[tr.hist.length - 1];
      // Decimate to cap growth on the Pi, but keep GROUND traffic much finer — a taxiing
      // aircraft only moves a few metres a second, so the airborne ~38 m threshold dropped
      // most of its motion and made it step. ~4 m + a 1.5 s refresh captures smooth taxiing.
      const MOVE2 = isGround ? 1.5e-9 : 1.2e-7; // ≈ 4 m on the ground vs ≈ 38 m airborne
      const ageMs = isGround ? 1500 : 4000;
      const moved = !last || (last.lat - a.lat) ** 2 + (last.lon - a.lon) ** 2 > MOVE2;
      const aged = last && now - last.t > ageMs;
      if (moved || aged) {
        tr.hist.push({ t: now, lat: a.lat, lon: a.lon, alt: a.altBaro ?? a.altGeom });
        if (tr.hist.length > 700) tr.hist.shift();
      }
    }
    this.prune(now);
  }

  /** Resolve the visible set at render time (now - delay), interpolated, with trails. */
  sample(cfg: Config): Visible[] {
    const renderT = Date.now() - RENDER_DELAY_MS;
    const baseMs = Math.max(0, (cfg.trailSeconds ?? 90) * 1000);
    const extrapMs = Math.min(MAX_EXTRAP_MS, Math.max(0, (cfg.maxExtrapolationSec ?? 5) * 1000));
    const out: Visible[] = [];
    for (const tr of this.tracks.values()) {
      if (!passesFilter(tr.latest, cfg)) continue;
      const target = interp(tr.hist, renderT, extrapMs);
      if (!target) continue;
      // Critically-damped low-pass toward the (linear) target: smooths the per-fix
      // heading kink and GPS jitter without overshoot. A large gap (reacquired track)
      // gives alpha→1, i.e. it snaps rather than drifting. Advanced once per render tick.
      let pos = target;
      if (tr.rLat != null && tr.rLon != null && tr.rT != null && renderT > tr.rT) {
        const alpha = 1 - Math.exp(-(renderT - tr.rT) / 1000 / SMOOTH_TAU);
        pos = { lat: tr.rLat + (target.lat - tr.rLat) * alpha, lon: tr.rLon + (target.lon - tr.rLon) * alpha };
      }
      if (tr.rT == null || renderT >= tr.rT) { tr.rLat = pos.lat; tr.rLon = pos.lon; tr.rT = renderT; }
      // Length scales with groundspeed (on top of the time window already making
      // distance ∝ speed): fast traffic streaks, slow/parked traffic gets a stub.
      const gs = tr.latest.gs ?? 0;
      const winMs = Math.min(70_000, baseMs * clamp(gs / 260, 0.4, 1.05));
      const trail: Sample[] = [];
      for (const s of tr.hist) {
        if (s.t >= renderT - winMs && s.t <= renderT) trail.push(s);
      }
      trail.push({ t: renderT, lat: pos.lat, lon: pos.lon, alt: tr.latest.altBaro ?? tr.latest.altGeom }); // head
      // Surface a recent takeoff/landing as a render-clock age (so the animation plays
      // when the DELAYED glyph reaches the event, not 1.35 s early).
      const v: Visible = { ...tr.latest, lat: pos.lat, lon: pos.lon, trail };
      if (tr.transitAt != null) {
        const age = renderT - tr.transitAt;
        if (age >= -200 && age < 2200) {
          v.transitAge = age; v.transitGround = tr.transitGround;
          v.transitLat = tr.transitLat; v.transitLon = tr.transitLon;
        }
      }
      out.push(v);
    }
    return out;
  }

  private prune(now: number): void {
    for (const [hex, tr] of this.tracks) {
      // Trim old history (trail window + headroom) and drop long-gone tracks.
      const cutoff = now - 120_000;
      while (tr.hist.length > 1 && tr.hist[0].t < cutoff) tr.hist.shift();
      if (now - tr.lastSeen > 30_000) this.tracks.delete(hex);
    }
  }
}

// Position at t: LINEAR interpolation between the two bracketing fixes (constant
// velocity per segment — no overshoot, exact at every fix). PAST the newest fix we
// dead-reckon along the last segment (capped) so sparse/stale tracks coast instead of
// freezing-then-jumping. The per-fix heading kink is then damped by the low-pass in
// sample() rather than by a spline (which wiggled around GPS noise).
function interp(hist: Sample[], t: number, extrapMs: number): { lat: number; lon: number } | null {
  if (hist.length === 0) return null;
  if (t <= hist[0].t) return hist[0];
  const last = hist[hist.length - 1];
  if (t >= last.t) {
    if (hist.length < 2 || extrapMs <= 0) return last;
    const prev = hist[hist.length - 2];
    const dt = last.t - prev.t;
    if (dt <= 0) return last;
    const k = Math.min(t - last.t, extrapMs) / dt; // capped extrapolation factor
    return { lat: last.lat + (last.lat - prev.lat) * k, lon: last.lon + (last.lon - prev.lon) * k };
  }
  for (let i = hist.length - 1; i > 0; i--) {
    const a = hist[i - 1], b = hist[i];
    if (t >= a.t && t <= b.t) {
      const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
    }
  }
  return last;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function passesFilter(a: Aircraft, cfg: Config): boolean {
  if (cfg.hideOnGround && a.onGround) return false;
  const alt = a.altBaro ?? 0;
  if (cfg.minAltitudeFt > 0 && alt < cfg.minAltitudeFt) return false;
  if (cfg.maxAltitudeFt > 0 && alt > cfg.maxAltitudeFt) return false;
  return true;
}
