// The render loop + interaction surface. Builds one Camera per frame from the live
// config (or a transient pan/zoom override during interaction), computes the
// interpolated visible set once, and hands a FrameContext to each layer.
import { Camera, llToWorld, worldToLL } from "./mercator";
import { TrackStore } from "./TrackStore";
import { pickStatic } from "./navdata";
import { liveTrains } from "./livetrains";
import { liveBuses } from "./livebuses";
import { liveFerries } from "./liveferries";
import { RAIL_STATIONS } from "./rail";
import type { Layer, Visible } from "./types";
import type { Aircraft, Config } from "@shared/types";

// A tapped transit element (train / bus / station / ferry) — drives the transit detail card.
export type TransitPick =
  | { kind: "station"; title: string }
  | { kind: "train"; line: string; devSec: number }
  | { kind: "bus" }
  | { kind: "ferry"; title: string; route: string; atDock: boolean; speed: number };

const MILE_M = 1609.34;

interface View {
  mapCenterLat: number;
  mapCenterLon: number;
  mapZoom: number;
}

export class Renderer {
  private raf = 0;
  private prev = 0;
  private store = new TrackStore();
  private w = 0;
  private h = 0;
  private dpr = 1;
  private nextDue = 0;
  private layers: Layer[] = [];
  private ctx: CanvasRenderingContext2D;
  private lastCam: Camera | null = null;
  private override: View | null = null;     // transient view during pan/zoom
  private selectedHex = "";
  private selectedNav = "";                  // tapped navaid/fix/final id
  private lastVisible: Visible[] = [];       // visible set from the last draw (reused by hit-tests)
  private spotDismissAt = 0;                  // last "dismiss overhead card" tap
  private cardOpen = false;                   // a DOM detail card (aircraft/transit) is open
  private releaseTimer = 0;
  private lastInteractAt = 0;                // for the uncap + low-detail window

