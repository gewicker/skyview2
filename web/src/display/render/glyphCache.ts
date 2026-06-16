// Sprite cache for the static aircraft silhouette. Re-tracing the fuselage/wing/tail
// paths for every aircraft every frame is the renderer's hottest CPU cost on a busy
// sky; instead we render each (kind, colour, size, dpr) once into a small offscreen
// canvas and blit it. Colour is bucketed so the altitude ramp doesn't explode the
// cache. Spinning props/rotors are NOT baked in — they're drawn live on top.
import type { GlyphKind } from "./aircraftGlyph";
import { drawGlyphStatic } from "./aircraftGlyph";
import type { RGB } from "./colors";

const MARGIN = 1.7; // glyph half-extent in s-units (widest span ~1.6)
const CAP = 700;
const cache = new Map<string, Sprite>();

export interface Sprite { canvas: HTMLCanvasElement; half: number } // half = CSS px from centre

export function getGlyphSprite(kind: GlyphKind, rgb: RGB, alpha: number, s: number, dpr: number): Sprite {
  const cb = `${q(rgb[0])},${q(rgb[1])},${q(rgb[2])}`;
  const sp = Math.max(5, Math.round(s));
  const key = `${kind}|${cb}|${Math.round(alpha * 12)}|${sp}|${dpr.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit) {
    // LRU touch.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const half = Math.ceil(MARGIN * sp);
  const px = Math.max(1, Math.ceil(2 * half * dpr));
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const c = canvas.getContext("2d")!;
  c.setTransform(dpr, 0, 0, dpr, half * dpr, half * dpr); // origin at centre, CSS units
  drawGlyphStatic(c, kind, sp, rgb, alpha);
  const sprite: Sprite = { canvas, half };
  if (cache.size >= CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, sprite);
  return sprite;
}

// Quantise a colour channel so near-identical altitude colours share one sprite.
function q(v: number): number {
  return Math.min(255, Math.round(v / 16) * 16);
}
