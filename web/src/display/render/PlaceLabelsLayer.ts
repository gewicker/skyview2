// Curated place labels for the satellite/wire styles (dark keeps baked labels). Drawn
// upright (readable) at each centroid, with a cheap dark outline (no shadowBlur) for
// legibility over imagery.
import type { Layer, FrameContext } from "./types";
import { PLACES } from "./places";

export class PlaceLabelsLayer implements Layer {
  readonly name = "places";

  draw(f: FrameContext): void {
    if (f.cfg.skin !== "map") return;
    const ctx = f.ctx;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    // Fine-grained home-area neighborhood/landmark labels (place.local) only appear once the user
    // has zoomed past the default ~16-mile view (mapZoom 1 → spanMi 16; 1.6 → ~10mi). This keeps
    // the wide ambient view calm/uncluttered while letting the Eastside read richly up close.
    const showLocal = (f.view.mapZoom || 1) >= 1.6;
    for (const pl of PLACES) {
      if (pl.local && !showLocal) continue;
      const p = f.cam.project(pl.lat, pl.lon);
      if (p.x < -60 || p.x > f.w + 60 || p.y < -20 || p.y > f.h + 20) continue;
      ctx.font = pl.major ? "600 13px system-ui, sans-serif" : pl.water ? "italic 11px system-ui, sans-serif" : "500 11px system-ui, sans-serif";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.strokeText(pl.name, p.x, p.y);
      ctx.fillStyle = pl.water ? "rgba(150,194,214,0.85)" : pl.major ? "rgba(228,236,246,0.95)" : "rgba(206,218,232,0.82)";
      ctx.fillText(pl.name, p.x, p.y);
    }
    ctx.restore();
  }
}
