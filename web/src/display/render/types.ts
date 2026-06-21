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
  // A recent takeoff/landing (onGround flip), expressed in RENDER-clock age (ms since
  // the event as the *delayed* render reaches it) so the morph/flourish stay in sync
  // with the shown position. transitGround: true = just landed, false = just took off.
  transitAge?: number;
  transitGround?: boolean;
  transitLat?: number;
  transitLon?: number;
  // 0..1 fade progress once the contact has dropped from the feed (signal lost). Frozen at the
  // last real position; the aircraft layer plays a "lost contact" fade + notation over this.
  lost?: number;
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
  /** The aircraft the spotlight is auto-featuring this frame (published by SpotlightLayer, read one
   *  frame later). Promoted to the authentic strobe double-flash + landing beam like a manual tap. */
  featuredHex?: string;
  /** Manually selected static feature (navaid/fix/final) id, if any — the navaid &
   *  procedure layers draw its highlight + detail card. */
  selectedNavId?: string;
  /** Timestamp of the last "dismiss the overhead card" tap (tap on empty space). The
   *  spotlight layer suppresses its auto placard for the aircraft featured at that moment
   *  until a different one comes overhead. */
  spotDismissAt?: number;
  /** True while a pan/zoom gesture is active — layers render low-detail (skip the
   *  expensive per-segment trails) and the loop runs uncapped for smoothness. */
  interacting?: boolean;
  /** True while a DOM detail card (aircraft tap-card or transit tap-card) is open. The
   *  spotlight layer suppresses its auto overhead placard so the canvas never repaints
   *  over a DOM card. */
  cardOpen?: boolean;
  /** The tapped ferry (vessel id) whose crossing lane the FerryRouteLayer draws, if any. */
  selectedFerryId?: number;
  /** The tapped bus (vehicle id) whose route shape the BusRouteLayer draws, if any. */
  selectedBusId?: string;
}

// A render layer. GL-ready by design: a layer can later swap its draw() to a WebGL
// implementation without touching the others (Camera + FrameContext stay the same).
export interface Layer {
  readonly name: string;
  draw(f: FrameContext): void;
}

// A tapped transit element (train / bus / station / ferry / fire) — drives the transit detail card.
export type TransitPick =
  | { kind: "station"; title: string }
  | { kind: "train"; id: string; line: string; devSec: number }
  | { kind: "bus"; id: string; route: string; headsign: string }
  | { kind: "ferry"; id: number; title: string; route: string; atDock: boolean; speed: number }
  | { kind: "fire"; id: string; title: string; address: string; time: number };

// Pluggable transit hit-testing. The render CORE (Renderer) stays free of the transit feature
// modules (rail/bus/ferry/fire stores) — a surface that wants transit tap-to-reveal injects an
// implementation via Renderer.setTransitHitTest(); a surface that doesn't (the airport view) simply
// never registers one, so its bundle never pulls the transit geometry. See docs/V6-ARCHITECTURE-PLAN.md.
export interface TransitHitTest {
  /** Nearest tappable transit element to a screen point, honoring the feed toggles, or null. */
  pick(project: (lat: number, lon: number) => { x: number; y: number }, px: number, py: number, cfg: Config): TransitPick | null;
  /** The current position of a previously-picked element, or null if it has dropped from its feed. */
  resolve(pick: TransitPick): { lat: number; lon: number } | null;
}
