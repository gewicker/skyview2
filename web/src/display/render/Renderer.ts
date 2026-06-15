// The render loop. Builds one Camera per frame from the live config, computes the
// visible-aircraft set once, and hands a FrameContext to each layer in order.
// Canvas2D-first; any Layer can later become WebGL behind the same interface.
//
// Phase 0: a placeholder pipeline (home dot + projected aircraft dots) that proves
// the Web Mercator camera. Real layers (MapLayer, AircraftLayer, Spotlight, …) drop
// in here as they're built.
import { Camera } from "./mercator";
import type { Layer } from "./types";
import type { Aircraft, Config } from "@shared/types";

const MILE_M = 1609.34;

export class Renderer {
  private raf = 0;
  private prev = 0;
  private aircraft: Aircraft[] = [];
  private w = 0;
  private h = 0;
  private dpr = 1;
  private nextDue = 0;
  private layers: Layer[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private getConfig: () => Config,
  ) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
    this.resize();
  }
  private ctx: CanvasRenderingContext2D;

  use(layer: Layer): void { this.layers.push(layer); }

  start(): void {
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const fps = this.getConfig().maxFps;
      if (fps > 0) {
        const interval = 1000 / fps;
        if (this.nextDue === 0) this.nextDue = now;
        if (now < this.nextDue) return;
        this.nextDue += interval;
        if (now - this.nextDue > interval) this.nextDue = now + interval;
      }
      this.draw(now);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop(): void { cancelAnimationFrame(this.raf); }

  update(aircraft: Aircraft[]): void { this.aircraft = aircraft; }

  resize(): void {
    this.dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    this.w = this.canvas.clientWidth || window.innerWidth;
    this.h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  private draw(now: number): void {
    const cfg = this.getConfig();
    const dt = this.prev ? (now - this.prev) / 1000 : 0.016;
    this.prev = now;
    if (this.canvas.clientWidth !== this.w || this.canvas.clientHeight !== this.h) this.resize();

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = cfg.palette.bg;
    ctx.fillRect(0, 0, this.w, this.h);

    const cam = new Camera({
      centerLat: cfg.mapCenterLat, centerLon: cfg.mapCenterLon,
      zoom: this.zoomFor(cfg), rotationDeg: cfg.mapRotationDeg,
      mirrorX: cfg.mirrorX, mirrorY: cfg.mirrorY,
      screenW: this.w, screenH: this.h,
    });

    const visible = this.aircraft.filter((a) => a.lat != null && a.lon != null);
    const f = { ctx, cam, cfg, t: now / 1000, dt, w: this.w, h: this.h, dpr: this.dpr, aircraft: visible };

    if (this.layers.length) {
      for (const l of this.layers) l.draw(f);
    } else {
      this.placeholder(f.aircraft, cam, ctx, cfg);
    }
  }

  // Until real layers land: home beacon + a dot per aircraft, proving the camera.
  private placeholder(visible: Aircraft[], cam: Camera, ctx: CanvasRenderingContext2D, cfg: Config): void {
    for (const a of visible) {
      const p = cam.project(a.lat as number, a.lon as number);
      ctx.fillStyle = cfg.palette.glyph;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const home = cam.project(cfg.centerLat, cfg.centerLon);
    ctx.strokeStyle = cfg.palette.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(home.x, home.y, 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Map the map-radius framing onto a fractional slippy zoom for the camera.
  private zoomFor(cfg: Config): number {
    const spanMi = 16 / (cfg.mapZoom || 1); // ~16 mi across at mapZoom 1
    const spanM = spanMi * MILE_M;
    const worldPerM = 1 / (2 * Math.PI * 6378137);
    const worldSpan = spanM * worldPerM;
    return Math.log2(this.w / (256 * worldSpan));
  }
}
