// The transit tap-to-reveal + despawn hit-test, as an injectable provider (see types.ts
// TransitHitTest). This is the ONE place that couples hit-testing to the live transit feeds
// (rail/bus/ferry/fire); the render core (Renderer) no longer imports them, so a surface that
// doesn't register this — the airport view — keeps the transit geometry out of its bundle.
// Behaviour is identical to the logic that previously lived inline in Renderer.
import { liveTrains } from "./livetrains";
import { liveBuses } from "./livebuses";
import { liveFerries } from "./liveferries";
import { fireIncidents } from "./livefire";
import { RAIL_STATIONS } from "./rail";
import type { TransitHitTest, TransitPick } from "./types";

export const transitHitTest: TransitHitTest = {
  pick(project, px, py, cfg) {
    let best: TransitPick | null = null;
    let bestD = 28 * 28; // tap radius (px²) — forgiving for small transit markers
    const consider = (lat: number, lon: number, make: () => TransitPick) => {
      const p = project(lat, lon);
      const d = (p.x - px) ** 2 + (p.y - py) ** 2;
      if (d < bestD) { bestD = d; best = make(); }
    };
    if (cfg.showRail) {
      for (const t of liveTrains()) consider(t.lat, t.lon, () => ({ kind: "train", id: t.id, line: t.line, devSec: t.devSec }));
      for (const s of RAIL_STATIONS) consider(s.lat, s.lon, () => ({ kind: "station", title: s.name }));
    }
    if (cfg.showBuses) {
      for (const b of liveBuses()) consider(b.lat, b.lon, () => ({ kind: "bus", id: b.id, route: b.route, headsign: b.headsign }));
    }
    if (cfg.showFerries) {
      for (const fr of liveFerries()) consider(fr.lat, fr.lon, () => ({ kind: "ferry", id: fr.id, title: fr.name, route: fr.route, atDock: fr.atDock, speed: fr.speed }));
    }
    if (cfg.showFireEms) {
      for (const inc of fireIncidents()) consider(inc.lat, inc.lon, () => ({ kind: "fire", id: inc.id, title: inc.type, address: inc.address, time: inc.time }));
    }
    return best;
  },

  resolve(pick) {
    let pos: { lat: number; lon: number } | undefined;
    switch (pick.kind) {
      case "station": pos = RAIL_STATIONS.find((s) => s.name === pick.title); break;
      case "train":   pos = liveTrains().find((t) => t.id === pick.id); break;
      case "bus":     pos = liveBuses().find((b) => b.id === pick.id); break;
      case "ferry":   pos = liveFerries().find((v) => v.id === pick.id); break;
      case "fire":    pos = fireIncidents().find((i) => i.id === pick.id); break;
    }
    return pos ?? null;
  },
};
