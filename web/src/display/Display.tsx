import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as RPointerEvent, WheelEvent as RWheelEvent } from "react";
import { useStream } from "../lib/useStream";
import { Renderer, type TransitPick } from "./render/Renderer";
import { MapLayer } from "./render/MapLayer";
import { AirportsLayer } from "./render/AirportsLayer";
import { AirportDiagramLayer } from "./render/AirportDiagramLayer";
import { SeaplaneLayer } from "./render/SeaplaneLayer";
import { SeaplaneApproachLayer } from "./render/SeaplaneApproachLayer";
import { StaticOverlayLayer } from "./render/StaticOverlayLayer";
import { NightLightsLayer } from "./render/NightLightsLayer";
import { ApproachLayer, arrivalField } from "./render/ApproachLayer";
import { ProcedureLayer } from "./render/ProcedureLayer";
import { NavaidLayer } from "./render/NavaidLayer";
import { PlaceLabelsLayer } from "./render/PlaceLabelsLayer";
import { TrailLayer } from "./render/TrailLayer";
import { RouteLayer } from "./render/RouteLayer";
import { MarineLayer } from "./render/MarineLayer";
import { RadarLayer } from "./render/RadarLayer";
import { HighwayLayer } from "./render/HighwayLayer";
import { RailLayer } from "./render/RailLayer";
import { RailLineLayer } from "./render/RailLineLayer";
import { TrainLayer } from "./render/TrainLayer";
import { BusLayer } from "./render/BusLayer";
import { BusRouteLayer } from "./render/BusRouteLayer";
import { FerryLayer } from "./render/FerryLayer";
import { FerryRouteLayer } from "./render/FerryRouteLayer";
import { FireEmsLayer } from "./render/FireEmsLayer";
import { classifyIncident } from "./render/livefire";
import { AIRPORTS } from "./render/airports";
import { LeaderLayer } from "./render/LeaderLayer";
import { AircraftLayer } from "./render/AircraftLayer";
import { SpotlightLayer } from "./render/SpotlightLayer";
import { NotableLayer } from "./render/NotableLayer";
import { HoldingLayer } from "./render/HoldingLayer";
import { WindsLayer } from "./render/WindsLayer";
import { AtmosphereLayer } from "./render/AtmosphereLayer";
import { getPhoto } from "./render/photos";
import { isLightsOut, sunAltitude } from "./render/sun";
import Control from "../control/Control";
import { loadLocal, saveLocal, clearLocal } from "../lib/localConfig";
import type { Aircraft, Config } from "@shared/types";

