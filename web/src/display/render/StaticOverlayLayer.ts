// Caching wrapper for STATIC layers (fixed in world space — runways, taxiways, place
// labels). It bakes the wrapped layers into one offscreen buffer keyed on the view and
// blits that each frame, so their vector + TEXT work runs only when the view settles
// instead of every frame. This is the same cache-and-blit pattern the basemap uses.
//
// Fidelity: at rest the buffer is blitted 1:1 at full device resolution — pixel-identical
// to drawing live (no detail lost). During an active pan/zoom it transform-blits (slides /
// scales with the map, momentarily soft like the basemap) and re-bakes crisp on release.
import type { Layer, FrameContext } from "./types";

interface RView { lat: number; lon: number; zoom: number }

export class StaticOverlayLayer implements Layer {
  readonly name: string;
  private cv = document.createElement("canvas");
  private cx = this.cv.getContext("2d")!; // transparent — composites over the basemap
  private key = "";
  private view: RView | null = null;

  /** `cfgKey` returns a string of any CONFIG that changes what the wrapped layers draw
   *  (toggles, map style…), so the cache re-bakes when those change — the view fields are
   *  already keyed. */
  constructor(private layers: Layer[], private cfgKey: (f: FrameContext) => string = () => "") {
    this.name = "static:" + layers.map((l) => l.name).join("+");
  }

  draw(f: FrameContext): void {
    const v = f.view;
    const key = [
      v.mapCenterLat, v.mapCenterLon, v.mapZoom, f.cfg.mapRotationDeg,
      f.cfg.mirrorX, f.cfg.mirrorY, f.w, f.h, f.dpr, this.cfgKey(f),
    ].join("|");
    // Re-bake only when the view/config changes AND we're settled (a gesture transform-blits
    // the existing buffer; the oversized PAD covers a pan, then it re-bakes on release).
    if (!this.view || (key !== this.key && !f.interacting)) {
      this.bake(f);
      this.key = key;
      this.view = { lat: v.mapCenterLat, lon: v.mapCenterLon, zoom: v.mapZoom };
    }
    // Place/scale the buffer to the live camera (1:1 and centred at rest).
    const c = f.cam.project(this.view.lat, this.view.lon);
    const s = f.view.mapZoom / this.view.zoom;
    const ctx = f.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(c.x * f.dpr, c.y * f.dpr);
    ctx.scale(s, s);
    ctx.drawImage(this.cv, -this.cv.width / 2, -this.cv.height / 2);
    ctx.restore();
  }

  private bake(f: FrameContext): void {
    const PAD = 1.3; // oversize so a pan reveals real content in the margin, not blank
    const PW = Math.round(f.w * PAD), PH = Math.round(f.h * PAD);
    const W = Math.max(1, Math.round(PW * f.dpr)), H = Math.max(1, Math.round(PH * f.dpr));
    if (this.cv.width !== W) this.cv.width = W;
    if (this.cv.height !== H) this.cv.height = H;
    const cx = this.cx;
    cx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
    cx.clearRect(0, 0, PW, PH);
    // Hand the wrapped layers a sub-context that draws into the oversized buffer through a
    // padded camera (same centre/zoom/rotation) so everything registers with the live view.
    const sub: FrameContext = { ...f, ctx: cx, cam: f.cam.withScreen(PW, PH), w: PW, h: PH };
    for (const l of this.layers) l.draw(sub);
  }
}
