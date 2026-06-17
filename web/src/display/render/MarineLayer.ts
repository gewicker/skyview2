// The Seattle "marine layer": coastal low fog/cloud that drifts in over Puget Sound and the
// lakes at night/morning. A soft, slow, additive field of fog blobs seeded over the WATER to the
// west of home and drifting onshore (NE), stronger overnight (the bedside hours). No shadowBlur —
// a baked soft-blob sprite blitted at varying alpha (cheap on the Pi). Off by default; intensity
// is a manual slider for now (real METAR-derived intensity + a precise water mask are follow-ups).
import type { Layer, FrameContext } from "./types";
import { sunAltitude } from "./sun";
import { getMarineFog, startWeather } from "./weather";

interface Blob { dLat: number; dLon: number; r: number; seed: number }

export class MarineLayer implements Layer {
  readonly name = "marine";
  private sprite: HTMLCanvasElement | null = null;
  private blobs: Blob[] = [];
  private sunAt = 0;
  private nf = 0;

  constructor() {
    startWeather(); // begin polling NWS conditions (keyless) to drive the fog intensity
    // A pool scattered over a westward band — toward Lake Washington, the lakes, and the Sound.
    for (let i = 0; i < 14; i++) {
      this.blobs.push({
        dLat: (Math.random() - 0.5) * 0.5,   // ±0.25° lat
        dLon: -Math.random() * 0.35 - 0.02,  // 0.02–0.37° WEST of home (over water)
        r: 70 + Math.random() * 90,
        seed: Math.random() * 6.28,
      });
    }
  }

  private blobSprite(): HTMLCanvasElement {
    if (this.sprite) return this.sprite;
    const S = 128, c = document.createElement("canvas");
    c.width = c.height = S;
    const x = c.getContext("2d")!;
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    // Warm-neutral grey: deliberately pulled away from the cool cyan-blue precip radar
    // so fog (additive grey bloom) is never mistaken for light rain (translucent cyan).
    g.addColorStop(0, "rgba(176,178,186,1)");
    g.addColorStop(1, "rgba(176,178,186,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, S, S);
    this.sprite = c;
    return c;
  }

  draw(f: FrameContext): void {
    if (!f.cfg.showMarineLayer) return;
    const slider = f.cfg.marineLayerIntensity ?? 0.6;
    if (slider < 0.02) return;
    // Real conditions drive it: full slider when it's actually foggy, faint when clear.
    const intensity = slider * (0.25 + 0.75 * getMarineFog());
    const wall = Date.now();
    if (wall - this.sunAt > 30000) {
      this.sunAt = wall;
      const alt = sunAltitude(f.cfg.centerLat, f.cfg.centerLon, new Date(wall + (f.cfg.skyTimeOffsetMin || 0) * 60000));
      this.nf = Math.max(0, Math.min(1, (6 - alt) / 12)); // fades in around dusk
    }
    const envelope = 0.35 + 0.65 * this.nf; // thicker overnight
    const sprite = this.blobSprite();
    const ctx = f.ctx;
    const t = f.t;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const b of this.blobs) {
      const drift = (t * 0.0006 + b.seed * 0.04) % 0.4; // slow onshore creep, per-blob phase
      const lat = f.cfg.centerLat + b.dLat + drift * 0.6;
      const lon = f.cfg.centerLon + b.dLon + drift;
      const p = f.cam.project(lat, lon);
      const rr = b.r * (1 + 0.08 * Math.sin(t * 0.3 + b.seed));
      if (p.x < -rr || p.x > f.w + rr || p.y < -rr || p.y > f.h + rr) continue;
      ctx.globalAlpha = Math.min(0.16, (0.04 + 0.09 * intensity) * envelope);
      ctx.drawImage(sprite, p.x - rr, p.y - rr, rr * 2, rr * 2);
    }
    ctx.restore();
  }
}