export default function Display() {
  const { state, conn } = useStream("display");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const cfgRef = useRef<Config | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [, setSelectedNav] = useState<string | null>(null); // tapped navaid/fix/final
  const [transit, setTransit] = useState<TransitPick | null>(null); // tapped train/bus/station
  const [showSettings, setShowSettings] = useState(false);
  const [orbit, setOrbit] = useState({ x: 0, y: 0 }); // burn-in step offset (kiosk)

  // On the Pi kiosk we launch with ?kiosk=1: hide the cursor entirely. On the web
  // we always keep the cursor visible.
  const isKiosk = typeof location !== "undefined" && new URLSearchParams(location.search).has("kiosk");
  // Only a ceiling projector (?kiosk=projector) actually powers off at lights-out; the
  // bedside touchscreen stays on with the dim amber night view.
  const isProjector = typeof location !== "undefined" && new URLSearchParams(location.search).get("kiosk") === "projector";

  // Per-surface config. The kiosk renders the shared server config directly; the web
  // layers LOCAL overrides on top so it can look different from the touch display.
  const [localCfg, setLocalCfg] = useState<Partial<Config>>(() => (isKiosk ? {} : loadLocal()));
  const effective: Config | null = state.config
    ? (isKiosk ? state.config : { ...state.config, ...localCfg })
    : null;
  cfgRef.current = effective;
  const localDirty = !isKiosk && Object.keys(localCfg).length > 0;
  const burnIn = isKiosk && !!effective?.burnInOrbit;

  // Apply a config change to the right place: server (kiosk) or local overrides (web).
  const applyConfig = (patch: Partial<Config>) => {
    if (isKiosk) { conn.patchConfig(patch); return; }
    setLocalCfg((prev) => { const next = { ...prev, ...patch }; saveLocal(next); return next; });
  };
  // Push the FULL effective config (WYSIWYG) so the kiosk becomes an exact replica of
  // the web view — not just the deltas. muteUntil is forced to 0 so a daytime push never
  // carries a transient "mute now" to the bedside panel.
  const pushToDisplay = () => {
    if (!effective) return;
    conn.patchConfig({ ...effective, muteUntil: 0 });
  };
  const resetToDisplay = () => { setLocalCfg({}); clearLocal(); };

  // "Mute now": bring the lights-out night view forward; auto-clears at sunrise (the
  // 24h is just a safety cap — it's only honored while dark). `muteArmed` is the latch;
  // `muted` is whether it's actually applying right now (so the icon never lies).
  const muteArmed = (effective?.muteUntil ?? 0) > Date.now();
  const muted = muteArmed && !!effective &&
    sunAltitude(effective.centerLat, effective.centerLon, new Date(Date.now() + (effective.skyTimeOffsetMin || 0) * 60000)) < 0;
  const toggleMute = () => applyConfig({ muteUntil: muteArmed ? 0 : Date.now() + 24 * 3600 * 1000 });

  // Auto-hide the on-screen controls after a few seconds of no pointer activity.
  const [uiVisible, setUiVisible] = useState(true);
  const uiTimer = useRef(0);
  const pokeUi = () => {
    setUiVisible(true);
    clearTimeout(uiTimer.current);
    uiTimer.current = window.setTimeout(() => setUiVisible(false), 14000); // longer idle window — the controls were vanishing too fast on a glanceable device
  };

  // Pointer/gesture state.
  const ptrs = useRef<Map<number, { x: number; y: number }>>(new Map());
  const drag = useRef<{ lx: number; ly: number; sx: number; sy: number; moved: boolean; t: number } | null>(null);
  const pinch = useRef(0);
  const wheelTimer = useRef(0);

  useEffect(() => {
    if (!canvasRef.current) return;
    const r = new Renderer(canvasRef.current, () => cfgRef.current as Config);
    r.use(new MapLayer());
    r.use(new RadarLayer());   // precip radar (weather) — translucent tint on the ground, off by default
    // Static airport geometry (taxiways/aprons/buildings + runways) baked into one cached
    // buffer keyed on the view — full-res at rest, re-baked only when the view settles.
    r.use(new StaticOverlayLayer([new AirportDiagramLayer(), new SeaplaneLayer(), new AirportsLayer()],
      (f) => `${f.cfg.showAirport}|${f.cfg.showApproaches}`));
    r.use(new NightLightsLayer());    // runway/approach lights at night on the active runway
    r.use(new ApproachLayer());
    r.use(new SeaplaneApproachLayer()); // water-lane tag for low/slow floatplanes on the lakes
    r.use(new ProcedureLayer()); // final-approach vectors (under traffic), off by default
    r.use(new NavaidLayer());    // VOR roses / fixes (under traffic), off by default
    r.use(new StaticOverlayLayer([new PlaceLabelsLayer()], (f) => f.cfg.mapStyle));
    r.use(new MarineLayer());  // coastal fog (weather) — under the traffic, off by default
    r.use(new FireEmsLayer()); // live Fire/EMS 911 incidents — subordinate ground markers, under all traffic
    r.use(new HighwayLayer()); // synthetic road traffic (ambient) — above fog, off by default
    r.use(new FerryRouteLayer()); // dep→arr crossing lane for the tapped ferry (under the hull)
    r.use(new FerryLayer());   // live WA State Ferries (WSF) — real boats (deprecated the synthetic VesselLayer)
    r.use(new StaticOverlayLayer([new RailLineLayer()], (f) => (f.cfg.showRail ? "rail" : ""))); // baked Link ribbon — transform-blits during gestures (perf)
    r.use(new RailLayer());    // Link stations (live bloom + arrival rings) — over the baked ribbon
                               // (real infrastructure shouldn't be buried by the congestion ribbon),
                               // still below trains/aircraft (brightness law)
    r.use(new BusRouteLayer()); // route shape for the tapped bus (under the beads) — on-tap reveal
    r.use(new BusLayer());     // live Metro + ST buses (OBA) — real transit, above the car wash, below trains
    r.use(new TrainLayer());   // Link trains (live OBA beads + timetable fallback; rides the rail toggle)
    r.use(new TrailLayer());
    r.use(new RouteLayer());   // dashed great-circle to destination for the selected aircraft
    r.use(new LeaderLayer());
    r.use(new AircraftLayer());
    r.use(new SpotlightLayer());
    r.use(new NotableLayer());
    r.use(new HoldingLayer());
    r.use(new WindsLayer());
    r.use(new AtmosphereLayer()); // dimming/golden wash on top of everything
    rendererRef.current = r;
    r.start();
    const onResize = () => r.resize();
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); r.stop(); };
  }, []);

  useEffect(() => { rendererRef.current?.update(state.aircraft); }, [state.now, state.aircraft]);

  // A DOM detail card open (aircraft or transit) → suppress the canvas overhead placard so it
  // never repaints over the card.
  useEffect(() => { rendererRef.current?.setCardOpen(!!selected || !!transit); }, [selected, transit]);

  // Despawn the tap card when the selected contact leaves range or is panned off-screen.
  useEffect(() => {
    if (!selected) return;
    const r = rendererRef.current;
    if (r && !r.onScreen(selected)) { r.select(null); setSelected(null); }
  }, [state.now, selected]);

  // Same for the transit/incident card: despawn it when the tapped element drops from its feed
  // (out of range) or is panned off-screen, so it can't linger over empty map (QA-BUGSCRUB P1).
  useEffect(() => {
    if (!transit) return;
    const r = rendererRef.current;
    if (r && !r.onScreenTransit(transit)) { r.selectFerry(null); r.selectBus(null); setTransit(null); }
  }, [state.now, transit]);

  // Burn-in: step the canvas to a new offset every 25 s (CSS glides it over 5 s, then
  // the compositor goes idle) — far cheaper than a continuous animation on the Pi GPU.
  useEffect(() => {
    if (!burnIn) { setOrbit({ x: 0, y: 0 }); return; }
    const pts = [[0, 0], [11, 5], [6, 12], [-8, 9], [-11, -4], [4, -10]];
    let i = 0;
    const id = window.setInterval(() => { i = (i + 1) % pts.length; setOrbit({ x: pts[i][0], y: pts[i][1] }); }, 25000);
    return () => clearInterval(id);
  }, [burnIn]);

  // Pre-fetch photos for the nearest aircraft each frame so the spotlight card is
  // instant when one auto-features or the user taps it. getPhoto caches + dedupes.
  useEffect(() => {
    const c = cfgRef.current;
    if (!c) return;
    const near = state.aircraft
      .filter((a) => a.lat != null && a.lon != null)
      .map((a) => ({ a, d: (a.lat! - c.centerLat) ** 2 + (a.lon! - c.centerLon) ** 2 }))
      .sort((x, y) => x.d - y.d)
      .slice(0, 16);
    for (const { a } of near) getPhoto(a.hex, a.registration);
    // Always warm the tapped/selected aircraft's photo immediately.
    if (selected) { const s = state.aircraft.find((a) => a.hex === selected); if (s) getPhoto(s.hex, s.registration); }
  }, [state.now]);

  // Start the auto-hide timer once on mount; clear it on unmount.
  useEffect(() => { pokeUi(); return () => clearTimeout(uiTimer.current); }, []);

  // Lights-out: on the Pi, actually cut the display power across the bedtime→sunrise
  // boundary (not just render black) so the panel/projector isn't glowing all night.
  useEffect(() => {
    if (!isProjector) return;
    let last: boolean | null = null;
    const tick = () => {
      const c = cfgRef.current;
      if (!c) return;
      const date = new Date(Date.now() + (c.skyTimeOffsetMin || 0) * 60000);
      const dark = sunAltitude(c.centerLat, c.centerLon, date) < 0;
      const lo = c.monitorMode === "lightsout" &&
        (isLightsOut(c.centerLat, c.centerLon, c.lightsOutHour ?? 23, date) ||
          ((c.muteUntil ?? 0) > Date.now() && dark));
      const on = !lo;
      if (on !== last) { last = on; void fetch(`/api/display/power?on=${on ? 1 : 0}`, { method: "POST" }); }
    };
    tick();
    const id = window.setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [isProjector]);

  const rel = (e: RPointerEvent | RWheelEvent) => {
    const rc = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rc.left, y: e.clientY - rc.top };
  };
  const commit = () => {
    const r = rendererRef.current;
    if (!r) return;
    applyConfig(r.getView());
    r.scheduleRelease();
  };

  const onDown = (e: RPointerEvent) => {
    pokeUi();
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
    pokeUi(); // any pointer movement (hover or drag) keeps the controls visible
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
        // Tap: a plane wins; otherwise a navaid/fix/final (overlay tap-to-reveal); else clear.
        const hex = r.pickAt(p.x, p.y);
        if (hex) {
          r.select(hex); setSelected(hex);
          r.selectNav(null); setSelectedNav(null);
          setTransit(null); r.selectFerry(null); r.selectBus(null);
        } else {
          const tp = r.pickTransit(p.x, p.y); // a train/bus/station, before navaids
          if (tp) {
            setTransit(tp);
            r.selectFerry(tp.kind === "ferry" ? tp.id : null); // crossing lane for a tapped ferry
            r.selectBus(tp.kind === "bus" ? tp.id : null);     // route shape for a tapped bus
            r.select(null); setSelected(null);
            r.selectNav(null); setSelectedNav(null);
            r.dismissSpotlight();
          } else {
            const nid = r.pickStatic(p.x, p.y);
            r.selectNav(nid); setSelectedNav(nid);
            r.select(null); setSelected(null);
            setTransit(null); r.selectFerry(null); r.selectBus(null);
            r.dismissSpotlight(); // tapping off a plane also drops the overhead card
          }
        }
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
    applyConfig({ mapCenterLat: c.centerLat, mapCenterLon: c.centerLon, mapZoom: 1 });
    r?.scheduleRelease(80);
  };

  const sel = selected ? state.aircraft.find((a) => a.hex === selected) : undefined;
  // Dark-red control chrome at night so opening settings at the bedside doesn't blast white light.
  const ctlNight = effective?.monitorMode === "red" || effective?.monitorMode === "lightsout"
    || effective?.monitorMode === "night" || muted;

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {/* Burn-in protection: STEP the canvas a few px every 25 s (glide 5 s, then sit
          still) so static elements never sit on the same pixels — but the compositor is
          idle between steps, unlike a continuous animation. Oversized so no black edge. */}
      <canvas
        ref={canvasRef}
        style={burnIn
          ? { position: "absolute", top: -16, left: -16, width: "calc(100% + 32px)", height: "calc(100% + 32px)",
              display: "block", touchAction: "none", cursor: isKiosk ? "none" : "grab",
              transform: `translate(${orbit.x}px, ${orbit.y}px)`, transition: "transform 5s ease-in-out" }
          : { width: "100%", height: "100%", display: "block", touchAction: "none", cursor: isKiosk ? "none" : "grab" }}
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

      {/* Rich tap card for a selected aircraft (top-right). */}
      {sel && state.config && (
        <TapCard a={sel} cfg={state.config}
          onClose={() => { rendererRef.current?.select(null); rendererRef.current?.dismissSpotlight(); setSelected(null); }} />
      )}
      {transit && <TransitCard pick={transit} onClose={() => { setTransit(null); rendererRef.current?.selectFerry(null); rendererRef.current?.selectBus(null); }} />}

      {/* On-screen quick controls — auto-hide after inactivity. */}
      <div style={{ position: "absolute", right: 16, bottom: 16, display: "flex", flexDirection: "column", gap: 10, ...autoHide(uiVisible) }}>
        <CtlBtn label="+" onClick={() => zoom(1.3)} />
        <CtlBtn label="−" onClick={() => zoom(1 / 1.3)} />
        <CtlBtn label="⌂" onClick={home} title="Recenter on home" />
      </div>
      <div style={{ position: "absolute", left: 16, bottom: 16, display: "flex", flexDirection: "column", gap: 10, ...autoHide(uiVisible) }}>
        <CtlBtn label={muted ? "☀" : "🌙"} onClick={toggleMute}
          title={muted ? "Resume — clear night mute" : "Mute now (night) until sunrise"} />
        <CtlBtn label="⚙" onClick={() => setShowSettings(true)} title="Settings" />
      </div>
      {selected && (
        <div style={{ position: "absolute", left: "50%", bottom: 16, transform: "translateX(-50%)", ...autoHide(uiVisible) }}>
          <button onClick={() => { rendererRef.current?.select(null); rendererRef.current?.dismissSpotlight(); setSelected(null); }}
            style={{ ...btnBase, width: "auto", padding: "0 16px", borderRadius: 22, font: "500 13px system-ui" }}>
            ✕ Deselect
          </button>
        </div>
      )}

      {/* Settings drawer — the full control panel, slid in over the display. Works on
          the kiosk touch screen and on the web; no separate tab/page needed. */}
      {showSettings && (
        <div onClick={() => setShowSettings(false)}
          style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", justifyContent: "flex-end",
            background: "rgba(0,0,0,0.45)" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: "min(440px, 96%)", height: "100%", background: ctlNight ? "#160c0c" : "#f2f2f7",
              boxShadow: "-10px 0 36px rgba(0,0,0,0.45)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "12px 16px", borderBottom: `1px solid ${ctlNight ? "#3a2020" : "#d6d6db"}`, background: ctlNight ? "#1e1010" : "#f2f2f7" }}>
              <span style={{ font: "600 16px system-ui", color: ctlNight ? "#e6c2b4" : "#1c1c1e" }}>Settings</span>
              <button onClick={() => setShowSettings(false)}
                style={{ border: 0, background: ctlNight ? "#3a2222" : "#e4e4ea", color: ctlNight ? "#e6c2b4" : "#1c1c1e", borderRadius: 16,
                  padding: "9px 18px", font: "600 15px system-ui", cursor: "pointer" }}>Done</button>
            </div>
            <div style={{ flex: 1, overflow: "auto" }}>
              {effective ? (
                <Control config={effective} surface={isKiosk ? "touch" : "web"}
                  onChange={applyConfig}
                  onPush={() => { pushToDisplay(); setShowSettings(false); }}
                  onReset={resetToDisplay}
                  onRestart={() => { void fetch("/api/kiosk/restart", { method: "POST" }); }}
                  onResetAll={() => conn.resetConfig()}
                  dirty={localDirty}
                  scenes={state.scenes}
                  onSaveScene={(n) => (isKiosk ? conn.saveScene(n) : conn.saveScene(n, effective ?? undefined))}
                  onApplyScene={(n) => { if (!isKiosk) resetToDisplay(); conn.applyScene(n); }}
                  onDeleteScene={(n) => conn.deleteScene(n)} />
              ) : (
                <div style={{ padding: 24, font: "15px system-ui", color: "#8a8f98" }}>Connecting…</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const btnBase: React.CSSProperties = {
  width: 60, height: 60, borderRadius: "50%", border: "0.5px solid rgba(255,255,255,0.18)",
  background: "rgba(18,22,28,0.62)", color: "rgba(235,240,248,0.95)", font: "24px system-ui",
  display: "grid", placeItems: "center", cursor: "pointer", backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
};

function CtlBtn({ label, onClick, title }: { label: string; onClick: () => void; title?: string }) {
  return <button onClick={onClick} title={title} aria-label={title || label} style={btnBase}>{label}</button>;
}

// Rich detail card shown when an aircraft is tapped. Pulls the photo from the server
// proxy and lays out everything the radio + enrichment know, updating live each frame.
function TapCard({ a, cfg, onClose }: { a: Aircraft; cfg: Config; onClose: () => void }) {
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setPhoto(null);
    fetch(`/api/photo/${a.hex}${a.registration ? `?reg=${encodeURIComponent(a.registration)}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j && j.url) setPhoto(j.url as string); })
      .catch(() => {});
    return () => { alive = false; };
  }, [a.hex]);

  const C = {
    primary: "#F4F6F9", secondary: "#AEB7C4", tertiary: "#6B7480", accent: "#5BB8FF",
    accentDim: "rgba(91,184,255,0.14)", up: "#6FD08C", down: "#E8A15C", div: "rgba(255,255,255,0.07)",
  };
  const callsign = a.flight || a.registration || a.hex.toUpperCase();
  const ends = routeEnds(a);
  // Tier-1 flight plan: progress along the route + distance remaining + ETA, from the endpoint
  // coords we already have. progress is null when we can't place the aircraft on the leg.
  let progress: number | null = null, distRemNm: number | null = null, eta: string | null = null;
  if (ends && ends.to.lat != null && ends.to.lon != null && a.lat != null && a.lon != null) {
    const remMi = haversine(a.lat, a.lon, ends.to.lat, ends.to.lon);
    if (remMi != null) {
      distRemNm = Math.round(remMi * 0.8689);
      if (a.gs != null && a.gs > 40) {
        const dd = new Date(Date.now() + ((remMi * 0.8689) / a.gs) * 3600 * 1000);
        eta = `${String(dd.getHours()).padStart(2, "0")}:${String(dd.getMinutes()).padStart(2, "0")}`;
      }
      if (ends.from.lat != null && ends.from.lon != null) {
        const total = haversine(ends.from.lat, ends.from.lon, ends.to.lat, ends.to.lon);
        const flown = haversine(ends.from.lat, ends.from.lon, a.lat, a.lon);
        if (total != null && flown != null && total > 1) progress = Math.max(0, Math.min(1, flown / total));
      }
    }
  }
  const onGround = !!a.onGround;
  const altVal = onGround ? "Ground" : a.altBaro != null ? Math.round(a.altBaro).toLocaleString() : "—";
  const spdVal = a.gs != null ? Math.round(a.gs).toLocaleString() : "—";
  const vr = a.baroRate;
  const level = onGround || vr == null || Math.abs(vr) < 100;
  const vsArrow = level ? "–" : vr! > 0 ? "▲" : "▼";
  const vsVal = level ? "Level" : Math.abs(Math.round(vr!)).toLocaleString();
  const apTgt = !onGround && (a.selAlt ?? a.fmsAlt) != null ? Math.round((a.selAlt ?? a.fmsAlt)!).toLocaleString() : null;
  const foot = [a.squawk ? `SQ ${a.squawk}` : "", a.registration || "", a.typeCode || ""].filter(Boolean).join("   ·   ");
  const d = haversine(cfg.centerLat, cfg.centerLon, a.lat, a.lon);
  const brg = a.lat != null && a.lon != null ? bearing(cfg.centerLat, cfg.centerLon, a.lat, a.lon) : null;
  const elev = !onGround && a.altBaro != null && d != null && d > 0
    ? Math.round((Math.atan2(a.altBaro * 0.3048, Math.max(1, d * 1609.34)) * 180) / Math.PI) : null;
  const posLine = d != null ? `${d.toFixed(1)} mi ${brg != null ? compass(brg) : ""}${elev != null ? `  ·  ${elev}° up` : ""}` : "";

  const stat = (label: string, val: string, unit: string, pre?: string, preCol?: string) => (
    <div style={{ flex: 1, textAlign: "center" }}>
      <div style={{ font: "600 10px system-ui", letterSpacing: 0.6, color: C.tertiary, textTransform: "uppercase" }}>{label}</div>
      <div style={{ marginTop: 2, font: "600 15px system-ui", color: C.primary }}>
        {pre && <span style={{ color: preCol, marginRight: 3, fontSize: 12 }}>{pre}</span>}
        {val}{unit && <span style={{ font: "500 11px system-ui", color: C.secondary, marginLeft: 3 }}>{unit}</span>}
      </div>
    </div>
  );
  const vline = <div style={{ width: 1, height: 26, background: C.div, alignSelf: "center" }} />;

  return (
    <div style={{ position: "absolute", top: 16, right: 16, width: 320, maxHeight: "86%", overflow: "hidden",
      display: "flex", flexDirection: "column", borderRadius: 16, background: "rgba(15,18,24,0.82)",
      border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
      backdropFilter: "blur(16px) saturate(115%)", WebkitBackdropFilter: "blur(16px) saturate(115%)",
      fontVariantNumeric: "tabular-nums" }}>
      <div style={{ position: "relative", height: 132, flex: "none", background: photo ? undefined : "linear-gradient(160deg,#1E2530,#141821)" }}>
        {photo && <img src={photo} alt="" style={{ width: "100%", height: 132, objectFit: "cover", display: "block" }} />}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(15,18,24,0.95) 0%, rgba(15,18,24,0) 55%)" }} />
        <button onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 8, right: 8, border: 0,
          background: "rgba(0,0,0,0.4)", color: "rgba(225,232,240,0.9)", width: 26, height: 26, borderRadius: "50%", cursor: "pointer", font: "14px system-ui" }}>✕</button>
      </div>
      <div style={{ overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: "13px 16px 14px" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ font: "700 26px system-ui", letterSpacing: -0.2, color: C.primary, lineHeight: 1.05 }}>{callsign}</div>
            {a.airline && <div style={{ font: "500 14px system-ui", color: C.secondary, marginTop: 3 }}>{a.airline}</div>}
            {(a.typeName || a.typeCode) && <div style={{ font: "500 12px system-ui", color: C.tertiary, marginTop: 2 }}>{a.typeName || a.typeCode}</div>}
          </div>
          {a.typeCode && <div style={{ font: "600 11px system-ui", letterSpacing: 0.3, color: C.secondary, background: C.accentDim,
            padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)", flex: "none" }}>{a.typeCode}</div>}
        </div>
        <div style={{ height: 1, background: C.div }} />
        <div style={{ padding: "14px 16px", minHeight: 30 }}>
          {ends ? (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ font: "700 18px system-ui", letterSpacing: 0.2, color: C.primary, lineHeight: 1.05 }}>{ends.from.code || "—"}</div>
                  {ends.from.city && <div style={{ font: "500 11px system-ui", color: C.secondary, marginTop: 2, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ends.from.city}</div>}
                </div>
                <div style={{ flex: 1, position: "relative", height: 10, margin: "0 8px", display: "flex", alignItems: "center" }}>
                  {progress != null ? (
                    <>
                      <div style={{ width: "100%", height: 3, borderRadius: 2, background: "rgba(91,184,255,0.28)" }}>
                        <div style={{ width: `${(progress * 100).toFixed(1)}%`, height: 3, borderRadius: 2, background: "#5BB8FF" }} />
                      </div>
                      <div style={{ position: "absolute", left: `${(progress * 100).toFixed(1)}%`, transform: "translateX(-50%)",
                        width: 0, height: 0, borderLeft: "7px solid #F4F6F9", borderTop: "4px solid transparent", borderBottom: "4px solid transparent",
                        filter: "drop-shadow(0 0 3px rgba(91,184,255,0.7))" }} />
                    </>
                  ) : (
                    <>
                      <div style={{ flex: 1, height: 1, background: "rgba(91,184,255,0.4)" }} />
                      <span style={{ color: C.accent, font: "600 15px system-ui", marginLeft: 1 }}>→</span>
                    </>
                  )}
                </div>
                <div style={{ minWidth: 0, textAlign: "right" }}>
                  <div style={{ font: "700 18px system-ui", letterSpacing: 0.2, color: C.primary, lineHeight: 1.05 }}>{ends.to.code || "—"}</div>
                  {ends.to.city && <div style={{ font: "500 11px system-ui", color: C.secondary, marginTop: 2, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginLeft: "auto" }}>{ends.to.city}</div>}
                </div>
              </div>
              {distRemNm != null && (
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, font: "600 11px system-ui" }}>
                  <span style={{ color: C.primary }}>{distRemNm.toLocaleString()}<span style={{ color: C.secondary, fontWeight: 500, marginLeft: 3 }}>nm</span></span>
                  {eta && <span><span style={{ color: C.tertiary, fontSize: 10, fontWeight: 600 }}>ETA </span><span style={{ color: C.secondary }}>{eta}</span></span>}
                </div>
              )}
              {(() => {
                const prov = routeProvenance(a);
                return (
                  <div style={{ marginTop: 8, font: "500 10px system-ui", letterSpacing: 0.3, color: C.tertiary, display: "flex", alignItems: "center", gap: 5 }}>
                    {prov.mark && <span style={{ color: C.secondary, fontWeight: 700 }}>{prov.mark}</span>}
                    <span style={{ textTransform: "uppercase" }}>{prov.word}</span>
                    <span style={{ opacity: 0.75 }}>· {prov.note}</span>
                  </div>
                );
              })()}
            </>
          ) : (
            <div style={{ font: "500 13px system-ui", color: C.tertiary }}>◇ Route unknown</div>
          )}
        </div>
        <div style={{ height: 1, background: C.div }} />
        <div style={{ padding: "12px 16px" }}>
          <div style={{ display: "flex" }}>
            {stat("Alt", altVal, onGround || a.altBaro == null ? "" : "ft")}
            {vline}
            {stat("Spd", spdVal, a.gs != null ? "kt" : "")}
            {vline}
            {stat("V/S", vsVal, level ? "" : "fpm", vsArrow, level ? C.tertiary : vr! > 0 ? C.up : C.down)}
          </div>
          {apTgt && (
            <div style={{ marginTop: 10 }}>
              <span style={{ display: "inline-block", font: "500 11px system-ui", color: C.secondary, background: C.accentDim, padding: "4px 8px", borderRadius: 6 }}>
                ⌖ SEL <span style={{ color: C.primary }}>{apTgt} ft</span>
              </span>
            </div>
          )}
        </div>
        <div style={{ height: 1, background: C.div }} />
        <div style={{ padding: "10px 16px 12px" }}>
          <div style={{ font: "500 10.5px system-ui", letterSpacing: 0.2, color: C.tertiary, lineHeight: 1.4 }}>{foot}</div>
          {posLine && <div style={{ font: "500 10.5px system-ui", color: C.tertiary, marginTop: 4 }}>{posLine}</div>}
        </div>
      </div>
    </div>
  );
}