  constructor(
    private canvas: HTMLCanvasElement,
    private getConfig: () => Config,
  ) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
    this.resize();
  }

  use(layer: Layer): void { this.layers.push(layer); }

  start(): void {
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const interacting = now - this.lastInteractAt < 220;
      if (interacting) {
        this.nextDue = 0; // uncapped during a gesture (smooth pan on fast displays)
      } else {
        const fps = this.getConfig().maxFps;
        if (fps > 0) {
          const interval = 1000 / fps;
          if (this.nextDue === 0) this.nextDue = now;
          if (now < this.nextDue) return;
          this.nextDue += interval;
          if (now - this.nextDue > interval) this.nextDue = now + interval;
        }
      }
      this.draw(now, interacting);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop(): void { cancelAnimationFrame(this.raf); }

  update(aircraft: Aircraft[]): void {
    const c = this.getConfig();
    if (c) this.store.setCenter(c.centerLat, c.centerLon, c.radiusMiles); // arm the sanity gate before ingest
    this.store.ingest(aircraft);
  }

  resize(): void {
    // renderScale lets the Pi kiosk paint below native density (e.g. 0.75 on a 4K
    // panel) — the single biggest framerate lever. Hard-cap at 2 either way.
    const scale = this.getConfig?.()?.renderScale || 1;
    const native = Math.max(1, window.devicePixelRatio || 1);
    this.dpr = clamp(native * scale, 0.5, 2);
    this.w = Math.max(1, this.canvas.clientWidth || window.innerWidth || 1);
    this.h = Math.max(1, this.canvas.clientHeight || window.innerHeight || 1);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  // --- interaction -------------------------------------------------------- //

  /** The effective view: the transient override during a gesture, else config. */
  view(): View {
    if (this.override) return this.override;
    const c = this.getConfig();
    return { mapCenterLat: c.mapCenterLat, mapCenterLon: c.mapCenterLon, mapZoom: c.mapZoom || 1 };
  }

  /** Drag-pan by a pixel delta (content follows the finger). */
  panByPixels(dx: number, dy: number): void {
    this.lastInteractAt = performance.now();
    if (!this.lastCam) return;
    const v = this.view();
    const c = this.lastCam.unproject(this.w / 2 - dx, this.h / 2 - dy);
    this.override = { mapCenterLat: c.lat, mapCenterLon: c.lon, mapZoom: v.mapZoom };
  }

  /** Zoom by a factor, keeping the point under (px,py) fixed. */
  zoomAt(factor: number, px: number, py: number): void {
    this.lastInteractAt = performance.now();
    const v = this.view();
    let lat = v.mapCenterLat, lon = v.mapCenterLon;
    if (this.lastCam) {
      const cur = this.lastCam.unproject(px, py);
      const curW = llToWorld(cur.lat, cur.lon);
      const cW = llToWorld(lat, lon);
      const n = worldToLL(curW.x + (cW.x - curW.x) / factor, curW.y + (cW.y - curW.y) / factor);
      lat = n.lat; lon = n.lon;
    }
    this.override = { mapCenterLat: lat, mapCenterLon: lon, mapZoom: clamp(v.mapZoom * factor, 0.3, 14) };
  }

  /** Nearest aircraft to a screen point within a tap threshold, or null. */
  pickAt(px: number, py: number): string | null {
    if (!this.lastCam) return null;
    const vis = this.lastVisible; // reuse the last frame's set — don't re-run sample() (mutates the smoother)
    let best: string | null = null;
    let bestD = 26 * 26;
    for (const a of vis) {
      const p = this.lastCam.project(a.lat, a.lon);
      const d = (p.x - px) ** 2 + (p.y - py) ** 2;
      if (d < bestD) { bestD = d; best = a.hex; }
    }
    return best;
  }

  select(hex: string | null): void { this.selectedHex = hex || ""; }
  selectNav(id: string | null): void { this.selectedNav = id || ""; }
  /** Tell the renderer whether a DOM detail card is currently open, so the spotlight
   *  layer can suppress its canvas placard and never paint over it. */
  setCardOpen(open: boolean): void { this.cardOpen = open; }
  /** Dismiss the auto overhead (spotlight) card for whoever is featured right now. */
  dismissSpotlight(): void { this.spotDismissAt = performance.now(); }
  getView(): View { return this.view(); }

  /** Nearest tappable static feature (navaid/fix/final) to a screen point, honoring
   *  the overlay toggles. Returns its id or null. Used for tap-to-reveal. */
  pickStatic(px: number, py: number): string | null {
    if (!this.lastCam) return null;
    const cam = this.lastCam;
    const cfg = this.getConfig();
    return pickStatic((lat, lon) => cam.project(lat, lon), px, py, !!cfg.showNavaids, !!cfg.showProcedures);
  }

  /** Nearest tappable transit element (live train, live bus, or rail station) to a screen point,
   *  honoring the rail/bus toggles. Returns a snapshot for the detail card, or null. */
  pickTransit(px: number, py: number): TransitPick | null {
    if (!this.lastCam) return null;
    const cam = this.lastCam;
    const cfg = this.getConfig();
    let best: TransitPick | null = null;
    let bestD = 28 * 28; // tap radius (px²) — forgiving for small transit markers
    const consider = (lat: number, lon: number, make: () => TransitPick) => {
      const p = cam.project(lat, lon);
      const d = (p.x - px) ** 2 + (p.y - py) ** 2;
      if (d < bestD) { bestD = d; best = make(); }
    };
    if (cfg.showRail) {
      for (const t of liveTrains()) consider(t.lat, t.lon, () => ({ kind: "train", line: t.line, devSec: t.devSec }));
      for (const s of RAIL_STATIONS) consider(s.lat, s.lon, () => ({ kind: "station", title: s.name }));
    }
    if (cfg.showBuses) {
      for (const b of liveBuses()) consider(b.lat, b.lon, () => ({ kind: "bus" }));
    }
    if (cfg.showFerries) {
      for (const fr of liveFerries()) consider(fr.lat, fr.lon, () => ({ kind: "ferry", title: fr.name, route: fr.route, atDock: fr.atDock, speed: fr.speed }));
    }
    return best;
  }

  /** Is this aircraft still tracked AND within (a margin of) the viewport? Used to
   *  auto-despawn the tap card when a contact leaves range or is panned off-screen. */
  onScreen(hex: string): boolean {
    if (!this.lastCam) return true;
    const a = this.lastVisible.find((x) => x.hex === hex);
    if (!a) return false; // gone from the feed (out of range)
    const p = this.lastCam.project(a.lat, a.lon);
    const m = 40;
    return p.x >= -m && p.x <= this.w + m && p.y >= -m && p.y <= this.h + m;
  }

  /** Safety net only: drop the transient override if a committed view never lands in config.
   *  The primary release is in draw() the instant config matches the override (no snap-back). */
  scheduleRelease(ms = 3000): void {
    clearTimeout(this.releaseTimer);
    this.releaseTimer = window.setTimeout(() => { this.override = null; }, ms);
  }

  // --- draw --------------------------------------------------------------- //

  private draw(now: number, interacting = false): void {
    const cfg = this.getConfig();
    if (!cfg) return;
    // Release the gesture override the instant the committed view has propagated into config
    // (kiosk patches round-trip over WS; web is a React re-render). Clearing on a blind timer
    // let the map snap back to the pre-commit view for a frame — the "rubberband".
    if (this.override && viewMatches(this.override, cfg)) this.override = null;
    const dt = this.prev ? (now - this.prev) / 1000 : 0.016;
    this.prev = now;
    if (this.canvas.clientWidth !== this.w || this.canvas.clientHeight !== this.h) this.resize();

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = cfg.palette.bg;
    ctx.fillRect(0, 0, this.w, this.h);

    let v = this.view();
    // Follow mode: keep the tapped aircraft centered (center only — zoom level still adjusts).
    // Uses last frame's resolved position (1-frame lag, imperceptible). Zoom works while
    // following; pan yields to the follow, so to roam freely turn Follow off or deselect.
    if (cfg.followSelected && this.selectedHex) {
      const a = this.lastVisible.find((x) => x.hex === this.selectedHex);
      if (a) v = { mapCenterLat: a.lat, mapCenterLon: a.lon, mapZoom: v.mapZoom };
    }
    const cam = new Camera({
      centerLat: v.mapCenterLat, centerLon: v.mapCenterLon,
      zoom: this.zoomForMapZoom(v.mapZoom), rotationDeg: cfg.mapRotationDeg,
      mirrorX: cfg.mirrorX, mirrorY: cfg.mirrorY,
      screenW: this.w, screenH: this.h,
    });
    this.lastCam = cam;

    const visible = this.store.sample(cfg);
    this.lastVisible = visible; // hit-tests (pickAt/onScreen) reuse this instead of re-sampling
    const f = {
      ctx, cam, cfg, t: now / 1000, dt, w: this.w, h: this.h, dpr: this.dpr,
      aircraft: visible, view: v, selectedHex: this.selectedHex || undefined,
      selectedNavId: this.selectedNav || undefined,
      spotDismissAt: this.spotDismissAt || undefined, interacting,
      cardOpen: this.cardOpen || undefined,
    };
    for (const l of this.layers) l.draw(f);
  }

  private zoomForMapZoom(mapZoom: number): number {
    const spanMi = 16 / (mapZoom || 1);
    const worldSpan = (spanMi * MILE_M) / (2 * Math.PI * 6378137);
    const z = Math.log2(Math.max(1, this.w) / (256 * worldSpan));
    return Number.isFinite(z) ? z : 0; // never feed NaN/Inf into the camera scale
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// True once a committed gesture view has landed in config — used to release the transient
// override seamlessly (no rubberband) instead of on a blind timer.
function viewMatches(v: View, c: Config): boolean {
  return Math.abs(v.mapCenterLat - c.mapCenterLat) < 1e-5 &&
         Math.abs(v.mapCenterLon - c.mapCenterLon) < 1e-5 &&
         Math.abs(v.mapZoom - (c.mapZoom || 1)) < 1e-3;
}
