// Hand-written mirror of the Go structs in internal/{config,aircraft,msg}. This is
// the single contract between server and client; `make types` will eventually
// generate web/src/shared/generated/* from the Go source to replace this file.

export type Skin = "ambient" | "map";
export type MapStyle = "satellite" | "wire";
export type GridOverlay = "off" | "rings" | "grid";
export type MonitorMode = "day" | "night" | "red" | "lightsout";
export type TrailMode = "flat" | "altitude" | "climb";
export type LabelDensity = "all" | "nearestN" | "nearestOnly" | "adaptive";

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
  zoom: number;
  mapZoom: number; mapCenterLat: number; mapCenterLon: number; mapRotationDeg: number;
  rotationDeg: number; mirrorX: boolean; mirrorY: boolean;
  minAltitudeFt: number; maxAltitudeFt: number; hideOnGround: boolean;
  interpolate: boolean;
  maxFps: number; renderScale: number;
  skin: Skin; mapStyle: MapStyle; gridOverlay: GridOverlay;
  palette: Palette; fonts: Fonts; glyphSizePx: number; altitudeColor: boolean;
  trailMode: TrailMode; trailSeconds: number; trailBoost: number; brightness: number;
  labelDensity: LabelDensity; nearestN: number; showFields: ShowFields;
  rangeRings: boolean; showAirport: boolean; showApproaches: boolean;
  showFinal: boolean; showTraffic: boolean; showHome: boolean;
  showRelative: boolean; highlightEmergency: boolean; showNotable: boolean;
  notableFlash: boolean; notableWebhook: string; showWinds: boolean; showPhotos: boolean;
  burnInOrbit: boolean; followSelected: boolean;
  showSpotlight: boolean; spotlightRadiusMi: number; spotlightLat: number; spotlightLon: number;
  skyTimeOffsetMin: number;
  showNavaids: boolean; showProcedures: boolean;
  showProcRaster: boolean; procRasterUrl: string; procRasterOpacity: number;
  lightsMode: string; // "auto" | "on" | "off" — aircraft + airport lighting
  showMarineLayer: boolean; marineLayerIntensity: number; // coastal fog overlay
  ambientMode: boolean; // non-aircraft layers stay label-free (ferries + tapped excepted)
  showRadar: boolean; radarOpacity: number; // keyless precip radar
  showHighways: boolean; highwayIntensity: number; // synthetic road traffic
  showVessels: boolean; vesselIntensity: number; // synthetic Sound vessel traffic
  showRail: boolean; // Link light rail line + stations (static, GPS/OSM)
  showBuses: boolean; // live Metro + Sound Transit buses (OBA) within the home radius
  showFerries: boolean; // live WA State Ferries (WSF) on the Sound
  showFireEms: boolean; // live Fire/EMS 911 incidents (Seattle Fire real-time dispatch)
  fireEmsArrivalCue: boolean; // the one-time arrival ripple (off = fully static)

  monitorMode: MonitorMode; lightsOutHour: number; lightsOutBrightness: number; muteUntil: number; showCursor: boolean;
}

export interface Aircraft {
  hex: string; flight?: string; lat?: number; lon?: number;
  altBaro?: number; altGeom?: number; gs?: number; track?: number; baroRate?: number;
  squawk?: string; seen: number; seenPos?: number;
  onGround?: boolean; category?: string; selAlt?: number;
  fmsAlt?: number; selHeading?: number; navQNH?: number; navModes?: string[];
  windSpd?: number; windDir?: number; oat?: number;
  ias?: number; tas?: number; mach?: number;
  typeCode?: string; typeName?: string; airline?: string; registration?: string;
  origin?: string; destination?: string; originName?: string; destName?: string;
  routeUncertain?: boolean; // schedule-DB route failed the heading/position geometry check
  routeVerified?: boolean; // route confirmed against the live flight-status API (AeroDataBox)
  originLat?: number; originLon?: number; destLat?: number; destLon?: number;
}

export interface SourceStatus { ok: boolean; source: string; count: number; message?: string }
export interface SceneMeta { name: string; savedAt?: number }
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
