// Link rail STATIONS — ring + core landmarks whose halo blooms with nearby live-train activity, plus
// the one-shot arrival ring. The LIVE part of the rail render; the static ribbon lives in
// RailLineLayer (baked via StaticOverlayLayer). Stations stay live here so the bloom/arrival animate
// every frame over the baked line. Label-free until tapped. See docs/RAIL-BALANCE.md.
import type { Layer, FrameContext } from "./types";
import { RAIL_STATIONS } from "./rail";
import { liveTrains } from "./livetrains";
import { coreDim } from "./night";

const LINE = "rgba(40,225,170,";              // transit jade (alpha appended) — halo + arrival ring
const STATION_RING = "rgba(40,225,170,0.65)"; // jade outline (dimmed; the stop is a marker, not a glow)

export class RailLayer implements Layer {
  readonly name = "rail-stations";
  private rings: { x: number; y: number; t0: number }[] = []; // one-shot arrival rings at stations
  private lastFire = new Map<string, number>();               // per-station ring cooldown (sec)

  draw(f: FrameContext): void {
    if (!f.cfg.showRail || !RAIL_STATIONS.length) return;
    const ctx = f.ctx, w = f.w, h = f.h;
    const wm = Math.max(1, Math.min(2.2, 1 + 0.22 * ((f.view.mapZoom || 1) - 1)));
    const sr = wm; // stations grow a touch with zoom
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const trains = liveTrains();
    for (const s of RAIL_STATIONS) {
      const p = f.cam.project(s.lat, s.lon);
      if (p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) continue;
      // nearest live train → bloom (within 2 NM) + a one-shot arrival ring (within ~0.3 NM)
      let near = Infinity;
      for (const t of trains) {
        const d = distNMrail(s.lat, s.lon, t.lat, t.lon);
        if (d < near) near = d;
      }
      const prox = near < 2 ? 1 - near / 2 : 0;
      if (near < 0.3 && f.t - (this.lastFire.get(s.name) ?? -999) > 30) {
        this.rings.push({ x: p.x, y: p.y, t0: f.t }); // a train just pulled in — fire one soft ring
        this.lastFire.set(s.name, f.t);
      }
      ctx.beginPath();                                 // halo bloom (breathes up on a real train's approach, peaks below the train)
      ctx.arc(p.x, p.y, 6 * sr * (1 + 0.55 * prox), 0, Math.PI * 2);
      ctx.fillStyle = LINE + (0.14 + 0.22 * prox).toFixed(3) + ")";
      ctx.fill();
      ctx.beginPath();                                 // stroked ring = a deliberate "stop" marker
      ctx.arc(p.x, p.y, 4.6 * sr, 0, Math.PI * 2);
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = STATION_RING;
      ctx.stroke();
      ctx.beginPath();                                 // core — dim jade-white (near-white is reserved for the moving train)
      ctx.arc(p.x, p.y, 2.0 * sr, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(150,235,200,${(0.62 * coreDim()).toFixed(3)})`;
      ctx.fill();
    }
    // Arrival rings: a single slow expanding ring as a train reaches a station — a quiet "bell of
    // light." Rare (30s cooldown/station), low-alpha, no glow.
    this.rings = this.rings.filter((r) => f.t - r.t0 < 1.2);
    for (const r of this.rings) {
      const age = (f.t - r.t0) / 1.2; // 0..1
      ctx.beginPath();
      ctx.arc(r.x, r.y, (5 + 17 * age) * sr, 0, Math.PI * 2);
      ctx.strokeStyle = LINE + (0.5 * (1 - age)).toFixed(3) + ")";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    ctx.restore();
  }
}

// Cheap equirectangular distance in nautical miles — fine for the short station↔train ranges here.
function distNMrail(la1: number, lo1: number, la2: number, lo2: number): number {
  const x = (lo2 - lo1) * Math.cos((((la1 + la2) / 2) * Math.PI) / 180);
  const y = la2 - la1;
  return Math.sqrt(x * x + y * y) * 60;
}
