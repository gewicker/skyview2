import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { useStream } from "../lib/useStream";
import { Renderer } from "./render/Renderer";
import type { Config } from "@shared/types";

const DEFAULTS_LOADING = "Connecting to SkyView…";

function Display() {
  const { state } = useStream("display");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);

  // Keep the latest config in a ref so the RAF loop always reads fresh values.
  const cfgRef = useRef<Config | null>(state.config);
  cfgRef.current = state.config;

  useEffect(() => {
    if (!canvasRef.current) return;
    const r = new Renderer(canvasRef.current, () => cfgRef.current as Config);
    rendererRef.current = r;
    if (cfgRef.current) r.start();
    const onResize = () => r.resize();
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); r.stop(); };
  }, []);

  // Start once config arrives; feed snapshots.
  useEffect(() => { if (state.config) rendererRef.current?.start(); }, [state.config]);
  useEffect(() => { rendererRef.current?.update(state.aircraft); }, [state.now, state.aircraft]);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      {!state.config && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center",
          color: "#6b7686", font: "14px system-ui" }}>{DEFAULTS_LOADING}</div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><Display /></StrictMode>,
);
