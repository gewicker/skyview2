// Canonical Web Mercator projection — the single coordinate system for everything
// drawn (tiles, aircraft, runways, approaches). Because slippy tiles are native
// Web Mercator, placing tiles and traffic through this identical transform makes
// them register by construction at any zoom or distance. (v1 used a flat-earth
// approximation + per-tile affine warp; this replaces it.)

const DEG = Math.PI / 180;
const MAX_LAT = 85.05112878; // Web Mercator latitude clamp

export interface World { x: number; y: number } // normalised [0,1] across the globe

/** lat/lon -> normalised world coordinates (x east 0..1, y south 0..1). */
export function llToWorld(lat: number, lon: number): World {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const sin = Math.sin(clamped * DEG);
  return {
    x: (lon + 180) / 360,
    y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI),
  };
}

/** Inverse: normalised world -> lat/lon. */
export function worldToLL(x: number, y: number): { lat: number; lon: number } {
  const lon = x * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lat, lon };
}

export interface CameraOpts {
  centerLat: number;
  centerLon: number;
  zoom: number;        // fractional slippy zoom; world px = 256 * 2^zoom
  rotationDeg: number;
  mirrorX: boolean;
  mirrorY: boolean;
  screenW: number;
  screenH: number;
}

export interface Point { x: number; y: number }

/** A camera over the Web Mercator plane: lat/lon <-> screen pixels. */
export class Camera {
  private center: World;
  private scale: number; // pixels per world unit
  private cos: number;
  private sin: number;

  constructor(private o: CameraOpts) {
    this.center = llToWorld(o.centerLat, o.centerLon);
    this.scale = 256 * Math.pow(2, o.zoom);
    const t = o.rotationDeg * DEG;
    this.cos = Math.cos(t);
    this.sin = Math.sin(t);
  }

  /** Slippy tile zoom that best matches the current scale (for tile selection). */
  tileZoom(min = 11, max = 16): number {
    return Math.max(min, Math.min(max, Math.round(this.o.zoom)));
  }

  /** A clone with a different screen size — same centre/scale/rotation. Used to
   *  rasterize the basemap into an oversized buffer so pan/zoom-out reveal already
   *  rendered map instead of blank margins. */
  withScreen(screenW: number, screenH: number): Camera {
    return new Camera({ ...this.o, screenW, screenH });
  }

  /** lat/lon -> screen pixel. */
  project(lat: number, lon: number): Point {
    const w = llToWorld(lat, lon);
    let dx = (w.x - this.center.x) * this.scale;
    let dy = (w.y - this.center.y) * this.scale;
    let x = dx * this.cos - dy * this.sin;
    let y = dx * this.sin + dy * this.cos;
    if (this.o.mirrorX) x = -x;
    if (this.o.mirrorY) y = -y;
    return { x: this.o.screenW / 2 + x, y: this.o.screenH / 2 + y };
  }

  /** screen pixel -> lat/lon (inverse of project). */
  unproject(sx: number, sy: number): { lat: number; lon: number } {
    let x = sx - this.o.screenW / 2;
    let y = sy - this.o.screenH / 2;
    if (this.o.mirrorX) x = -x;
    if (this.o.mirrorY) y = -y;
    const dx = x * this.cos + y * this.sin;
    const dy = -x * this.sin + y * this.cos;
    return worldToLL(this.center.x + dx / this.scale, this.center.y + dy / this.scale);
  }
}
