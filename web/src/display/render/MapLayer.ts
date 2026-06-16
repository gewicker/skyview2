// The basemap layer. Tiles + grade + cinematic glow/vignette + range rings are
// rasterized once into an offscreen canvas, then blitted each frame. During a
// pan/zoom GESTURE the view changes every frame — re-rasterizing that fast is far
// too heavy (esp. on the Pi), so we instead TRANSFORM the cached canvas (one cheap
// drawImage, scaled + translated to the live camera) and only re-rasterize once the
// view settles. That keeps the basemap locked to the traffic AND fast.
import type { Layer, FrameContext } from "./types";
import type { Camera } from "./mercator";
import { drawTiles, tilesVersion } from "./tiles";

interface RView { mapCenterLat: number; mapCenterLon: number; mapZoom: number }

const FADE_MS = 200; // zoom/tile cross-fade duration on a settled re-raster

export class MapLayer implements Layer {
  readonly name = "map";
  // Two ping-pong buffers so a freshly rasterized (sharp) map can cross-fade IN over the
  // previous one — this is what smooths the zoom "pop" (scaled-blurry → crisp) on settle.
  private cv = [document.createElement("canvas"), document.createElement("canvas")];
  private cx = [this.cv[0].getContext("2d", { alpha: false })!, this.cv[1].getContext("2d", { alpha: false })!];
  private cur = 0; // index of the buffer holding the CURRENT raster
  private renderedView: RView | null = null;
  private renderedFixed = ""; // style + rotation + size + dpr the canvas was built at
  private renderedKey = "";
  private tilesV = -1;
  private builtAt = 0;
  private prevView: RView | null = null; // previous raster's view, for the cross-fade
  private fadeStart = 0;

  draw(f: FrameContext): void {
    const cfg = f.cfg;
    const now = performance.now();
    const key = [f.view.mapCenterLat, f.view.mapCenterLon, f.view.mapZoom, cfg.mapRotationDeg, cfg.mapStyle, f.w, f.h, f.dpr].join("|");
    const fixed = [cfg.mapStyle, cfg.mapRotationDeg, f.w, f.h, f.dpr].join("|");

    const forced = !this.renderedView || fixed !== this.renderedFixed;
    const throttleOk = now - this.builtAt > 110;
    const tilesArrived = tilesVersion() !== this.tilesV && now - this.builtAt > 300;
    // Smooth gestures: while actively panning/zooming we ONLY transform-blit the cached
    // buffer (one cheap drawImage/frame) and re-rasterize solely when it no longer covers
    // the screen — re-tiling the oversized buffer mid-gesture is what made pan/zoom stutter
    // (esp. on 2× web). When the view settles (not interacting) we rasterize once to crisp up.
    let needRaster = forced;
    if (!needRaster && key !== this.renderedKey) {
      needRaster = throttleOk && (f.interacting ? !this.covers(f) : true);
    }
    if (!needRaster && tilesArrived && !f.interacting) needRaster = true;
    // Don't start a non-forced re-raster while a settle dissolve is still running — it would
    // overwrite the ping-pong buffer/prevView the fade is reading and flash. (Gestures set
    // fadeStart=0, so this only guards the at-rest tile top-ups.)
    const fadeActive = this.fadeStart > 0 && now - this.fadeStart < FADE_MS && !f.interacting;
    if (fadeActive) needRaster = forced;
    if (needRaster) {
      const hadPrev = !!this.renderedView;
      this.prevView = this.renderedView; // preserve old view for the cross-fade
      this.cur ^= 1;                      // new raster → other buffer; old kept in the prev one
      this.rasterize(f);
      this.renderedView = { mapCenterLat: f.view.mapCenterLat, mapCenterLon: f.view.mapCenterLon, mapZoom: f.view.mapZoom };
      this.renderedFixed = fixed;
      this.renderedKey = key;
      this.tilesV = tilesVersion();
      this.builtAt = now;
      // Cross-fade only on a SETTLED re-raster (during a gesture we transform-blit and
      // want no double-expose); turns the zoom/tile sharpen into a 200 ms dissolve.
      this.fadeStart = hadPrev && !f.interacting ? now : 0;
    }

    if (!this.renderedView) return;
    const fadeT = this.fadeStart ? (now - this.fadeStart) / FADE_MS : 1;
    if (fadeT < 1 && this.prevView) {
      this.blit(f, this.cv[this.cur ^ 1], this.prevView, 1);                    // old underneath
      this.blit(f, this.cv[this.cur], this.renderedView, 1 - (1 - fadeT) ** 2); // new eases in
    } else {
      this.fadeStart = 0;
      this.blit(f, this.cv[this.cur], this.renderedView, 1);
    }
  }

