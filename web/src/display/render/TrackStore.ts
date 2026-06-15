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
      if (!last || last.lat !== a.lat || last.lon !== a.lon) {
        tr.hist.push({ t: now, lat: a.lat, lon: a.lon });
      }
    }
    this.prune(now);
  }

  /** Resolve the visible set at render time (now - delay), interpolated, with trails. */
  sample(cfg: Config): Visible[] {
    const renderT = Date.now() - RENDER_DELAY_MS;
    const trailMs = Math.max(0, (cfg.trailSeconds ?? 90) * 1000);
    const out: Visible[] = [];
    for (const tr of this.tracks.values()) {
      if (!passesFilter(tr.latest, cfg)) continue;
      const pos = interp(tr.hist, renderT);
      if (!pos) continue;
      const trail: Sample[] = [];
      for (const s of tr.hist) {
        if (s.t >= renderT - trailMs && s.t <= renderT) trail.push(s);
      }
      trail.push({ t: renderT, lat: pos.lat, lon: pos.lon }); // the comet head
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

// Interpolate a position at t from the bracketing samples (clamp at the ends).
function interp(hist: Sample[], t: number): { lat: number; lon: number } | null {
  if (hist.length === 0) return null;
  if (hist.length === 1 || t <= hist[0].t) return hist[0];
  const last = hist[hist.length - 1];
  if (t >= last.t) return last;
  for (let i = hist.length - 1; i > 0; i--) {
    const a = hist[i - 1], b = hist[i];
    if (t >= a.t && t <= b.t) {
      const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
    }
  }
  return last;
}

function passesFilter(a: Aircraft, cfg: Config): boolean {
  if (cfg.hideOnGround && a.onGround) return false;
  const alt = a.altBaro ?? 0;
  if (cfg.minAltitudeFt > 0 && alt < cfg.minAltitudeFt) return false;
  if (cfg.maxAltitudeFt > 0 && alt > cfg.maxAltitudeFt) return false;
  return true;
}
