import type { Camera } from "./mercator";
import type { Aircraft, Config } from "@shared/types";

// One timestamped position sample in a track's history (alt for climb/descent
// trail colouring).
export interface Sample { t: number; lat: number; lon: number; alt?: number | null }

// An aircraft resolved at render time: its latest fields, an interpolated position,
// and the recent trail (newest last) for the comet.
export interface Visible extends Aircraft {
  lat: number;
  lon: number;
  trail: Sample[];
}

// Per-frame context handed to every layer. Carries the single Camera, the config,
// the clock, and the once-computed visible-aircraft set — so layers never each
// recompute culling.
export interface FrameContext {
  ctx: CanvasRenderingContext2D;
  cam: Camera;
  cfg: Config;
  t: number;   // seconds clock
  dt: number;  // seconds since last frame
  w: number;
  h: number;
  dpr: number;
  aircraft: Visible[];
  /** The effective view this frame (config OR the live pan/zoom override) — layers
   *  that cache on the view (the basemap) MUST key on this, not on config, so they
   *  stay registered with the traffic during a gesture. */
  view: { mapCenterLat: number; mapCenterLon: number; mapZoom: number };
  /** Manually selected aircraft (tap), if any — the spotlight pins to it. */
  selectedHex?: string;
  /** Manually selected static feature (navaid/fix/final) id, if any — the navaid &
   *  procedure layers draw its highlight + detail card. */
  selectedNavId?: string;
  /** True while a pan/zoom gesture is active — layers render low-detail (skip the
   *  expensive per-segment trails) and the loop runs uncapped for smoothness. */
  interacting?: boolean;
}

// A render layer. GL-ready by design: a layer can later swap its draw() to a WebGL
// implementation without touching the others (Camera + FrameContext stay the same).
export interface Layer {
  readonly name: string;
  draw(f: FrameContext): void;
}
