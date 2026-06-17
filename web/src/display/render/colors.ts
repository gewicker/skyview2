// Shared colour ramps for aircraft + trails. Altitude reads as an EARTH→SKY gradient:
// traffic hugging the ground is warm and earthy, traffic up high is light and vibrant.
// The mapping is intuitive — low = grounded/warm, high = airy/bright — and the stops are
// tuned (with a design review) for a monotonic perceived-luminance rise, maximum spread in
// the busy 0–12k band, and legibility on dark AND bright/satellite backgrounds. Exact
// altitude is still printed in the label.
export type RGB = [number, number, number];

// Smooth earth→sky ramp (no hard band flips). Spacing is denser low (most traffic) and the
// mid blues are lifted/slightly desaturated so altitude order survives on dark backgrounds
// and for red-green colour-vision deficiency (where lightness, not hue, carries the order).
const ALT_STOPS: [number, RGB][] = [
  [0, [176, 107, 67]],      // surface — earthy terracotta / clay
  [2500, [206, 138, 71]],   // burnt ochre
  [5000, [232, 176, 82]],   // amber gold
  [8000, [238, 210, 110]],  // golden wheat — top of the warm band
  [11000, [190, 214, 120]], // sage — earth gives way to sky
  [15000, [126, 205, 150]], // meadow green
  [20000, [86, 196, 205]],  // teal
  [27000, [96, 198, 248]],  // sky blue
  [35000, [140, 218, 255]], // bright azure
  [44000, [190, 236, 255]], // very high — airy ice-blue
];

export function altRamp(alt: number): RGB {
  const a = alt < 0 ? 0 : alt > 44000 ? 44000 : alt; // clamp to the ramp domain
  if (a <= ALT_STOPS[0][0]) return ALT_STOPS[0][1];
  for (let i = 1; i < ALT_STOPS.length; i++) {
    if (a <= ALT_STOPS[i][0]) {
      const [a0, c0] = ALT_STOPS[i - 1];
      const [a1, c1] = ALT_STOPS[i];
      return mixSrgb(c0, c1, (a - a0) / (a1 - a0));
    }
  }
  return ALT_STOPS[ALT_STOPS.length - 1][1];
}

// Plain (linear, per-channel) lerp — used by the trail climb/descent colouring.
export function lerp(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// Gamma-correct colour mix: interpolate in LINEAR light, not 8-bit sRGB, so transitions
// (warm→green, teal→blue) don't darken/mud through the midpoint. Used by the altitude ramp.
export function srgbToLin(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
export function linToSrgb(l: number): number {
  const s = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  const v = Math.round(s * 255);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
function mixSrgb(a: RGB, b: RGB, t: number): RGB {
  const mix = (x: number, y: number) => linToSrgb(srgbToLin(x) + (srgbToLin(y) - srgbToLin(x)) * t);
  return [mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2])];
}

// Continuous congestion ramp — free-flow cool teal → jam desaturated terracotta (NOT a
// fire-engine red; bedside-calm). Drives BOTH the per-car body tint and the scrolling
// road-flow wash, so the two read as the same data. Same gamma-correct linear-light mix as
// the altitude ramp so midtones stay clean (no muddy green→amber).
const CONG_STOPS: [number, RGB][] = [
  [0.0, [63, 168, 140]],    // free-flow teal
  [0.3, [111, 192, 138]],   // light green
  [0.55, [201, 192, 106]],  // filling, sand
  [0.78, [224, 162, 88]],   // heavy amber
  [1.0, [217, 120, 90]],    // jam — desaturated terracotta
];

export function congRamp(t: number): RGB {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  if (x <= CONG_STOPS[0][0]) return CONG_STOPS[0][1];
  for (let i = 1; i < CONG_STOPS.length; i++) {
    if (x <= CONG_STOPS[i][0]) {
      const [t0, c0] = CONG_STOPS[i - 1];
      const [t1, c1] = CONG_STOPS[i];
      return mixSrgb(c0, c1, (x - t0) / (t1 - t0));
    }
  }
  return CONG_STOPS[CONG_STOPS.length - 1][1];
}

// Pull a colour toward its own grey by `amt` (0 = unchanged, 1 = fully desaturated).
// Used as the ambient "this is modelled, not live" tell on the traffic layer when the
// WSDOT feed is stale/down — a low-amplitude whisper, never an error state.
export function desatRGB(c: RGB, amt: number): RGB {
  const a = amt < 0 ? 0 : amt > 1 ? 1 : amt;
  const grey = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  return [c[0] + (grey - c[0]) * a, c[1] + (grey - c[1]) * a, c[2] + (grey - c[2]) * a];
}

export function hexRGB(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 154, 60];
}
