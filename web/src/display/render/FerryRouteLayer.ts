// Crossing endpoints for the SELECTED ferry (never ambient): a labelled ring at the departing and
// arriving terminals, so a tap reads "Seattle → Bremerton" spatially. Appears on tap, clears on
// deselect. We deliberately do NOT draw a straight dep→arr line: a rhumb chord cuts across land
// (Seattle→Bremerton runs over Bainbridge/Kitsap). A true on-water crossing line needs real ferry
// route geometry (OSM water paths) — a planned upgrade. Until then, the two terminals carry it.
import type { Layer, FrameContext } from "./types";
import { liveFerries } from "./liveferries";

const LANE = "150,205,242"; // steel-cyan, matching the ferry hull

export class FerryRouteLayer implements Layer {
  readonly name = "ferry-route";

  draw(f: FrameContext): void {
    if (!f.cfg.showFerries) return;
    const id = f.selectedFerryId;
    if (!id) return;
    const v = liveFerries().find((x) => x.id === id);
    if (!v) return;
    if (!v.depLat || !v.depLon || !v.arrLat || !v.arrLon) return; // terminals unresolved

    const ctx = f.ctx;
    const dep = f.cam.project(v.depLat, v.depLon);
    const arr = f.cam.project(v.arrLat, v.arrLon);
    ctx.save();
    ctx.lineCap = "round";

    // Terminal endpoints: departing (hollow) and arriving (filled) + names split from the route.
    // (No straight connecting line — it would cross land; see header.)
    const [depName, arrName] = splitRoute(v.route);
    this.terminal(f, dep, depName, false);
    this.terminal(f, arr, arrName, true);
    ctx.restore();
  }

  private terminal(f: FrameContext, p: { x: number; y: number }, name: string, filled: boolean): void {
    if (p.x < -60 || p.x > f.w + 60 || p.y < -60 || p.y > f.h + 60) return;
    const ctx = f.ctx;
    ctx.strokeStyle = `rgba(${LANE},0.95)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.stroke();
    if (filled) {
      ctx.fillStyle = `rgba(${LANE},0.95)`;
      ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill();
    }
    if (name) {
      ctx.font = "600 10px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(8,12,18,0.85)";
      ctx.strokeText(name, p.x + 9, p.y);
      ctx.fillStyle = "rgba(238,246,252,0.96)";
      ctx.fillText(name, p.x + 9, p.y);
    }
  }
}

// "Seattle → Bainbridge Island" → ["Seattle", "Bainbridge Island"]. Falls back gracefully.
function splitRoute(route: string): [string, string] {
  const i = route.indexOf("→");
  if (i < 0) return ["", ""];
  return [route.slice(0, i).trim(), route.slice(i + 1).trim()];
}
