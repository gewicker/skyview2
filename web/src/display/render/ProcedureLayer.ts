// Procedure overlay (off by default): the straight-in final approach courses for the
// three local fields, derived from the real runway thresholds — drawn as crisp vector
// "localizer" courses with FAF/gate ticks in a Jeppesen-esque idiom. Tap a course to
// reveal its detail card. An optional, faint FAA chart RASTER underlay can be layered
// beneath when a georeferenced image URL is configured (off by default).
//
// Full multi-fix RNAV STAR tracks can be added later from an FAA CIFP export by
// extending navdata.ts; the rendering here already scales/rotates with the map.
import type { Layer, FrameContext } from "./types";
import { FINALS, findFinal, type Final } from "./navdata";
import { drawCard } from "./NavaidLayer";

const CYAN = "rgba(120,214,235,";

// North-up bounds the optional raster underlay is georeferenced to (covers the three
// fields). Supply an FAA TPP chart image cropped/scaled to exactly this box.
const RASTER_N = 47.98, RASTER_S = 46.93, RASTER_W = -122.98, RASTER_E = -121.90;
const rasterCache = new Map<string, HTMLImageElement>();

export class ProcedureLayer implements Layer {
  readonly name = "procedures";

  draw(f: FrameContext): void {
    if (!f.cfg.showProcedures) return;
    const ctx = f.ctx;

    // Optional faint FAA chart raster underlay (only if a URL is configured).
    if (f.cfg.showProcRaster && f.cfg.procRasterUrl) this.drawRaster(f);

    ctx.save();
    for (const fin of FINALS) this.drawFinal(f, fin, f.selectedNavId === fin.id);
    if (f.selectedNavId) {
      const fin = findFinal(f.selectedNavId);
      if (fin) this.drawDetail(f, fin);
    }
    ctx.restore();
  }

  private drawFinal(f: FrameContext, fin: Final, sel: boolean): void {
    const ctx = f.ctx;
    const thr = f.cam.project(fin.thr[0], fin.thr[1]);
    const end = f.cam.project(fin.end[0], fin.end[1]);
    const faf = f.cam.project(fin.faf[0], fin.faf[1]);
    const gate = f.cam.project(fin.gate[0], fin.gate[1]);
    // Cull if entirely off-screen.
    if (offscreen(thr, f) && offscreen(end, f)) return;

    // Course unit + perpendicular (screen space).
    let ux = thr.x - end.x, uy = thr.y - end.y;
    const len = Math.hypot(ux, uy) || 1;
    ux /= len; uy /= len;
    const px = -uy, py = ux;

    const a = sel ? 0.95 : 0.5;
    // Soft wide underlay then the crisp course (no shadowBlur — Pi-friendly).
    ctx.lineCap = "round";
    ctx.strokeStyle = CYAN + (a * 0.25) + ")";
    ctx.lineWidth = sel ? 5 : 3;
    ctx.beginPath(); ctx.moveTo(end.x, end.y); ctx.lineTo(thr.x, thr.y); ctx.stroke();
    ctx.strokeStyle = CYAN + a + ")";
    ctx.lineWidth = sel ? 2 : 1.2;
    ctx.beginPath(); ctx.moveTo(end.x, end.y); ctx.lineTo(thr.x, thr.y); ctx.stroke();

    // FAF tick (longer, a Maltese-ish cross) and a plain gate tick.
    this.tick(ctx, faf, px, py, 8, CYAN + a + ")", sel ? 2 : 1.4);
    this.tick(ctx, gate, px, py, 5, CYAN + (a * 0.8) + ")", 1.2);
    // FAF dot.
    ctx.fillStyle = CYAN + a + ")";
    ctx.beginPath(); ctx.arc(faf.x, faf.y, sel ? 3 : 2.2, 0, Math.PI * 2); ctx.fill();

    // Course label near the outer end, offset off the line.
    const lx = end.x + px * 10, ly = end.y + py * 10;
    ctx.font = sel ? "700 11px system-ui, sans-serif" : "600 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const tag = `${fin.iata} ${fin.ident}`;
    const tw = ctx.measureText(tag).width;
    ctx.fillStyle = "rgba(8,18,24,0.6)";
    roundRect(ctx, lx - tw / 2 - 4, ly - 8, tw + 8, 15, 3);
    ctx.fill();
    ctx.fillStyle = CYAN + (sel ? 1 : 0.9) + ")";
    ctx.fillText(tag, lx, ly);
  }

  private tick(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, px: number, py: number, half: number, color: string, lw: number): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(p.x - px * half, p.y - py * half);
    ctx.lineTo(p.x + px * half, p.y + py * half);
    ctx.stroke();
  }

  private drawDetail(f: FrameContext, fin: Final): void {
    const faf = f.cam.project(fin.faf[0], fin.faf[1]);
    const crs = Math.round(fin.course).toString().padStart(3, "0");
    drawCard(f.ctx, f, faf.x + 14, faf.y - 10, [
      `${fin.iata} RWY ${fin.ident}`,
      `Final course ${crs}°`,
      `FAF ${fin.fafNM} NM · GP 3.00°`,
      `Drawn ${fin.lenNM} NM final`,
    ]);
  }

  // Affine-draw a north-up georeferenced image so it tracks pan/zoom/rotation. The
  // base canvas transform is scale(dpr); we compose the image basis on top of it.
  private drawRaster(f: FrameContext): void {
    const url = f.cfg.procRasterUrl;
    let img = rasterCache.get(url);
    if (!img) {
      img = new Image();
      img.crossOrigin = "anonymous";
      img.src = url;
      rasterCache.set(url, img);
    }
    if (!img.complete || !img.naturalWidth) return;
    const nw = f.cam.project(RASTER_N, RASTER_W);
    const ne = f.cam.project(RASTER_N, RASTER_E);
    const sw = f.cam.project(RASTER_S, RASTER_W);
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const ax = (ne.x - nw.x) / iw, ay = (ne.y - nw.y) / iw;
    const bx = (sw.x - nw.x) / ih, by = (sw.y - nw.y) / ih;
    const d = f.dpr;
    const ctx = f.ctx;
    ctx.save();
    ctx.globalAlpha = clamp(f.cfg.procRasterOpacity || 0.5, 0.05, 1);
    ctx.setTransform(d * ax, d * ay, d * bx, d * by, d * nw.x, d * nw.y);
    ctx.drawImage(img, 0, 0);
    ctx.restore(); // back to the base scale(dpr) transform
  }
}

function offscreen(p: { x: number; y: number }, f: FrameContext): boolean {
  const m = 80;
  return p.x < -m || p.x > f.w + m || p.y < -m || p.y > f.h + m;
}
function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
