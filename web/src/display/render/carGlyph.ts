// A car glyph for the highway layer — the road family in the unified physical-model language.
// At ~5px it reads as a CAR through three cues: a rounded-rectangle body (not a dot), the
// same pseudo-3D shading the aircraft use (shared shade() + softContactShadow()), and a
// directional LIGHT PAIR — warm-white headlights forward, red taillights aft — which tells
// you which way every car is going at a glance (opposing carriageways become rivers of warm
// vs red). Body colour is the continuous congestion ramp, so a car warms teal→terracotta as
// it slows into a jam. Sprite-cached per congestion bucket (one bake per bucket, blitted
// rotated) to stay cheap on the Pi. Forward is −y (same convention as the aircraft glyph).
import { shade, softContactShadow } from "./aircraftGlyph";
import { congRamp, type RGB } from "./colors";

const L = 5.4;          // body length (px)
const W = 2.8;          // body width (px)
const SS = 4;           // supersample for crisp tiny sprites
const HALF = 7;         // sprite half-extent in css px (covers body + headlight throw + shadow)
export const CAR_BUCKETS = 12;

const sprites: (HTMLCanvasElement | null)[] = new Array(CAR_BUCKETS).fill(null);
const col = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function bakeCar(body: RGB): HTMLCanvasElement {
  const px = HALF * 2 * SS;
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const ctx = c.getContext("2d")!;
  ctx.translate(px / 2, px / 2);
  ctx.scale(SS, SS);

  // Contact shadow (seats the car on the asphalt) — same recipe as aircraft, car footprint.
  softContactShadow(ctx, W / 2, L / 2);

  // Body: rounded rectangle with the lateral top-left gradient (same stop positions as the
  // fuselage), tinted by the congestion ramp.
  const g = ctx.createLinearGradient(-W / 2, 0, W / 2, 0);
  g.addColorStop(0, col(shade(body, -0.3), 1));
  g.addColorStop(0.32, col(shade(body, 0.34), 1));
  g.addColorStop(0.58, col(shade(body, 0.08), 1));
  g.addColorStop(1, col(shade(body, -0.4), 1));
  roundRectPath(ctx, -W / 2, -L / 2, W, L, 1);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = "rgba(0,0,0,0.4)"; // dark edge = sits on a surface
  ctx.stroke();

  // Windshield band across the front third — gives the car a clear "front".
  ctx.fillStyle = col(shade(body, 0.55), 0.5);
  roundRectPath(ctx, -W * 0.4, -L * 0.26, W * 0.8, L * 0.2, 0.5);
  ctx.fill();

  // Specular glint (forward, lit side) — the system-wide "wet/lit" cue.
  ctx.fillStyle = col(shade(body, 0.82), 0.55);
  ctx.beginPath();
  ctx.arc(-0.1 * W, -0.3 * L, 0.34 * W, 0, Math.PI * 2);
  ctx.fill();

  // Directional lights (additive). Warm-white headlights lead travel; red taillights trail.
  ctx.globalCompositeOperation = "lighter";
  // Headlight throw — a whisper of a cone, not a beam (cars are subordinate).
  const cone = ctx.createLinearGradient(0, -L / 2, 0, -L / 2 - 2.4);
  cone.addColorStop(0, "rgba(255,246,210,0.18)");
  cone.addColorStop(1, "rgba(255,246,210,0)");
  ctx.fillStyle = cone;
  ctx.beginPath();
  ctx.moveTo(-0.6, -L / 2);
  ctx.lineTo(0.6, -L / 2);
  ctx.lineTo(1.1, -L / 2 - 2.4);
  ctx.lineTo(-1.1, -L / 2 - 2.4);
  ctx.closePath();
  ctx.fill();
  for (const sx of [-0.7, 0.7]) {
    ctx.fillStyle = "rgba(255,244,214,0.75)"; // headlamps
    ctx.beginPath();
    ctx.arc(sx, -L / 2 + 0.1, 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,52,44,0.62)";   // taillamps
    ctx.beginPath();
    ctx.arc(sx, L / 2 - 0.1, 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/** Cached car sprite for a congestion bucket index (0=free-flow … CAR_BUCKETS-1=jam). */
export function carSprite(bucket: number): HTMLCanvasElement {
  const i = bucket < 0 ? 0 : bucket >= CAR_BUCKETS ? CAR_BUCKETS - 1 : bucket;
  let s = sprites[i];
  if (!s) {
    s = bakeCar(congRamp(i / (CAR_BUCKETS - 1)));
    sprites[i] = s;
  }
  return s;
}

/** Blit a car centered at (x,y), rotated so its nose (−y) points along travel angle `ang`
 *  (radians, screen space from +x). `alpha` sets the subordinate brightness. */
export function drawCar(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, x: number, y: number, ang: number, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(ang + Math.PI / 2); // glyph nose is −y; rotate it onto the travel vector
  ctx.drawImage(sprite, -HALF, -HALF, HALF * 2, HALF * 2);
  ctx.restore();
}
