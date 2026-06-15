import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as RPointerEvent, WheelEvent as RWheelEvent } from "react";
import { useStream } from "../lib/useStream";
import { Renderer } from "./render/Renderer";
import { MapLayer } from "./render/MapLayer";
import { TrailLayer } from "./render/TrailLayer";
import { AircraftLayer } from "./render/AircraftLayer";
import { SpotlightLayer } from "./render/SpotlightLayer";
import type { Config } from "@shared/types";

export default function Display() {
  const { state, conn } = useStream("display");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const cfgRef = useRef<Config | null>(state.config);
  cfgRef.current = state.config;

  const [selected, setSelected] = useState<string | null>(null);

  // Pointer/gesture state.
  const ptrs = useRef<Map<number, { x: number; y: number }>>(new Map());
  const drag = useRef<{ lx: number; ly: number; sx: number; sy: number; moved: boolean; t: number } | null>(null);
  const pinch = useRef(0);
  const wheelTimer = useRef(0);

  useEffect(() => {
    if (!canvasRef.current) return;
    const r = new Renderer(canvasRef.current, () => cfgRef.current as Config);
    r.use(new MapLayer());
    r.use(new TrailLayer());
    r.use(new AircraftLayer());
    r.use(new SpotlightLayer());
    rendererRef.current = r;
    r.start();
    const onResize = () => r.resize();
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); r.stop(); };
  }, []);

  useEffect(() => { rendererRef.current?.update(state.aircraft); }, [state.now, state.aircraft]);

  const rel = (e: RPointerEvent | RWheelEvent) => {
    const rc = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rc.left, y: e.clientY - rc.top };
  };
  const commit = () => {
    const r = rendererRef.current;
    if (!r) return;
    conn.patchConfig(r.getView());
    r.scheduleRelease();
  };

  const onDown = (e: RPointerEvent) => {
    canvasRef.current!.setPointerCapture(e.pointerId);
    const p = rel(e);
    ptrs.current.set(e.pointerId, p);
    if (ptrs.current.size === 1) drag.current = { lx: p.x, ly: p.y, sx: p.x, sy: p.y, moved: false, t: Date.now() };
    else if (ptrs.current.size === 2) {
      const a = [...ptrs.current.values()];
      pinch.current = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      drag.current = null;
    }
  };
  const onMove = (e: RPointerEvent) => {
    if (!ptrs.current.has(e.pointerId)) return;
    const p = rel(e);
    ptrs.current.set(e.pointerId, p);
    const r = rendererRef.current;
    if (!r) return;
    if (ptrs.current.size >= 2) {
      const a = [...ptrs.current.values()];
      const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      if (pinch.current > 0 && d > 0) r.zoomAt(d / pinch.current, (a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2);
      pinch.current = d;
    } else if (drag.current) {
      r.panByPixels(p.x - drag.current.lx, p.y - drag.current.ly);
      drag.current.lx = p.x; drag.current.ly = p.y;
      if (Math.abs(p.x - drag.current.sx) + Math.abs(p.y - drag.current.sy) > 5) drag.current.moved = true;
    }
  };
  const onUp = (e: RPointerEvent) => {
    const size = ptrs.current.size;
    const p = ptrs.current.get(e.pointerId);
    ptrs.current.delete(e.pointerId);
    const r = rendererRef.current;
    if (r) {
      if (size === 1 && drag.current && !drag.current.moved && Date.now() - drag.current.t < 300 && p) {
        const hex = r.pickAt(p.x, p.y); // tap: select a plane, or deselect on empty
        r.select(hex);
        setSelected(hex);
      } else if (size >= 1) {
        commit();
      }
    }
    if (ptrs.current.size === 0) { drag.current = null; pinch.current = 0; }
  };
  const onWheel = (e: RWheelEvent) => {
    const r = rendererRef.current;
    if (!r) return;
    const p = rel(e);
    r.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y);
    clearTimeout(wheelTimer.current);
    wheelTimer.current = window.setTimeout(commit, 300);
  };

  const zoom = (f: number) => {
    const r = rendererRef.current, cv = canvasRef.current;
    if (!r || !cv) return;
    r.zoomAt(f, cv.clientWidth / 2, cv.clientHeight / 2);
    commit();
  };
  const home = () => {
    const c = cfgRef.current, r = rendererRef.current;
    if (!c) return;
    conn.patchConfig({ mapCenterLat: c.centerLat, mapCenterLon: c.centerLon, mapZoom: 1 });
    r?.scheduleRelease(80);
  };

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block", touchAction: "none", cursor: "grab" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
      />
      {!state.config && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center",
          color: "#6b7686", font: "14px system-ui" }}>Connecting to SkyView…</div>
      )}

      {/* On-screen quick controls. */}
      <div style={{ position: "absolute", right: 16, bottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <CtlBtn label="+" onClick={() => zoom(1.3)} />
        <CtlBtn label="−" onClick={() => zoom(1 / 1.3)} />
        <CtlBtn label="⌂" onClick={home} title="Recenter on home" />
      </div>
      <div style={{ position: "absolute", left: 16, bottom: 16 }}>
        <CtlBtn label="⚙" onClick={() => window.open("/control.html", "_blank")} title="Settings" />
      </div>
      {selected && (
        <div style={{ position: "absolute", left: "50%", bottom: 16, transform: "translateX(-50%)" }}>
          <button onClick={() => { rendererRef.current?.select(null); setSelected(null); }}
            style={{ ...btnBase, width: "auto", padding: "0 16px", borderRadius: 22, font: "500 13px system-ui" }}>
            ✕ Deselect
          </button>
        </div>
      )}
    </div>
  );
}

const btnBase: React.CSSProperties = {
  width: 44, height: 44, borderRadius: "50%", border: "0.5px solid rgba(255,255,255,0.18)",
  background: "rgba(18,22,28,0.62)", color: "rgba(235,240,248,0.95)", font: "20px system-ui",
  display: "grid", placeItems: "center", cursor: "pointer", backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
};

function CtlBtn({ label, onClick, title }: { label: string; onClick: () => void; title?: string }) {
  return <button onClick={onClick} title={title} aria-label={title || label} style={btnBase}>{label}</button>;
}
