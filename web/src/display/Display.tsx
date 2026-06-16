import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as RPointerEvent, WheelEvent as RWheelEvent } from "react";
import { useStream } from "../lib/useStream";
import { Renderer } from "./render/Renderer";
import { MapLayer } from "./render/MapLayer";
import { AirportsLayer } from "./render/AirportsLayer";
import { ApproachLayer } from "./render/ApproachLayer";
import { PlaceLabelsLayer } from "./render/PlaceLabelsLayer";
import { TrailLayer } from "./render/TrailLayer";
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
  const [showSettings, setShowSettings] = useState(false);

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
    uiTimer.current = window.setTimeout(() => setUiVisible(false), 5000);
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
    r.use(new AirportsLayer());
    r.use(new ApproachLayer());
    r.use(new PlaceLabelsLayer());
    r.use(new TrailLayer());
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

  // Despawn the tap card when the selected contact leaves range or is panned off-screen.
  useEffect(() => {
    if (!selected) return;
    const r = rendererRef.current;
    if (r && !r.onScreen(selected)) { r.select(null); setSelected(null); }
  }, [state.now, selected]);

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
    applyConfig({ mapCenterLat: c.centerLat, mapCenterLon: c.centerLon, mapZoom: 1 });
    r?.scheduleRelease(80);
  };

  const sel = selected ? state.aircraft.find((a) => a.hex === selected) : undefined;

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {/* Burn-in protection: on the kiosk, drift the whole canvas a few px in a slow
          150s orbit so static elements never sit on the same pixels. The canvas is
          oversized so the drift never exposes a black edge. */}
      <style>{`@keyframes svorbit{0%{transform:translate(0,0)}20%{transform:translate(12px,5px)}40%{transform:translate(6px,12px)}60%{transform:translate(-8px,9px)}80%{transform:translate(-11px,-4px)}100%{transform:translate(0,0)}}`}</style>
      <canvas
        ref={canvasRef}
        style={burnIn
          ? { position: "absolute", top: -16, left: -16, width: "calc(100% + 32px)", height: "calc(100% + 32px)",
              display: "block", touchAction: "none", cursor: isKiosk ? "none" : "grab",
              animation: "svorbit 150s linear infinite" }
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
          onClose={() => { rendererRef.current?.select(null); setSelected(null); }} />
      )}

      {/* On-screen quick controls — auto-hide after inactivity. */}
      <div style={{ position: "absolute", right: 16, bottom: 16, display: "flex", flexDirection: "column", gap: 10, ...autoHide(uiVisible) }}>
        <CtlBtn label="+" onClick={() => zoom(1.3)} />
        <CtlBtn label="−" onClick={() => zoom(1 / 1.3)} />
        <CtlBtn label="⌂" onClick={home} title="Recenter on home" />
      </div>
      <div style={{ position: "absolute", left: 16, bottom: 16, display: "flex", flexDirection: "column", gap: 10, ...autoHide(uiVisible) }}>
        {effective?.monitorMode === "lightsout" && (
          <CtlBtn label={muted ? "☀" : "🌙"} onClick={toggleMute}
            title={muted ? "Resume — clear night mute" : "Mute now (night) until sunrise"} />
        )}
        <CtlBtn label="⚙" onClick={() => setShowSettings(true)} title="Settings" />
      </div>
      {selected && (
        <div style={{ position: "absolute", left: "50%", bottom: 16, transform: "translateX(-50%)", ...autoHide(uiVisible) }}>
          <button onClick={() => { rendererRef.current?.select(null); setSelected(null); }}
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
            style={{ width: "min(440px, 96%)", height: "100%", background: "#f2f2f7",
              boxShadow: "-10px 0 36px rgba(0,0,0,0.45)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "12px 16px", borderBottom: "1px solid #d6d6db", background: "#f2f2f7" }}>
              <span style={{ font: "600 16px system-ui", color: "#1c1c1e" }}>Settings</span>
              <button onClick={() => setShowSettings(false)}
                style={{ border: 0, background: "#e4e4ea", color: "#1c1c1e", borderRadius: 16,
                  padding: "7px 16px", font: "600 14px system-ui", cursor: "pointer" }}>Done</button>
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
  width: 44, height: 44, borderRadius: "50%", border: "0.5px solid rgba(255,255,255,0.18)",
  background: "rgba(18,22,28,0.62)", color: "rgba(235,240,248,0.95)", font: "20px system-ui",
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
    fetch(`/api/photo/${a.hex}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j && j.url) setPhoto(j.url as string); })
      .catch(() => {});
    return () => { alive = false; };
  }, [a.hex]);

  const d = haversine(cfg.centerLat, cfg.centerLon, a.lat, a.lon);
  const brg = a.lat != null && a.lon != null ? bearing(cfg.centerLat, cfg.centerLon, a.lat, a.lon) : null;
  const rows: [string, string][] = [];
  if (a.onGround) rows.push(["Altitude", "On ground"]);
  else if (a.altBaro != null) {
    const arr = a.baroRate != null && Math.abs(a.baroRate) >= 150 ? (a.baroRate > 0 ? " ↑" : " ↓") : "";
    rows.push(["Altitude", `${Math.round(a.altBaro).toLocaleString()} ft${arr}`]);
  }
  if (a.gs != null) rows.push(["Ground speed", `${Math.round(a.gs)} kt`]);
  if (a.track != null) rows.push(["Track", `${Math.round(a.track)}°`]);
  if (a.baroRate != null && !a.onGround) rows.push(["Vertical rate", `${a.baroRate > 0 ? "+" : ""}${Math.round(a.baroRate)} fpm`]);
  const ap: string[] = [];
  if (a.navModes?.length) ap.push(a.navModes.filter((m) => m !== "autopilot").map((m) => m.toUpperCase()).join("·") || "AP");
  if (!a.onGround && (a.selAlt ?? a.fmsAlt) != null) ap.push(`tgt ${Math.round((a.selAlt ?? a.fmsAlt)!).toLocaleString()} ft`);
  if (a.selHeading != null) ap.push(`hdg ${Math.round(a.selHeading)}°`);
  if (a.navQNH != null) ap.push(`${(a.navQNH / 33.8639).toFixed(2)} inHg`);
  if (ap.length) rows.push(["Autopilot", ap.join("  ·  ")]);
  if (a.windSpd != null && a.windDir != null) {
    rows.push(["Wind aloft", `${Math.round(a.windDir)}°/${Math.round(a.windSpd)} kt${a.oat != null ? `  ${a.oat > 0 ? "+" : ""}${Math.round(a.oat)}°` : ""}`]);
  }
  if (a.squawk) rows.push(["Squawk", a.squawk]);
  const route = (a.originName || a.origin) && (a.destName || a.destination)
    ? `${a.originName || a.origin} → ${a.destName || a.destination}` : null;
  if (route) rows.push(["Route", route]);
  if (d != null) rows.push(["From home", `${d.toFixed(1)} mi ${brg != null ? compass(brg) : ""}`]);
  if (!a.onGround && a.altBaro != null && d != null && d > 0) {
    const elev = (Math.atan2(a.altBaro * 0.3048, Math.max(1, d * 1609.34)) * 180) / Math.PI;
    rows.push(["Look angle", `${Math.round(elev)}° up`]);
  }

  return (
    <div style={{ position: "absolute", top: 16, right: 16, width: 300, maxHeight: "82%", overflow: "hidden",
      display: "flex", flexDirection: "column", borderRadius: 12, background: "rgba(8,12,18,0.82)",
      border: "0.5px solid rgba(120,180,210,0.35)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}>
      {photo && <img src={photo} alt="" style={{ width: "100%", height: 150, objectFit: "cover", opacity: 0.92 }} />}
      <div style={{ padding: "12px 14px", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div>
            <div style={{ font: "600 16px system-ui", color: "rgba(238,243,250,0.98)" }}>
              {a.flight || a.registration || a.hex.toUpperCase()}
            </div>
            {a.airline && <div style={{ font: "12px system-ui", color: "rgba(150,200,220,0.9)", marginTop: 1 }}>{a.airline}</div>}
            <div style={{ font: "12px system-ui", color: "rgba(196,205,219,0.8)", marginTop: 1 }}>
              {[a.typeName || a.typeCode, a.registration].filter(Boolean).join("  ·  ")}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ border: 0, background: "rgba(255,255,255,0.08)",
            color: "rgba(225,232,240,0.9)", width: 26, height: 26, borderRadius: "50%", cursor: "pointer", font: "14px system-ui", flex: "none" }}>✕</button>
        </div>
        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "auto 1fr", rowGap: 6, columnGap: 12 }}>
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <div style={{ font: "11px system-ui", color: "rgba(140,152,168,0.85)", whiteSpace: "nowrap" }}>{k}</div>
              <div style={{ font: "12px ui-monospace, monospace", color: "rgba(222,232,244,0.92)", textAlign: "right" }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
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