  // Full re-render of the basemap into the offscreen canvas at the current view.
  // The buffer is oversized (PAD) and rendered through a padded camera so a
  // subsequent zoom-out/pan has real map in the margins instead of empty bg.
  private rasterize(f: FrameContext): void {
    const cfg = f.cfg;
    const PAD = 1.25;
    const PW = Math.round(f.w * PAD), PH = Math.round(f.h * PAD);
    const padCam = f.cam.withScreen(PW, PH);
    const W = Math.max(1, Math.round(PW * f.dpr));
    const H = Math.max(1, Math.round(PH * f.dpr));
    if (this.cv[this.cur].width !== W) this.cv[this.cur].width = W;
    if (this.cv[this.cur].height !== H) this.cv[this.cur].height = H;
    const sx = this.cx[this.cur];
    sx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
    sx.fillStyle = cfg.palette.bg;
    sx.fillRect(0, 0, PW, PH);
    const drew = drawTiles(sx, padCam, PW, PH, cfg.mapStyle);
    if (drew) {
      if (cfg.mapStyle === "satellite") this.gradeSatellite(sx, PW, PH);
      else this.gradeDark(sx, PW, PH);
    }
    this.cinematic(sx, PW, PH, cfg.mapStyle === "satellite");
    this.rings(sx, padCam, cfg);
  }

  // Does the cached (oversized) buffer, transformed to the live camera, still cover the
  // whole viewport? If yes we can keep transform-blitting during the gesture; if it has
  // slid/zoomed past its PAD margin we must re-rasterize to avoid blank edges.
  private covers(f: FrameContext): boolean {
    if (!this.renderedView) return false;
    const rv = this.renderedView;
    const c = f.cam.project(rv.mapCenterLat, rv.mapCenterLon);
    const s = f.view.mapZoom / rv.mapZoom;
    const cv = this.cv[this.cur];
    const halfW = (cv.width / f.dpr) * s / 2; // cached buffer half-size in CSS px
    const halfH = (cv.height / f.dpr) * s / 2;
    const m = 2; // small slack
    return c.x - halfW <= m && c.x + halfW >= f.w - m && c.y - halfH <= m && c.y + halfH >= f.h - m;
  }

  // Draw a buffer placed/scaled to the live camera from the view it was rasterized at (so
  // a buffer from a different zoom appears correctly scaled). At rest this centres the
  // current buffer 1:1; during a gesture it scales/translates it; during a settle fade the
  // previous buffer is drawn under the new one. `alpha` drives the cross-fade.
  private blit(f: FrameContext, canvas: HTMLCanvasElement, view: RView, alpha: number): void {
    const c = f.cam.project(view.mapCenterLat, view.mapCenterLon);
    const s = f.view.mapZoom / view.mapZoom;
    const ctx = f.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (alpha < 1) ctx.globalAlpha = alpha;
    ctx.translate(c.x * f.dpr, c.y * f.dpr);
    ctx.scale(s, s);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
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

  private rings(sx: CanvasRenderingContext2D, cam: Camera, cfg: FrameContext["cfg"]): void {
    const home = cam.project(cfg.centerLat, cfg.centerLon);
    const north = cam.project(cfg.centerLat + 1 / 69, cfg.centerLon);
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
