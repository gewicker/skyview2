// The basemap layer. Tiles + grade + cinematic glow/vignette + range rings are
// rasterized once into an offscreen canvas, then blitted each frame. During a
// pan/zoom GESTURE the view changes every frame — re-rasterizing that fast is far
// too heavy (esp. on the Pi), so we instead TRANSFORM the cached canvas (one cheap
// drawImage, scaled + translated to the live camera) and only re-rasterize once the
// view settles. That keeps the basemap locked to the traffic AND fast.
import type { Layer, FrameContext } from "./types";
import { drawTiles, tilesVersion } from "./tiles";

interface RView { mapCenterLat: number; mapCenterLon: number; mapZoom: number }

export class MapLayer implements Layer {
  readonly name = "map";
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d", { alpha: false })!;
  private renderedView: RView | null = null;
  private renderedFixed = ""; // style + rotation + size + dpr the canvas was built at
  private renderedKey = "";
  private tilesV = -1;
  private builtAt = 0;

  draw(f: FrameContext): void {
    const cfg = f.cfg;
    const now = performance.now();
    const key = [f.view.mapCenterLat, f.view.mapCenterLon, f.view.mapZoom, cfg.mapRotationDeg, cfg.mapStyle, f.w, f.h, f.dpr].join("|");
    const fixed = [cfg.mapStyle, cfg.mapRotationDeg, f.w, f.h, f.dpr].join("|");

    const forced = !this.renderedView || fixed !== this.renderedFixed;
    // Re-rasterize at most ~5×/sec while the view differs — so the map crisps up and
    // pulls new-zoom tiles DURING the gesture, not only after it settles.
    const throttleOk = now - this.builtAt > 180;
    const tilesArrived = tilesVersion() !== this.tilesV && now - this.builtAt > 300;
    if (forced || (key !== this.renderedKey && throttleOk) || tilesArrived) {
      this.rasterize(f);
      this.renderedView = { mapCenterLat: f.view.mapCenterLat, mapCenterLon: f.view.mapCenterLon, mapZoom: f.view.mapZoom };
      this.renderedFixed = fixed;
      this.renderedKey = key;
      this.tilesV = tilesVersion();
      this.builtAt = now;
    }

    if (key === this.renderedKey || !this.renderedView) this.straightBlit(f);
    else this.transformBlit(f); // mid-gesture: cheap transformed blit of the cache
  }

  // Full re-render of the basemap into the offscreen canvas at the current view.
  private rasterize(f: FrameContext): void {
    const cfg = f.cfg;
    const W = Math.max(1, Math.round(f.w * f.dpr));
    const H = Math.max(1, Math.round(f.h * f.dpr));
    if (this.canvas.width !== W) this.canvas.width = W;
    if (this.canvas.height !== H) this.canvas.height = H;
    const sx = this.ctx;
    sx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
    sx.fillStyle = cfg.palette.bg;
    sx.fillRect(0, 0, f.w, f.h);
    const drew = drawTiles(sx, f.cam, f.w, f.h, cfg.mapStyle);
    if (drew) {
      if (cfg.mapStyle === "satellite") this.gradeSatellite(sx, f.w, f.h);
      else this.gradeDark(sx, f.w, f.h);
    }
    this.cinematic(sx, f.w, f.h, cfg.mapStyle === "satellite");
    this.rings(sx, f, cfg);
  }

  private straightBlit(f: FrameContext): void {
    const ctx = f.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.canvas, 0, 0);
    ctx.restore();
  }

  // Blit the cached canvas scaled + translated to the live camera (gesture).
  private transformBlit(f: FrameContext): void {
    const rv = this.renderedView!;
    const c = f.cam.project(rv.mapCenterLat, rv.mapCenterLon); // its centre in the live view
    const s = f.view.mapZoom / rv.mapZoom;
    const ctx = f.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(c.x * f.dpr, c.y * f.dpr);
    ctx.scale(s, s);
    ctx.drawImage(this.canvas, -this.canvas.width / 2, -this.canvas.height / 2);
    ctx.restore();
  }

  private gradeSatellite(sx: CanvasRenderingContext2D, w: number, h: number): void {
    sx.save();
    sx.globalCompositeOperation = "source-over";
    sx.fillStyle = "rgba(4,8,15,0.30)";
    sx.fillRect(0, 0, w, h);
    sx.globalCompositeOperation = "multiply";
    sx.fillStyle = "rgb(168,192,210)";
    sx.fillRect(0, 0, w, h);
    sx.globalCompositeOperation = "color";
    sx.fillStyle = "rgba(38,140,165,0.15)";
    sx.fillRect(0, 0, w, h);
    sx.globalCompositeOperation = "screen";
    sx.fillStyle = "rgba(8,24,38,0.22)";
    sx.fillRect(0, 0, w, h);
    sx.restore();
  }

  private gradeDark(sx: CanvasRenderingContext2D, w: number, h: number): void {
    sx.save();
    sx.globalCompositeOperation = "color";
    const cool = sx.createLinearGradient(0, 0, 0, h);
    cool.addColorStop(0, "rgba(34,150,168,0.85)");
    cool.addColorStop(1, "rgba(28,96,150,0.85)");
    sx.fillStyle = cool;
    sx.fillRect(0, 0, w, h);
    sx.globalCompositeOperation = "screen";
    sx.fillStyle = "rgba(10,40,52,0.5)";
    sx.fillRect(0, 0, w, h);
    sx.restore();
  }

  private cinematic(sx: CanvasRenderingContext2D, w: number, h: number, deep: boolean): void {
    sx.save();
    sx.globalCompositeOperation = "lighter";
    const glow = sx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) * 0.45);
    glow.addColorStop(0, deep ? "rgba(26,86,108,0.18)" : "rgba(22,72,92,0.16)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    sx.fillStyle = glow;
    sx.fillRect(0, 0, w, h);
    sx.globalCompositeOperation = "source-over";
    const vig = sx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.36, w / 2, h / 2, Math.hypot(w, h) * 0.6);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.5)");
    sx.fillStyle = vig;
    sx.fillRect(0, 0, w, h);
    sx.restore();
  }

  private rings(sx: CanvasRenderingContext2D, f: FrameContext, cfg: FrameContext["cfg"]): void {
    const home = f.cam.project(cfg.centerLat, cfg.centerLon);
    const north = f.cam.project(cfg.centerLat + 1 / 69, cfg.centerLon);
    const pxPerMile = Math.hypot(north.x - home.x, north.y - home.y);
    if (!(pxPerMile > 0)) return;
    sx.save();
    sx.strokeStyle = "rgba(125,175,195,0.12)";
    sx.lineWidth = 1;
    const max = Math.max(10, cfg.radiusMiles || 20);
    for (let mi = 5; mi <= max; mi += 5) {
      sx.beginPath();
      sx.arc(home.x, home.y, mi * pxPerMile, 0, Math.PI * 2);
      sx.stroke();
    }
    sx.restore();
  }
}
