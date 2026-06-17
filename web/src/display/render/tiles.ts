// Slippy map tiles drawn through the Web Mercator camera. Because the camera and the
// tiles share Web Mercator, each tile maps onto its projected corners with an affine
// transform and registers exactly with the aircraft — no warping. Tiles are cached
// (FIFO-capped) and load once; the static-map layer redraws as they arrive.
import { Camera } from "./mercator";
import type { MapStyle } from "@shared/types";

const SUB = "abcd";
const CAP = 256; // bounded for the Pi: a 1280×800 kiosk holds far fewer at once; 700 let
                 // decoded @2x tiles pile up across style switches / long pans (~1 MB each)
const DEG = Math.PI / 180;
const cache = new Map<string, HTMLImageElement>();
let loads = 0;

/** Bumps as tiles finish loading, so the static-map cache knows to refresh. */
export function tilesVersion(): number {
  return loads;
}

function tileURL(x: number, y: number, z: number, style: MapStyle): string {
  if (style === "satellite") {
    // Esri World Imagery uses {z}/{row=y}/{col=x}.
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  }
  const variant = style === "wire" ? "dark_nolabels" : "dark_all";
  return `https://${SUB[(x + y) % 4]}.basemaps.cartocdn.com/${variant}/${z}/${x}/${y}@2x.png`;
}

function getTile(url: string): HTMLImageElement | null {
  let img = cache.get(url);
  if (!img) {
    if (cache.size >= CAP) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    img = new Image();
    img.onload = () => { loads++; };
    img.src = url;
    cache.set(url, img);
    return null;
  }
  // LRU touch so frequently-seen tiles survive eviction during a pan.
  cache.delete(url);
  cache.set(url, img);
  return img.complete && img.naturalWidth > 0 ? img : null;
}

function tileToLL(x: number, y: number, z: number): [number, number] {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return [lat, lon];
}

function llToTile(lat: number, lon: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.asinh(Math.tan(lat * DEG)) / Math.PI) / 2) * n;
  return [x, y];
}

/** Paint tiles covering the camera's view. Draws a coarse base layer first (z−2) so
 *  any detail tiles still loading don't leave holes — you get a blurry fill that
 *  sharpens as the real tiles arrive, instead of a checkerboard. Returns true if any
 *  tile drew. */
export function drawTiles(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number, style: MapStyle): boolean {
  const z = cam.tileZoom();
  const base = Math.max(11, z - 2);
  let drew = false;
  if (base < z) drew = drawLevel(ctx, cam, w, h, style, base) || drew;
  drew = drawLevel(ctx, cam, w, h, style, z) || drew;
  return drew;
}

function drawLevel(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number, style: MapStyle, z: number): boolean {
  let txMin = Infinity, txMax = -Infinity, tyMin = Infinity, tyMax = -Infinity;
  for (const [sx, sy] of [[0, 0], [w, 0], [0, h], [w, h]] as const) {
    const { lat, lon } = cam.unproject(sx, sy);
    const [tx, ty] = llToTile(lat, lon, z);
    txMin = Math.min(txMin, tx); txMax = Math.max(txMax, tx);
    tyMin = Math.min(tyMin, ty); tyMax = Math.max(tyMax, ty);
  }
  if (!Number.isFinite(txMin) || (txMax - txMin) * (tyMax - tyMin) > 400) return false;
  let drew = false;
  for (let x = Math.floor(txMin); x <= Math.floor(txMax); x++) {
    for (let y = Math.floor(tyMin); y <= Math.floor(tyMax); y++) {
      const img = getTile(tileURL(x, y, z, style));
      if (!img) continue;
      const a = cam.project(...tileToLL(x, y, z));       // NW
      const b = cam.project(...tileToLL(x + 1, y, z));   // NE
      const c = cam.project(...tileToLL(x, y + 1, z));   // SW
      const iw = img.naturalWidth || 256;
      const ih = img.naturalHeight || 256;
      ctx.save();
      ctx.transform((b.x - a.x) / iw, (b.y - a.y) / iw, (c.x - a.x) / ih, (c.y - a.y) / ih, a.x, a.y);
      ctx.drawImage(img, -0.5, -0.5, iw + 1, ih + 1);
      ctx.restore();
      drew = true;
    }
  }
  return drew;
}
