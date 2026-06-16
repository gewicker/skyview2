// Winds-aloft panel. The radio already carries Mode-S EHS winds (windSpd/windDir) and
// outside-air temp per aircraft; this aggregates them into altitude bands and shows a
// compact local sounding — wind direction (arrow points the way the wind blows TO,
// meteorological "from" stated numerically) + speed + temp at each band. Hidden when
// no aircraft are reporting winds. Top-left so it clears the spotlight card.
import type { Layer, FrameContext, Visible } from "./types";

const DEG = Math.PI / 180;

interface Band { label: string; lo: number; hi: number }
const BANDS: Band[] = [
  { label: "SFC–5k", lo: -2000, hi: 5000 },
  { label: "5–15k", lo: 5000, hi: 15000 },
  { label: "15–25k", lo: 15000, hi: 25000 },
  { label: "25k+", lo: 25000, hi: 99000 },
];

interface Agg { n: number; u: number; v: number; temp: number; tN: number }

export class WindsLayer implements Layer {
  readonly name = "winds";

  draw(f: FrameContext): void {
    if (!f.cfg.showWinds) return;
    const rows = aggregate(f.aircraft);
    if (!rows.some((r) => r.dir != null)) return;

    const ctx = f.ctx;
    const padX = 12, rowH = 22, headH = 22;
    const w = 168;
    const h = headH + rows.length * rowH + 8;
    const x = 16, y = 16;

    ctx.save();
    roundRect(ctx, x, y, w, h, 8);
    ctx.fillStyle = "rgba(8,12,18,0.66)";
    ctx.fill();
    ctx.strokeStyle = "rgba(80,120,140,0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(150,200,220,0.9)";
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.fillText("WINDS ALOFT", x + padX, y + headH / 2 + 2);

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const ry = y + headH + i * rowH + rowH / 2;
      ctx.fillStyle = "rgba(190,200,214,0.8)";
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(r.label, x + padX, ry);

      if (r.dir == null) {
        ctx.fillStyle = "rgba(140,150,165,0.5)";
        ctx.textAlign = "right";
        ctx.fillText("—", x + w - padX, ry);
        continue;
      }
      // Arrow: points downwind (the way the air moves). dir is "from", so the vector
      // points toward dir+180.
      const ax = x + 78, to = (r.dir + 180) * DEG;
      const ux = Math.sin(to), uy = -Math.cos(to);
      ctx.strokeStyle = "rgba(120,210,235,0.9)";
      ctx.fillStyle = "rgba(120,210,235,0.9)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(ax - ux * 6, ry - uy * 6);
      ctx.lineTo(ax + ux * 6, ry + uy * 6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ax + ux * 6, ry + uy * 6);
      ctx.lineTo(ax + ux * 6 - (ux + uy) * 3.4, ry + uy * 6 - (uy - ux) * 3.4);
      ctx.lineTo(ax + ux * 6 - (ux - uy) * 3.4, ry + uy * 6 - (uy + ux) * 3.4);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "rgba(224,236,244,0.92)";
      ctx.font = "600 11px system-ui, sans-serif";
      ctx.textAlign = "right";
      const t = r.temp != null ? `  ${r.temp > 0 ? "+" : ""}${Math.round(r.temp)}°` : "";
      ctx.fillText(`${pad3(r.dir)}°/${Math.round(r.spd!)}${t}`, x + w - padX, ry);
    }
    ctx.restore();
  }
}

interface Row { label: string; dir: number | null; spd: number | null; temp: number | null }

function aggregate(list: Visible[]): Row[] {
  const aggs: Agg[] = BANDS.map(() => ({ n: 0, u: 0, v: 0, temp: 0, tN: 0 }));
  for (const a of list) {
    if (a.windSpd == null || a.windDir == null) continue;
    const alt = a.altBaro ?? a.altGeom;
    if (alt == null) continue;
    const bi = BANDS.findIndex((b) => alt >= b.lo && alt < b.hi);
    if (bi < 0) continue;
    const ag = aggs[bi];
    // "from" direction → vector components, averaged, then back to a "from" bearing.
    ag.u += a.windSpd * Math.sin(a.windDir * DEG);
    ag.v += a.windSpd * Math.cos(a.windDir * DEG);
    ag.n++;
    if (a.oat != null) { ag.temp += a.oat; ag.tN++; }
  }
  return BANDS.map((b, i) => {
    const ag = aggs[i];
    if (ag.n === 0) return { label: b.label, dir: null, spd: null, temp: null };
    const u = ag.u / ag.n, v = ag.v / ag.n;
    let dir = Math.atan2(u, v) / DEG;
    dir = (dir + 360) % 360;
    return { label: b.label, dir, spd: Math.hypot(u, v), temp: ag.tN ? ag.temp / ag.tN : null };
  });
}

function pad3(n: number): string {
  const v = Math.round(n) % 360;
  return v.toString().padStart(3, "0");
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
