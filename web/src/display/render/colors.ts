// Shared colour ramps for aircraft + trails. A rich multi-stop altitude ramp so the
// variation reads clearly across the whole band: low = warm orange, mid = green/cyan,
// high = blue/violet. (Ported from v1's ALT_STOPS.)
export type RGB = [number, number, number];

// Three distinct bands with sharp flips at 10k and 20k:
//   0–10k  = ground/yellow (orange → amber → bright yellow)
//   10–20k = blue hues
//   20k+   = striking violet → magenta → pink
const ALT_STOPS: [number, RGB][] = [
  [0, [255, 140, 30]],      // surface — orange
  [5000, [255, 205, 60]],   // amber/yellow
  [9500, [255, 240, 120]],  // bright yellow — top of the low band
  [10000, [80, 165, 255]],  // 10k: sharp flip to blue
  [15000, [56, 112, 240]],  // mid blue
  [20000, [40, 72, 225]],   // deep blue — top of the mid band
  [20500, [190, 70, 255]],  // 20k: sharp flip to violet
  [30000, [255, 70, 210]],  // hot magenta
  [40000, [255, 150, 245]], // very high — bright pink
];

export function altRamp(alt: number): RGB {
  if (alt <= ALT_STOPS[0][0]) return ALT_STOPS[0][1];
  for (let i = 1; i < ALT_STOPS.length; i++) {
    if (alt <= ALT_STOPS[i][0]) {
      const [a0, c0] = ALT_STOPS[i - 1];
      const [a1, c1] = ALT_STOPS[i];
      return lerp(c0, c1, (alt - a0) / (a1 - a0));
    }
  }
  return ALT_STOPS[ALT_STOPS.length - 1][1];
}

export function lerp(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function hexRGB(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 154, 60];
}
