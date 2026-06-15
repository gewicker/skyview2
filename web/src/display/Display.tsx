import { useEffect, useRef } from "react";
import { useStream } from "../lib/useStream";
import { Renderer } from "./render/Renderer";
import { MapLayer } from "./render/MapLayer";
import { TrailLayer } from "./render/TrailLayer";
import { AircraftLayer } from "./render/AircraftLayer";
import { SpotlightLayer } from "./render/SpotlightLayer";
import type { Config } from "@shared/types";

const LOADING = "Connecting to SkyView…";

export default function Display() {
  const { state } = useStream("display");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);

  // Keep the latest config in a ref so the RAF loop always reads fresh values.
  const cfgRef = useRef<Config | null>(state.config);
  cfgRef.current = state.config;

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

  // Feed snapshots into the renderer as they arrive.
  useEffect(() => { rendererRef.current?.update(state.aircraft); }, [state.now, state.aircraft]);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      {!state.config && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center",
          color: "#6b7686", font: "14px system-ui" }}>{LOADING}</div>
      )}
    </div>
  );
}
