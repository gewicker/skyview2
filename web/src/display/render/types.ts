import type { Camera } from "./mercator";
import type { Aircraft, Config } from "@shared/types";

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
  aircraft: Aircraft[];
}

// A render layer. GL-ready by design: a layer can later swap its draw() to a WebGL
// implementation without touching the others (Camera + FrameContext stay the same).
export interface Layer {
  readonly name: string;
  draw(f: FrameContext): void;
}
