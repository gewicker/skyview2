// Per-aircraft motion model. v1's smoothing, faithfully: each fix is stamped with
// its arrival time, the display renders ~1.15 s in the PAST, and positions are
// INTERPOLATED between the two bracketing real fixes (not extrapolated from "now").
// That's what makes 1 Hz traffic glide instead of snap. History lives here on the
// client; the server keeps none.
import type { Aircraft, Config } from "@shared/types";
import type { Sample, Visible } from "./types";

const RENDER_DELAY_MS = 1200; // render ~1.2 s behind the measurement timeline — interpolate
                              // between real fixes when we can; dead-reckon past the newest
const DEG = Math.PI / 180;

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

const SMOOTH_TAU = 0.2; // s — low-pass time constant; damps the per-fix kink, GPS jitter, and
                        // eases prediction corrections so nothing snaps (higher = smoother/softer)

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
        if (now - (tr.groundSince ?? now) > 2500) { // prior state held a bit (debounce threshold flicker)
          tr.transitAt = now; tr.transitGround = isGround; tr.transitLat = a.lat; tr.transitLon = a.lon;
        }
        tr.prevGround = isGround; tr.groundSince = now;
      }
      const last = tr.hist[tr.hist.length - 1];
      // Stamp each fix by when its POSITION was actually MEASURED (now − seen_pos), NOT by
      // arrival time. This builds a regular, measurement-aligned timeline that's immune to
      // network/poll jitter — the key to smooth interpolation. (Falls back to `now` when the
      // decoder doesn't report seen_pos.)
      const fixT = now - (a.seenPos ?? 0) * 1000;
      // A parked/holding aircraft (on the ground with ~no groundspeed) jitters in GPS by
      // several metres; the fine ground sampling otherwise records every wobble, making it
      // shimmy back and forth ("ground rubberband"). Treat it as stationary and PIN it to its
      // last position. A taxiing aircraft (gs above the threshold) is captured normally.
      const stationary = isGround && (a.gs ?? 0) < 3;
      const MOVE2 = isGround ? 1.5e-9 : 1.2e-7; // ≈ 4 m on the ground vs ≈ 38 m airborne
      const ageMs = isGround ? 1500 : 4000;
      const moved = !stationary && (!last || (last.lat - a.lat) ** 2 + (last.lon - a.lon) ** 2 > MOVE2);
      const aged = last && fixT - last.t > ageMs;
      if (moved || aged) {
        const plat = stationary && last ? last.lat : a.lat; // pin a parked aircraft, don't record jitter
        const plon = stationary && last ? last.lon : a.lon;
        // Keep the timeline strictly increasing even if a jittery seen_pos regressed the
        // stamp — NUDGE forward rather than drop the fix (dropping would wedge/freeze the
        // track until wall time overtook the bad stamp).
        const t = last && fixT <= last.t ? last.t + 1 : fixT;
        tr.hist.push({ t, lat: plat, lon: plon, alt: a.altBaro ?? a.altGeom });
        if (tr.hist.length > 700) tr.hist.shift();
      }
    }
    this.prune(now);
  }

  /** Resolve the visible set at render time (now - delay), interpolated, with trails. */
  sample(cfg: Config): Visible[] {
    const renderT = Date.now() - RENDER_DELAY_MS;
    const baseMs = Math.max(0, (cfg.trailSeconds ?? 90) * 1000);
    const out: Visible[] = [];
    for (const tr of this.tracks.values()) {
      if (!passesFilter(tr.latest, cfg)) continue;
      const target = predictPos(tr.hist, tr.latest, renderT);
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
      const lo = renderT - winMs;
      // hist is time-sorted: walk back from the newest fix and stop once past the window,
      // so we touch only the visible tail instead of scanning the full (≤700) history.
      const trail: Sample[] = [];
      for (let i = tr.hist.length - 1; i >= 0; i--) {
        const s = tr.hist[i];
        if (s.t > renderT) continue; // not yet reached at render time
        if (s.t < lo) break;         // older than the window — everything before is too
        trail.push(s);
      }
      trail.reverse();
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

// Position at render time t. BETWEEN two real fixes we linearly interpolate (exact at every
// fix, smooth). PAST the newest fix we dead-reckon forward at the aircraft's REPORTED velocity
// (groundspeed + track) so a stale track keeps gliding at its true speed instead of FREEZING —
// the low-pass in sample() then eases the correction in when the next fix lands. This is what
// fixes the "glide / pause / glide" stepping: there is no more hard freeze.
function predictPos(hist: Sample[], a: Aircraft, t: number): { lat: number; lon: number } | null {
  if (hist.length === 0) return null;
  if (t <= hist[0].t) return { lat: hist[0].lat, lon: hist[0].lon };
  const last = hist[hist.length - 1];
  if (t >= last.t) {
    if (a.onGround) {
      // Ground: coast along the actual TAXI PATH — the direction of the last movement segment
      // — capped short, so it glides smoothly instead of pausing, and doesn't veer on the
      // noisy reported surface track. A pinned/parked aircraft has a ~zero segment, so it
      // stays put.
      if (hist.length < 2) return { lat: last.lat, lon: last.lon };
      const prev = hist[hist.length - 2];
      const dt = last.t - prev.t;
      if (dt <= 0) return { lat: last.lat, lon: last.lon };
      const k = Math.min(t - last.t, 1500) / dt; // up to 1.5 s of taxi coast
      return { lat: last.lat + (last.lat - prev.lat) * k, lon: last.lon + (last.lon - prev.lon) * k };
    }
    return deadReckon(last, a.gs, a.track, t - last.t);
  }
  for (let i = hist.length - 1; i > 0; i--) {
    const a = hist[i - 1], b = hist[i];
    if (t >= a.t && t <= b.t) {
      const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
    }
  }
  return { lat: last.lat, lon: last.lon };
}

// Coast forward from a fix along the reported groundspeed/track for `ageMs` (capped so a
// long-lost track doesn't run away). Straight flight predicts ~perfectly; turns ease in.
function deadReckon(p: Sample, gs: number | undefined, track: number | undefined, ageMs: number): { lat: number; lon: number } {
  if (gs == null || track == null || gs <= 0 || ageMs <= 0) return { lat: p.lat, lon: p.lon };
  const distM = gs * 0.514444 * (Math.min(ageMs, 10000) / 1000); // kt→m/s × s, capped at 10 s
  const b = track * DEG;
  return {
    lat: p.lat + (distM * Math.cos(b)) / 111320,
    lon: p.lon + (distM * Math.sin(b)) / (111320 * Math.cos(p.lat * DEG)),
  };
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
