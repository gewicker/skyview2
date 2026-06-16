// Per-aircraft motion model. v1's smoothing, faithfully: each fix is stamped with
// its arrival time, the display renders ~1.15 s in the PAST, and positions are
// INTERPOLATED between the two bracketing real fixes (not extrapolated from "now").
// That's what makes 1 Hz traffic glide instead of snap. History lives here on the
// client; the server keeps none.
import type { Aircraft, Config } from "@shared/types";
import type { Sample, Visible } from "./types";

const RENDER_DELAY_MS = 1150; // render just over the ~1 Hz fix interval in the past

interface Track {
  latest: Aircraft;
  hist: Sample[];
  lastSeen: number;
}

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
      const last = tr.hist[tr.hist.length - 1];
      // Decimate: keep a fix only if it moved a meaningful distance OR enough time
      // passed (so we still record slow turns). Caps unbounded growth on the Pi.
      const MOVE2 = 1.2e-7; // ~ (0.00035°)² ≈ 30 m
      const moved = !last || (last.lat - a.lat) ** 2 + (last.lon - a.lon) ** 2 > MOVE2;
      const aged = last && now - last.t > 4000;
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
    const extrapMs = Math.max(0, (cfg.maxExtrapolationSec ?? 5) * 1000);
    const out: Visible[] = [];
    for (const tr of this.tracks.values()) {
      if (!passesFilter(tr.latest, cfg)) continue;
      const pos = interp(tr.hist, renderT, extrapMs);
      if (!pos) continue;
      // Length scales with groundspeed (on top of the time window already making
      // distance ∝ speed): fast traffic streaks, slow/parked traffic gets a stub.
      const gs = tr.latest.gs ?? 0;
      const winMs = Math.min(70_000, baseMs * clamp(gs / 260, 0.4, 1.05));
      const trail: Sample[] = [];
      for (const s of tr.hist) {
        if (s.t >= renderT - winMs && s.t <= renderT) trail.push(s);
      }
      trail.push({ t: renderT, lat: pos.lat, lon: pos.lon, alt: tr.latest.altBaro ?? tr.latest.altGeom }); // head
      out.push({ ...tr.latest, lat: pos.lat, lon: pos.lon, trail });
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

// Position at t: interpolate between the two bracketing fixes; PAST the newest fix,
// dead-reckon along the last segment's velocity (capped) so sparse/stale fixes glide
// instead of freezing-then-jumping (the v1 behaviour — this kills the robotic look).
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