// Origin → destination, with a GEOMETRY leg-correction: route DBs give one canonical direction
// per callsign, often the wrong leg. The true destination is the endpoint the aircraft is heading
// TOWARD (its track points at it), so swap when the labelled origin is actually ahead.
type RouteEnd = { code?: string; city?: string; lat?: number | null; lon?: number | null };
function routeEnds(a: Aircraft): { from: RouteEnd; to: RouteEnd } | null {
  const arr = localArrival(a); // physical destination if it's on final to a local field
  if (!a.origin && !a.destination && !arr) return null;
  // The SERVER is the single authority for route direction (enrich.verifyRoute already swaps
  // reversed legs and flags uncertainty). The card renders a.origin → a.destination verbatim so it
  // always agrees with the on-map tag — no client re-swap (that second, looser swap caused the tag
  // and card to disagree and over-corrected). The one client override below: a physics-verified
  // local arrival (the same arrivalField authority the tag uses).
  const from: RouteEnd = { code: a.origin, city: a.originName, lat: a.originLat, lon: a.originLon };
  let to: RouteEnd = { code: a.destination, city: a.destName, lat: a.destLat, lon: a.destLon };
  if (arr) to = { code: arr.code, city: arr.name, lat: arr.lat, lon: arr.lon };
  return { from, to };
}

