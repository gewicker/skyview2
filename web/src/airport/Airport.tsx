// v6 Airport View — Phase 1: a detailed TOP-DOWN view of KSEA, served to a PC/mobile client (NOT
// the kiosk). It reuses SkyView's renderer + airport-focused layers and the live aircraft stream,
// but locks the view to the field at airport scale, forces the satellite basemap + ground traffic
// on, and runs at full client resolution. This proves the Pi→client data contract end-to-end; the
// out-the-window 3D perspectives (runway/taxi/tower) are later phases (WebGL). See
// docs/AIRPORT-VIEW-DESIGN.md.
import { useEffect, useRef } from "react";
import { useStream } from "../lib/useStream";
import { Renderer } from "../display/render/Renderer";
import { MapLayer } from "../display/render/MapLayer";
import { AirportDiagramLayer } from "../display/render/AirportDiagramLayer";
import { AirportsLayer } from "../display/render/AirportsLayer";
import { NightLightsLayer } from "../display/render/NightLightsLayer";
import { ApproachLayer } from "../display/render/ApproachLayer";
import { TrailLayer } from "../display/render/TrailLayer";
import { LeaderLayer } from "../display/render/LeaderLayer";
import { AircraftLayer } from "../display/render/AircraftLayer";
import { AtmosphereLayer } from "../display/render/AtmosphereLayer";
import { KSEA } from "../display/render/airports";
import type { Config } from "@shared/types";

// KSEA field reference point = mean of all six runway thresholds (data, not a magic constant).
function kseaCenter(): { lat: number; lon: number } {
  let la = 0, lo = 0, n = 0;
  for (const rw of KSEA.runways) { la += rw.le[0] + rw.he[0]; lo += rw.le[1] + rw.he[1]; n += 2; }
  return { lat: la / n, lon: lo / n };
}
const KC = kseaCenter();
const FIELD_ZOOM = 6; // mapZoom → ~2.7 mi screen span: frames the three-runway field with margin

export default function Airport() {
  const { state } = useStream("display"); // same stream the kiosk uses (config + live aircraft)
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const cfgRef = useRef<Config | null>(null);

  // Airport-locked config: inherit the server's palette / sun-time / feed toggles, but reframe on
  // KSEA at field scale, satellite basemap, and force the things a field view needs (ground traffic
  // visible, no altitude floor, full client resolution, no kiosk burn-in / follow / dimming).
  const cfg: Config | null = state.config ? {
    ...state.config,
    mapCenterLat: KC.lat, mapCenterLon: KC.lon, mapZoom: FIELD_ZOOM,
    centerLat: KC.lat, centerLon: KC.lon,
    mapRotationDeg: 0, rotationDeg: 0, mirrorX: false, mirrorY: false,
    mapStyle: "satellite", showAirport: true, showApproaches: true, showFinal: true,
    hideOnGround: false, minAltitudeFt: 0,
    renderScale: 1, maxFps: 60,
    followSelected: false, burnInOrbit: false, monitorMode: "day",
  } : null;
  cfgRef.current = cfg;

  useEffect(() => {
    if (!canvasRef.current) return;
    const r = new Renderer(canvasRef.current, () => cfgRef.current as Config);
    r.use(new MapLayer());            // satellite basemap — real field imagery under the vector field
    r.use(new AirportDiagramLayer()); // OSM taxiways / aprons / buildings / boundary
    r.use(new AirportsLayer());       // FAA runways
    r.use(new NightLightsLayer());    // runway/approach lighting at night
    r.use(new ApproachLayer());       // final-approach corridors
    r.use(new TrailLayer());          // aircraft comet trails
    r.use(new LeaderLayer());         // data tags
    r.use(new AircraftLayer());       // live traffic (airborne + on-ground)
    r.use(new AtmosphereLayer());     // day/night wash
    rendererRef.current = r;
    r.start();
    const onResize = () => r.resize();
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); r.stop(); };
  }, []);

  useEffect(() => { rendererRef.current?.update(state.aircraft); }, [state.now, state.aircraft]);

  // Live count within ~6 mi of the field, for the header (rough equirectangular distance is plenty).
  const near = state.aircraft.filter((a) =>
    a.lat != null && a.lon != null &&
    Math.hypot((a.lat - KC.lat) * 69, (a.lon - KC.lon) * 46.6) < 6).length;

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#05080d" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      {!state.config && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center",
          color: "#6b7686", font: "14px system-ui" }}>Connecting to SkyView…</div>
      )}
      <div style={{ position: "absolute", top: 16, left: 16, color: "#dfe7f2",
        textShadow: "0 1px 4px rgba(0,0,0,0.6)", pointerEvents: "none" }}>
        <div style={{ font: "700 20px system-ui", letterSpacing: 0.3 }}>KSEA · Seattle–Tacoma</div>
        <div style={{ font: "500 12px system-ui", color: "#9fb0c2", marginTop: 2 }}>
          Top-down field · {near} aircraft in view
        </div>
      </div>
    </div>
  );
}
