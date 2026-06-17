// Precipitation radar overlay. Draws RainViewer's pre-colored radar tiles through the
// SAME Web-Mercator affine transform the basemap uses (see tiles.ts), so precip registers
// exactly with the traffic. Unlike the marine fog (additive bloom), radar is a TRANSLUCENT
// tint on the ground — composite "source-over", NOT "lighter": the tiles are pre-colored
// PNGs and additive blending would blow the cool blue→green→yellow ramp out to white.
// It sits just above the basemap and under everything alive, so aircraft always paint on
// top at full brightness — a jet flying through a cell stays the brightest thing on screen.
//
// Animation: a 2 fps loop over the recent frames that HOLDS on the newest real observation
// ("now") for ~1.6 s before continuing into the nowcast, with a short crossfade so the
// bedside panel never strobes.
import type { Layer, FrameContext } from "./types";
import { startRadar, getRadar } from "./radar";

const DEG = Math.PI / 180;
const SCHEME = 2;        // RainViewer "Universal Blue" — cool, reads clearly as precip on a dark base
const HOLD_SLOTS = 3;    // extra 500 ms slots held on the "now" frame (~1.6 s)
const SLOT = 0.5;        // seconds per frame (2 fps)
const FADE = 0.12;       // crossfade window at the end of each slot (seconds)
const CAP = 256;         // radar tiles are few (low zoom) but cap anyway

const cache = new Map<string, HTMLImageElement>();

function getTile(url: string): HTMLImageElement | null {
  let img = cache.get(url);
  if (!img) {
    if (cache.size >= CAP) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    img = new Image();
    img.src = url;
    cache.set(url, img);
    return null;
  }
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

export class RadarLayer implements Layer {
  readonly name = "radar";

  constructor() {
    startRadar(); // begin polling RainViewer (keyless)
  }

  draw(f: FrameContext): void {
    if (!f.cfg.showRadar) return;
    const { host, frames, nowIndex } = getRadar();
    if (!host || frames.length === 0) return;
    const N = frames.length;
    const opacity = f.cfg.radarOpacity ?? 0.55;

    // Virtual schedule: one slot per frame, with HOLD_SLOTS extra slots parked on "now".
    const total = N + HOLD_SLOTS;
    const slotToIdx = (slot: number): number => {
      const s = ((slot % total) + total) % total;
      const ni = nowIndex >= 0 ? nowIndex : N - 1;
      if (s <= ni) return s;
      if (s <= ni + HOLD_SLOTS) return ni;
      return s - HOLD_SLOTS;
    };

    const slot = Math.floor(f.t / SLOT);
    const phase = (f.t - slot * SLOT); // 0..SLOT within the current slot
    const idx = slotToIdx(slot);

    // Radar is coarse by nature; pulling z≥8 wastes the Pi for no visible gain.
    const z = f.cam.tileZoom(3, 7);

    if (phase > SLOT - FADE) {
      // Crossfade into the next slot's frame over the last FADE seconds.
      const k = (phase - (SLOT - FADE)) / FADE; // 0..1
      this.paint(f, host, frames[idx], z, opacity * (1 - k));
      const nextIdx = slotToIdx(slot + 1);
      if (nextIdx !== idx) this.paint(f, host, frames[nextIdx], z, opacity * k);
      else this.paint(f, host, frames[idx], z, opacity * k); // holding: same frame, keep it solid
    } else {
      this.paint(f, host, frames[idx], z, opacity);
    }
  }

  private paint(f: FrameContext, host: string, path: string, z: number, alpha: number): void {
    if (alpha <= 0.01) return;
    const cam = f.cam, ctx = f.ctx, w = f.w, h = f.h;
    // Visible tile range from the four screen corners (same approach as the basemap).
    let txMin = Infinity, txMax = -Infinity, tyMin = Infinity, tyMax = -Infinity;
    for (const [sx, sy] of [[0, 0], [w, 0], [0, h], [w, h]] as const) {
      const { lat, lon } = cam.unproject(sx, sy);
      const [tx, ty] = llToTile(lat, lon, z);
      txMin = Math.min(txMin, tx); txMax = Math.max(txMax, tx);
      tyMin = Math.min(tyMin, ty); tyMax = Math.max(tyMax, ty);
    }
    if (!Number.isFinite(txMin) || (txMax - txMin) * (tyMax - tyMin) > 64) return;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = alpha;
    for (let x = Math.floor(txMin); x <= Math.floor(txMax); x++) {
      for (let y = Math.floor(tyMin); y <= Math.floor(tyMax); y++) {
        const url = `${host}${path}/256/${z}/${x}/${y}/${SCHEME}/1_1.png`;
        const img = getTile(url);
        if (!img) continue;
        const a = cam.project(...tileToLL(x, y, z));     // NW
        const b = cam.project(...tileToLL(x + 1, y, z)); // NE
        const c = cam.project(...tileToLL(x, y + 1, z)); // SW
        const iw = img.naturalWidth || 256;
        const ih = img.naturalHeight || 256;
        ctx.save();
        // Relative affine on top of the canvas's DPR base transform (matches tiles.ts).
        ctx.transform((b.x - a.x) / iw, (b.y - a.y) / iw, (c.x - a.x) / ih, (c.y - a.y) / ih, a.x, a.y);
        ctx.drawImage(img, -0.5, -0.5, iw + 1, ih + 1);
        ctx.restore();
      }
    }
    ctx.restore();
  }
}
