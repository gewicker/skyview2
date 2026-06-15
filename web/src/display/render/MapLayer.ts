// The basemap layer: tiles rendered once into an offscreen canvas keyed on the view,
// then blitted each frame (so panning/traffic don't re-pay for the basemap). The
// Pi-5 paint budget (HW-TARGET.md) makes this caching mandatory, not optional.
import type { Layer, FrameContext } from "./types";
import { drawTiles, tilesVersion } from "./tiles";

export class MapLayer implements Layer {
  readonly name = "map";
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d", { alpha: false })!;
  private key = "";
  private tilesV = -1;
  private builtAt = 0;

  draw(f: FrameContext): void {
    const cfg = f.cfg;
    const key = [
      cfg.mapCenterLat, cfg.mapCenterLon, cfg.mapZoom, cfg.mapRotationDeg,
      cfg.mapStyle, f.w, f.h, f.dpr,
    ].join("|");
    const tv = tilesVersion();
    const now = performance.now();
    const viewChanged = key !== this.key;
    const tilesArrived = tv !== this.tilesV && now - this.builtAt > 500; // coalesce ~2/s
    if (viewChanged || tilesArrived) {
      const W = Math.max(1, Math.round(f.w * f.dpr));
      const H = Math.max(1, Math.round(f.h * f.dpr));
      if (this.canvas.width !== W) this.canvas.width = W;
      if (this.canvas.height !== H) this.canvas.height = H;
      const sx = this.ctx;
      sx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
      sx.fillStyle = cfg.palette.bg;
      sx.fillRect(0, 0, f.w, f.h);
      const drew = drawTiles(sx, f.cam, f.w, f.h, cfg.mapStyle);
      if (drew && cfg.mapStyle === "satellite") this.gradeSatellite(sx, f.w, f.h);
      this.key = key;
      this.tilesV = tv;
      this.builtAt = now;
    }
    // Blit the device-pixel static canvas under the live traffic.
    const ctx = f.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.canvas, 0, 0);
    ctx.restore();
  }

  // Cinematic night-safe grade for satellite imagery: keep the natural hues but
  // cool + gently darken into the dark-display palette (v1's grade, not a recolor).
  private gradeSatellite(sx: CanvasRenderingContext2D, w: number, h: number): void {
    sx.save();
    sx.globalCompositeOperation = "source-over";
    sx.fillStyle = "rgba(4,8,15,0.30)"; // gentle night darken
    sx.fillRect(0, 0, w, h);
    sx.globalCompositeOperation = "multiply";
    sx.fillStyle = "rgb(168,192,210)"; // cool + mild desaturate, preserves relationships
    sx.fillRect(0, 0, w, h);
    sx.globalCompositeOperation = "color";
    sx.fillStyle = "rgba(38,140,165,0.15)"; // a whisper of teal cohesion
    sx.fillRect(0, 0, w, h);
    sx.globalCompositeOperation = "screen";
    sx.fillStyle = "rgba(8,24,38,0.22)"; // lift shadows a hair → moody, not muddy
    sx.fillRect(0, 0, w, h);
    sx.restore();
  }
}
