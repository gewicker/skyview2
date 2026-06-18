// Per-aircraft motion model. v1's smoothing, faithfully: each fix is stamped with
// its arrival time, the display renders ~1.15 s in the PAST, and positions are
// INTERPOLATED between the two bracketing real fixes (not extrapolated from "now").
// That's what makes 1 Hz traffic glide instead of snap. History lives here on the
// client; the server keeps none.
import type { Aircraft, Config } from "@shared/types";
import type { Sample, Visible } from "./types";

const RENDER_DELAY_MS = 1200; // render ~1.2 s behind the measurement timeline — interpolate
                              // between real fixes when we can; dead-reckon past the newest
const LOST_BEGIN = 12000;     // unheard this long ⇒ declare the contact lost and start the fade
const LOST_FADE_MS = 3000;    // fade duration; after this it stops drawing (track kept until prune)
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
  rej?: { lat: number; lon: number }; // last teleport-rejected fix (for the 2-fix corroboration)
}

const SMOOTH_TAU = 0.2; // s — low-pass time constant; damps the per-fix kink, GPS jitter, and
                        // eases prediction corrections so nothing snaps (higher = smoother/softer)

export class TrackStore {
  private tracks = new Map<string, Track>();
  // Local-area centre + a sanity radius (captured from cfg in sample()) used to reject
  // erroneous positions a transponder emits before GPS lock.
  private cLat = 0;
  private cLon = 0;
  private haveCenter = false;
  private sanityMi = 400;

  /** Set the local-area centre eagerly (before the first render), so ingest's position sanity
   *  gate is armed from the very first feed frame — otherwise an initial bad fix slips in. */
  setCenter(lat: number, lon: number, radiusMi: number): void {
    this.cLat = lat;
    this.cLon = lon;
    this.haveCenter = true;
    this.sanityMi = Math.max(250, (radiusMi || 22) * 5);
  }

