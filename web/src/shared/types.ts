// Hand-written mirror of the Go structs in internal/{config,aircraft,msg}. This is
// the single contract between server and client; `make types` will eventually
// generate web/src/shared/generated/* from the Go source to replace this file.

export type Skin = "ambient" | "map";
export type MapStyle = "satellite" | "wire" | "dark";
export type GridOverlay = "off" | "rings" | "grid";
export type MonitorMode = "day" | "night" | "red" | "lightsout";
export type TrailMode = "flat" | "altitude" | "climb";
export type LabelDensity = "all" | "nearestN" | "nearestOnly";

export interface Palette {
  bg: string; glyph: string; trail: string; accent: string;
  warn: string; grid: string; text: string;
}
export interface Fonts { label: string; mono: string }
export interface ShowFields {
  airline: boolean; flight: boolean; type: boolean; altitude: boolean;
  speed: boolean; verticalRate: boolean; destination: boolean; registration: boolean;
}

export interface Config {
  centerLat: number; centerLon: number; radiusMiles: number;
  zoom: number; viewOffsetEastMiles: number; viewOffsetNorthMiles: number;
  mapZoom: number; mapCenterLat: number; mapCenterLon: number; mapRotationDeg: number;
  rotationDeg: number; mirrorX: boolean; mirrorY: boolean; labelRotationDeg: number;
  minAltitudeFt: number; maxAltitudeFt: number; hideOnGround: boolean;
  interpolate: boolean; maxExtrapolationSec: number; staleSec: number;
  maxFps: number; renderScale: number;
  skin: Skin; mapStyle: MapStyle; gridOverlay: GridOverlay;
  palette: Palette; fonts: Fonts; glyphSizePx: number; altitudeColor: boolean;
  trailMode: TrailMode; trailSeconds: number; trailBoost: number; brightness: number;
  labelDensity: LabelDensity; nearestN: number; showFields: ShowFields;
  rangeRings: boolean; compass: boolean; showAirport: boolean; showApproaches: boolean;
  showFinal: boolean; showTraffic: boolean; showHome: boolean; showHud: boolean;
  showRelative: boolean; highlightEmergency: boolean; showNotable: boolean;
  notableFlash: boolean; notableWebhook: string; showWinds: boolean; showPhotos: boolean;
  showDestArc: boolean; showRouteDetail: boolean; burnInOrbit: boolean;
  showSpotlight: boolean; spotlightRadiusMi: number; spotlightLat: number; spotlightLon: number;
  showStars: boolean; showSun: boolean; showMoon: boolean; showSatellites: boolean;
  starMagLimit: number; skyTimeOffsetMin: number;
  monitorMode: MonitorMode; lightsOutHour: number; showCursor: boolean;
}

export interface Aircraft {
  hex: string; flight?: string; lat?: number; lon?: number;
  altBaro?: number; altGeom?: number; gs?: number; track?: number; baroRate?: number;
  squawk?: string; seen: number;
  onGround?: boolean; category?: string; selAlt?: number;
  fmsAlt?: number; selHeading?: number; navQNH?: number; navModes?: string[];
  windSpd?: number; windDir?: number; oat?: number;
  typeCode?: string; typeName?: string; airline?: string; registration?: string;
  origin?: string; destination?: string; originName?: string; destName?: string;
  originLat?: number; originLon?: number; destLat?: number; destLon?: number;
}

export interface SourceStatus { ok: boolean; source: string; count: number; message?: string }
export interface SceneMeta { name: string }
export interface NotableEvent { hex: string; flight?: string; reason: string; at: number }

export type ServerMessage =
  | { type: "config"; config: Config }
  | { type: "aircraft"; now: number; aircraft: Aircraft[] }
  | { type: "status"; status: SourceStatus }
  | { type: "scenes"; scenes: SceneMeta[] }
  | { type: "notable"; notable: NotableEvent[] }
  | { type: "pong" };

export type ClientMessage =
  | { type: "hello"; role: "display" | "control" }
  | { type: "patchConfig"; patch: Partial<Config> }
  | { type: "resetConfig" }
  | { type: "saveScene"; name: string; config?: Config }
  | { type: "applyScene"; name: string }
  | { type: "deleteScene"; name: string }
  | { type: "ping" };