// Provenance of the shown route — mark by exception (design aac08cd5): ✓ confirmed for a route
// validated against the live flight-status API OR a physics-verified local arrival; nothing for a
// plain schedule-DB guess (the common case stays unmarked); ? unverified when the geometry check
// contradicts the schedule route. Glyph-based so it's colorblind-safe; no new colors.
function routeProvenance(a: Aircraft): { mark: string; word: string; note: string } {
  if (localArrival(a)) return { mark: "✓", word: "confirmed", note: "on final approach" };
  if (a.routeVerified) return { mark: "✓", word: "confirmed", note: "live flight status" };
  if (a.routeUncertain) return { mark: "?", word: "unverified", note: "heading doesn't match" };
  return { mark: "", word: "scheduled", note: "route database" };
}

// Compact detail card for a tapped transit element (train / bus / station). Live train shows its
// schedule deviation as plain-English on-time/late/early.
function TransitCard({ pick, onClose }: { pick: TransitPick; onClose: () => void }) {
  const lineColor = pick.kind === "train" ? (pick.line === "1" ? "#28a05a" : "#3aa0d8")
    : pick.kind === "bus" ? (/\bLine$/.test(pick.route) ? "#e06056" : "#9a8cf0")
    : pick.kind === "ferry" ? "#78aacd"
    : pick.kind === "fire" ? incidentColor(pick.title)
    : "#28e1aa";
  let title = "", sub = "", detail = "";
  if (pick.kind === "station") { title = pick.title; sub = "Link light rail station"; }
  else if (pick.kind === "train") { title = pick.line + " Line"; sub = "Link train · live"; detail = delayText(pick.devSec); }
  else if (pick.kind === "ferry") { title = pick.title; sub = pick.route || "WA State Ferry"; detail = pick.atDock ? "At dock" : Math.round(pick.speed) + " kt"; }
  else if (pick.kind === "fire") { title = pick.title; sub = pick.address || "Fire/EMS 911 dispatch"; detail = agoText(pick.time); }
  else { title = pick.route || "Bus"; sub = pick.headsign ? "→ " + pick.headsign : "Metro / Sound Transit · live"; }
  return (
    <div style={{ position: "absolute", left: 16, bottom: 160, minWidth: 184,
      background: "rgba(8,12,20,0.92)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12,
      padding: "12px 14px", color: "#dfe7f2" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: lineColor, flex: "none" }} />
          <span style={{ font: "700 16px system-ui", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#8c98a8", font: "600 14px system-ui", cursor: "pointer", flex: "none" }}>✕</button>
      </div>
      <div style={{ font: "500 11px system-ui", color: "#9fb0c2", marginTop: 4 }}>{sub}</div>
      {detail && <div style={{ font: "600 13px system-ui", marginTop: 8 }}>{detail}</div>}
    </div>
  );
}
function delayText(devSec: number): string {
  if (Math.abs(devSec) < 60) return "On time";
  const m = Math.round(Math.abs(devSec) / 60);
  return devSec > 0 ? m + " min late" : m + " min early";
}
function agoText(t: number): string {
  const m = Math.round((Date.now() - t) / 60000);
  if (m <= 0) return "just now";
  return m === 1 ? "1 min ago" : m + " min ago";
}
function incidentColor(type: string): string {
  const c = classifyIncident(type);
  return c === "major" ? "#d66c48" : c === "vehicle" ? "#c69c60" : c === "medical" ? "#968cb4" : "#808e9e";
}

// The local field an aircraft is physically landing at — the SAME approach-physics authority
// the on-screen "→ SEA" tag uses (glidepath + alignment), not nearest-centroid. This keeps the
// card's destination consistent with the tag (a SEA arrival no longer reads "→ BFI"). null if
// not established on a local final.
function localArrival(a: Aircraft): { code: string; name: string; lat: number; lon: number } | null {
  const m = arrivalField(a);
  if (!m) return null;
  const ap = AIRPORTS.find((x) => x.iata === m.iata);
  if (!ap) return null;
  let la = 0, lo = 0, n = 0;
  for (const rw of ap.runways) { la += rw.le[0] + rw.he[0]; lo += rw.le[1] + rw.he[1]; n += 2; }
  return { code: ap.iata, name: ap.name, lat: la / n, lon: lo / n };
}
function haversine(la1: number, lo1: number, la2?: number, lo2?: number): number | null {
  if (la2 == null || lo2 == null) return null;
  const R = 3958.8, DEG = Math.PI / 180;
  const p1 = la1 * DEG, p2 = la2 * DEG, dp = (la2 - la1) * DEG, dl = (lo2 - lo1) * DEG;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}
function bearing(la1: number, lo1: number, la2: number, lo2: number): number {
  const DEG = Math.PI / 180;
  const p1 = la1 * DEG, p2 = la2 * DEG, dl = (lo2 - lo1) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / DEG) % 360 + 360) % 360;
}
function compass(deg: number): string {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
}

// Fade controls in/out and disable hit-testing when hidden so they don't block taps.
function autoHide(visible: boolean): CSSProperties {
  return {
    opacity: visible ? 1 : 0,
    transition: "opacity 0.45s ease",
    pointerEvents: visible ? "auto" : "none",
  };
}