  /** Ingest a snapshot: stamp each fix with arrival time, dedupe repeats. */
  ingest(list: Aircraft[]): void {
    const now = Date.now();
    for (const a of list) {
      if (a.lat == null || a.lon == null) continue;
      // Suppress erroneous pre-GPS-lock positions. A transponder powering up at the airport
      // often emits 0,0 (null island) or a continental default before its GPS locks, which
      // makes the contact pop up off-map and then jump to its real spot. Reject implausible
      // fixes outright so the contact only appears once it reports a real local position.
      if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)) continue;
      if (Math.abs(a.lat) < 0.02 && Math.abs(a.lon) < 0.02) continue;                 // 0,0 null island
      if (a.lat < -89.9 || a.lat > 89.9 || a.lon < -180 || a.lon > 180) continue;     // out of range
      // Physical-plausibility gate: a sample that's impossible for a real aircraft is a decode
      // glitch (N655WH showed -175 ft / 400 kt on the Renton surface). Drop it so a garbage frame
      // can't spawn or jolt a ghost; a known track just holds its last good fix. Altitude is only
      // judged when actually reported, so a high jet with a momentarily-null altitude isn't culled.
      {
        const gsKt = a.gs ?? 0;
        const altKnown = a.altBaro != null || a.altGeom != null;
        const altF = a.altBaro ?? a.altGeom ?? 0;
        if (gsKt > 800 || (altKnown && gsKt > 250 && altF < 1000)) { // nothing civil does 400 kt on the deck
          const ex = this.tracks.get(a.hex);
          if (ex) ex.lastSeen = now; // keep a known track alive; hold its last good position
          continue;
        }
      }
      if (this.haveCenter) {
        const dMi = Math.hypot(a.lat - this.cLat, (a.lon - this.cLon) * Math.cos(this.cLat * DEG)) * 69;
        if (dMi > this.sanityMi) continue;                                            // implausibly far
      }
      let tr = this.tracks.get(a.hex);
      if (tr) {
        // Teleport rejection: a fix that jumps impossibly far from the last good position is a
        // decode glitch — reject it. BUT a lone outlier must never wedge the track forever: if a
        // SECOND consecutive fix corroborates the new spot, the stored anchor was the bad one, so
        // re-anchor there. And ALWAYS keep the track alive (advance lastSeen) on a reject, so a
        // wedged track doesn't prune-and-respawn every 30 s.
        const lastH = tr.hist[tr.hist.length - 1];
        if (lastH) {
          const jMi = Math.hypot(a.lat - lastH.lat, (a.lon - lastH.lon) * Math.cos(lastH.lat * DEG)) * 69;
          const dtH = Math.max(1 / 3600, (now - tr.lastSeen) / 3600000); // hours, min ~1 s
          if (jMi / dtH > 2500) {
            const corroborated = tr.rej &&
              Math.hypot(a.lat - tr.rej.lat, (a.lon - tr.rej.lon) * Math.cos(a.lat * DEG)) * 69 < 1;
            if (corroborated) {
              tr.hist.length = 0; // two rejects agree → the old anchor was wrong, adopt the new spot
              tr.rej = undefined;
              tr.rLat = tr.rLon = tr.rT = undefined; // snap, don't glide across
            } else {
              tr.rej = { lat: a.lat, lon: a.lon };
              tr.lastSeen = now; // still being heard — keep alive, don't prune-respawn
              continue;
            }
          } else {
            tr.rej = undefined; // a normal fix clears any pending reject
          }
        }
      } else {
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
    // Capture the local-area centre + a generous sanity radius for ingest's position gate.
    this.cLat = cfg.centerLat; this.cLon = cfg.centerLon; this.haveCenter = true;
    this.sanityMi = Math.max(250, (cfg.radiusMiles || 22) * 5);
    const renderT = Date.now() - RENDER_DELAY_MS;
    const baseMs = Math.max(0, (cfg.trailSeconds ?? 90) * 1000);
    const out: Visible[] = [];
    const wall = Date.now();
    for (const tr of this.tracks.values()) {
      if (!passesFilter(tr.latest, cfg)) continue;
      // Contact-lost fade: once a track hasn't been heard for LOST_BEGIN, play a brief fade
      // (still emitted, frozen at its last real fix) then stop drawing it — but keep the track
      // alive until prune so a re-acquired contact resumes instead of respawning.
      const goneMs = wall - tr.lastSeen;
      if (goneMs > LOST_BEGIN + LOST_FADE_MS) continue; // faded out
      const target = predictPos(tr.hist, tr.latest, renderT);
      if (!target) continue;
      // Critically-damped low-pass toward the (linear) target: smooths the per-fix
      // heading kink and GPS jitter without overshoot. A large gap (reacquired track)
      // gives alpha→1, i.e. it snaps rather than drifting. Advanced once per render tick.
      // When "Smooth motion" (cfg.interpolate) is OFF, snap straight to the latest raw fix.
      let pos = target;
      if (cfg.interpolate === false) {
        pos = { lat: tr.latest.lat ?? target.lat, lon: tr.latest.lon ?? target.lon };
      } else if (tr.rLat != null && tr.rLon != null && tr.rT != null && renderT > tr.rT) {
        // SNAP a large positional correction instead of gliding across the map: the low-pass is
        // meant to smooth per-fix jitter, not animate a teleport/re-anchor from wrong→right.
        const jumpM = Math.hypot(target.lat - tr.rLat, (target.lon - tr.rLon) * Math.cos(target.lat * DEG)) * 111320;
        const plausM = 120 + (tr.latest.gs ?? 0) * 0.514444 * ((renderT - tr.rT) / 1000) * 2;
        if (jumpM > plausM && jumpM > 400) {
          pos = target;
        } else {
          const alpha = 1 - Math.exp(-(renderT - tr.rT) / 1000 / SMOOTH_TAU);
          pos = { lat: tr.rLat + (target.lat - tr.rLat) * alpha, lon: tr.rLon + (target.lon - tr.rLon) * alpha };
        }
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
      if (goneMs > LOST_BEGIN) {
        v.lost = (goneMs - LOST_BEGIN) / LOST_FADE_MS; // 0..1
        const lastFix = tr.hist[tr.hist.length - 1]; // freeze at the last real position (no ghost drift)
        if (lastFix) { v.lat = lastFix.lat; v.lon = lastFix.lon; }
      }
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
      // Ground motion is predicted in two regimes so a landing ROLLOUT and a slow TAXI turn
      // are each smooth and predictable, instead of both coasting on one noisy segment:
      const gs = a.gs ?? 0;
      const age = t - last.t;
      if (gs < 3 || hist.length < 2) return { lat: last.lat, lon: last.lon }; // parked — pin
      if (gs >= 30 && a.track != null) {
        // Rollout / fast taxi: the reported ground track is reliable at speed, so dead-reckon
        // straight along it. Capped SHORT (1.2 s) — just enough to bridge the gap to the next
        // fix without over-running it, so a deceleration/turn doesn't snap the glyph back.
        return deadReckon(last, gs, a.track, Math.min(age, 1200));
      }
      // Slow taxi: the reported track is unreliable at low speed, so coast along the AVERAGED
      // recent ground path (a ~1.6 s window) for a stable heading. Forward coast is capped
      // SHORT (0.6 s): slow taxi is stop-and-go, and over-predicting past a hold-short is what
      // produces the "rubberband" snap-back. A short coast keeps motion smooth without overshoot;
      // the low-pass in sample() absorbs the small remaining correction.
      let ref = hist[hist.length - 2];
      for (let i = hist.length - 2; i >= 0; i--) {
        ref = hist[i];
        if (last.t - hist[i].t >= 1600) break;
      }
      const span = last.t - ref.t;
      if (span <= 0) return { lat: last.lat, lon: last.lon };
      // If it barely moved over the window it's parked/idling (GPS jitter, not taxi) — pin it
      // rather than coasting along noise. Catches the gs 3–10 kt jitter the gs<3 pin misses.
      const moveM = Math.hypot(last.lat - ref.lat, (last.lon - ref.lon) * Math.cos(last.lat * DEG)) * 111320;
      if (moveM < 8) return { lat: last.lat, lon: last.lon };
      const k = Math.min(age, 600) / span;
      return { lat: last.lat + (last.lat - ref.lat) * k, lon: last.lon + (last.lon - ref.lon) * k };
    }
    // Slow airborne traffic: the reported track is unreliable at low speed and fixes are sparser,
    // so dead-reckoning along it overshoots and the next fix snaps it back (rubberband). Hold a very
    // slow / hovering contact at its last fix; cap the coast short for slow GA; only fast traffic
    // (reliable track) coasts the full window.
    const gs = a.gs ?? 0;
    if (gs < 30) return { lat: last.lat, lon: last.lon };
    return deadReckon(last, gs, a.track, Math.min(t - last.t, gs >= 120 ? 10000 : 2500));
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
