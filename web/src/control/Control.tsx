// The control panel — a controlled component (no connection of its own). The host
// (Display's settings drawer) owns config + routing: on the kiosk, edits patch the
// shared server config; on the web, edits write a LOCAL override layer so the web view
// can differ from the touch display, with "Push to Display" to send it to the kiosk.
import { useState, type ReactNode, type CSSProperties } from "react";
import { ListSection, ListRow, Switch, Segmented, Slider } from "./ui";
import type {
  Config, MapStyle, Skin, TrailMode, MonitorMode, LabelDensity, GridOverlay, ShowFields, SceneMeta,
} from "@shared/types";

export type Surface = "web" | "touch";

interface Props {
  config: Config;
  surface: Surface;
  onChange: (patch: Partial<Config>) => void;
  onPush?: () => void;        // web → kiosk
  onReset?: () => void;       // web: clear local overrides
  onRestart?: () => void;     // touch: relaunch kiosk
  onResetAll?: () => void;    // touch: reset server config to defaults
  dirty?: boolean;            // web has unpushed local overrides
  scenes?: SceneMeta[];
  onSaveScene?: (name: string) => void;
  onApplyScene?: (name: string) => void;
  onDeleteScene?: (name: string) => void;
}

export default function Control({ config: c, surface, onChange, onPush, onReset, onRestart, onResetAll, dirty,
  scenes = [], onSaveScene, onApplyScene, onDeleteScene }: Props) {
  const set = onChange;
  const setField = (k: keyof ShowFields, v: boolean) => set({ showFields: { ...c.showFields, [k]: v } });
  const [sceneName, setSceneName] = useState("");

  // Night/lights-out theme: recolour the whole control surface dark + red-shifted so opening
  // settings at the bedside doesn't blast white light into a dark room. Drives the --sv-* vars.
  const night = c.monitorMode === "red" || c.monitorMode === "lightsout" || c.monitorMode === "night";
  const themeVars: CSSProperties = night ? {
    "--sv-bg": "#160c0c", "--sv-surface": "#231414", "--sv-text": "#e6c2b4", "--sv-text2": "#c79a8c",
    "--sv-muted": "#9a6a60", "--sv-border": "#3a2020", "--sv-switch-off": "#3a2222",
    "--sv-seg": "#2a1616", "--sv-seg-active": "#4a2828",
  } as CSSProperties : {};

  return (
    <div style={{ ...themeVars, background: "var(--sv-bg,#f2f2f7)", minHeight: "100%", padding: "12px 16px 48px", font: "16px system-ui", color: "var(--sv-text,#1c1c1e)" }}>
      {surface === "web" && (
        <div style={{ ...card, padding: 14, marginBottom: 22, background: dirty ? (night ? "#2a1a1a" : "#eaf4ff") : "var(--sv-surface,#fff)" }}>
          <div style={{ font: "13px system-ui", color: "var(--sv-muted,#51616f)", marginBottom: 10 }}>
            You're editing this <b>web view</b>. Changes stay on this screen until you push them to the display.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn primary onClick={() => onPush?.()}>Push to Display →</Btn>
            <Btn onClick={() => { if (!dirty || confirm("Discard your unpushed changes and revert to what's on the display?")) onReset?.(); }}>Discard changes</Btn>
          </div>
        </div>
      )}

      <ListSection title="Display">
        <ListRow label="Skin" first>
          <Segmented<Skin> value={c.skin}
            options={[{ value: "map", label: "Map" }, { value: "ambient", label: "Sky" }]}
            onChange={(v) => set({ skin: v })} />
        </ListRow>
        <ListRow label="Map style">
          <Segmented<MapStyle> value={c.mapStyle}
            options={[{ value: "satellite", label: "Satellite" }, { value: "wire", label: "Wire" }]}
            onChange={(v) => set({ mapStyle: v })} />
        </ListRow>
        <ListRow label="Map up">
          <span style={{ display: "inline-flex", gap: 6 }}>
            {([["N", 0], ["E", 270], ["S", 180], ["W", 90]] as const).map(([lbl, deg]) => (
              <button key={lbl} onClick={() => set({ mapRotationDeg: deg })}
                style={{ border: 0, borderRadius: 7, padding: "5px 10px", font: "600 13px system-ui", cursor: "pointer",
                  background: Math.round(c.mapRotationDeg) === deg ? "#0a84ff" : "#e9e9ee",
                  color: Math.round(c.mapRotationDeg) === deg ? "#fff" : "#1c1c1e" }}>{lbl}</button>
            ))}
          </span>
        </ListRow>
        <ListRow label={`Rotate ${Math.round(c.mapRotationDeg)}°`}>
          <Slider value={c.mapRotationDeg} min={0} max={355} step={5} onChange={(v) => set({ mapRotationDeg: v })} />
        </ListRow>
        <ListRow label="Brightness">
          <Slider value={c.brightness} min={0.1} max={1} step={0.05} onChange={(v) => set({ brightness: v })} />
        </ListRow>
        <ListRow label="Aircraft size">
          <Slider value={c.glyphSizePx} min={12} max={34} step={1} onChange={(v) => set({ glyphSizePx: v })} />
        </ListRow>
        <ListRow label="Altitude colour">
          <Switch value={c.altitudeColor} onChange={(v) => set({ altitudeColor: v })} />
        </ListRow>
      </ListSection>

      <ListSection title="Overlays">
        <ListRow label="Airports" first><Switch value={c.showAirport} onChange={(v) => set({ showAirport: v })} /></ListRow>
        <ListRow label="Approaches"><Switch value={c.showApproaches} onChange={(v) => set({ showApproaches: v })} /></ListRow>
        <ListRow label="On-final tags"><Switch value={c.showFinal} onChange={(v) => set({ showFinal: v })} /></ListRow>
        <ListRow label="Home marker"><Switch value={c.showHome} onChange={(v) => set({ showHome: v })} /></ListRow>
        <ListRow label="Light rail"><Switch value={c.showRail} onChange={(v) => set({ showRail: v })} /></ListRow>
        <ListRow label="Buses"><Switch value={c.showBuses} onChange={(v) => set({ showBuses: v })} /></ListRow>
        <ListRow label="Range rings"><Switch value={c.rangeRings} onChange={(v) => set({ rangeRings: v })} /></ListRow>
        <ListRow label="Grid">
          <Segmented<GridOverlay> value={c.gridOverlay}
            options={[{ value: "off", label: "Off" }, { value: "rings", label: "Rings" }, { value: "grid", label: "Grid" }]}
            onChange={(v) => set({ gridOverlay: v })} />
        </ListRow>
        <ListRow label="Lighting">
          <Segmented<string> value={c.lightsMode || "auto"}
            options={[{ value: "auto", label: "Auto" }, { value: "on", label: "On" }, { value: "off", label: "Off" }]}
            onChange={(v) => set({ lightsMode: v })} />
        </ListRow>
        <ListRow label="Marine layer"><Switch value={c.showMarineLayer} onChange={(v) => set({ showMarineLayer: v })} /></ListRow>
        {c.showMarineLayer && (
          <ListRow label={`Fog ${Math.round((c.marineLayerIntensity ?? 0.6) * 100)}%`}>
            <Slider value={c.marineLayerIntensity ?? 0.6} min={0} max={1} step={0.05} onChange={(v) => set({ marineLayerIntensity: v })} />
          </ListRow>
        )}
        <ListRow label="Precip radar"><Switch value={c.showRadar} onChange={(v) => set({ showRadar: v })} /></ListRow>
        {c.showRadar && (
          <ListRow label={`Radar ${Math.round((c.radarOpacity ?? 0.55) * 100)}%`}>
            <Slider value={c.radarOpacity ?? 0.55} min={0.2} max={0.8} step={0.05} onChange={(v) => set({ radarOpacity: v })} />
          </ListRow>
        )}
        <ListRow label="Highway traffic"><Switch value={c.showHighways} onChange={(v) => set({ showHighways: v })} /></ListRow>
        {c.showHighways && (
          <ListRow label={`Highway ${Math.round((c.highwayIntensity ?? 0.6) * 100)}%`}>
            <Slider value={c.highwayIntensity ?? 0.6} min={0} max={1} step={0.05} onChange={(v) => set({ highwayIntensity: v })} />
          </ListRow>
        )}
        <ListRow label="Vessel traffic"><Switch value={c.showVessels} onChange={(v) => set({ showVessels: v })} /></ListRow>
        {c.showVessels && (
          <ListRow label={`Vessels ${Math.round((c.vesselIntensity ?? 0.7) * 100)}%`}>
            <Slider value={c.vesselIntensity ?? 0.7} min={0} max={1} step={0.05} onChange={(v) => set({ vesselIntensity: v })} />
          </ListRow>
        )}
        <ListRow label="Ambient labels (calm)"><Switch value={c.ambientMode !== false} onChange={(v) => set({ ambientMode: v })} /></ListRow>
        <ListRow label="Ambient Night preset">
          <Btn onClick={() => set({
            ambientMode: true, labelDensity: "adaptive", nearestN: 6,
            showMarineLayer: true, marineLayerIntensity: 0.55,
            showRadar: true, radarOpacity: 0.5,
            showVessels: true, vesselIntensity: 0.6,
            showHighways: false, monitorMode: "night", lightsMode: "auto",
          })}>Apply</Btn>
        </ListRow>
      </ListSection>

      <ListSection title="Navigation (charts)">
        <ListRow label="Navaids · VOR/fix" first><Switch value={c.showNavaids} onChange={(v) => set({ showNavaids: v })} /></ListRow>
        <ListRow label="Approach courses"><Switch value={c.showProcedures} onChange={(v) => set({ showProcedures: v })} /></ListRow>
        {c.showProcedures && (
          <ListRow label="Chart underlay"><Switch value={c.showProcRaster} onChange={(v) => set({ showProcRaster: v })} /></ListRow>
        )}
        {c.showProcedures && c.showProcRaster && (
          <ListRow label="Underlay opacity"><Slider value={c.procRasterOpacity} min={0.05} max={1} step={0.05} onChange={(v) => set({ procRasterOpacity: v })} /></ListRow>
        )}
      </ListSection>

      <ListSection title="Trails">
        <ListRow label="Colour" first>
          <Segmented<TrailMode> value={c.trailMode}
            options={[{ value: "climb", label: "Climb" }, { value: "altitude", label: "Altitude" }, { value: "flat", label: "Flat" }]}
            onChange={(v) => set({ trailMode: v })} />
        </ListRow>
        <ListRow label="Length"><Slider value={c.trailSeconds} min={15} max={180} step={5} onChange={(v) => set({ trailSeconds: v })} /></ListRow>
        <ListRow label="Intensity"><Slider value={c.trailBoost} min={0} max={1} step={0.05} onChange={(v) => set({ trailBoost: v })} /></ListRow>
      </ListSection>

      <ListSection title="Labels">
        <ListRow label="Density" first>
          <Segmented<LabelDensity> value={c.labelDensity}
            options={[{ value: "adaptive", label: "Adaptive" }, { value: "all", label: "All" }, { value: "nearestN", label: "Nearest N" }, { value: "nearestOnly", label: "Nearest" }]}
            onChange={(v) => set({ labelDensity: v })} />
        </ListRow>
        {(c.labelDensity === "nearestN" || c.labelDensity === "adaptive") && (
          <ListRow label={c.labelDensity === "adaptive" ? "Full cards" : "How many"}><Slider value={c.nearestN} min={1} max={20} step={1} onChange={(v) => set({ nearestN: v })} /></ListRow>
        )}
        <ListRow label="Type"><Switch value={c.showFields.type} onChange={(v) => setField("type", v)} /></ListRow>
        <ListRow label="Altitude"><Switch value={c.showFields.altitude} onChange={(v) => setField("altitude", v)} /></ListRow>
        <ListRow label="Speed"><Switch value={c.showFields.speed} onChange={(v) => setField("speed", v)} /></ListRow>
        <ListRow label="Registration"><Switch value={c.showFields.registration} onChange={(v) => setField("registration", v)} /></ListRow>
        <ListRow label="Destination"><Switch value={c.showFields.destination} onChange={(v) => setField("destination", v)} /></ListRow>
      </ListSection>

      <ListSection title="Traffic & alerts">
        <ListRow label="Show traffic" first><Switch value={c.showTraffic} onChange={(v) => set({ showTraffic: v })} /></ListRow>
        <ListRow label="Follow selected"><Switch value={c.followSelected} onChange={(v) => set({ followSelected: v })} /></ListRow>
        <ListRow label="Spotlight"><Switch value={c.showSpotlight} onChange={(v) => set({ showSpotlight: v })} /></ListRow>
        <ListRow label={`Trigger ring ${Math.round(c.spotlightRadiusMi * 0.8689)} NM`}><Slider value={c.spotlightRadiusMi} min={3} max={40} step={1} onChange={(v) => set({ spotlightRadiusMi: v })} /></ListRow>
        <ListRow label="Leader lines"><Switch value={c.showRelative} onChange={(v) => set({ showRelative: v })} /></ListRow>
        <ListRow label="Winds panel"><Switch value={c.showWinds} onChange={(v) => set({ showWinds: v })} /></ListRow>
        <ListRow label="Notable"><Switch value={c.showNotable} onChange={(v) => set({ showNotable: v })} /></ListRow>
        <ListRow label="Notable flash"><Switch value={c.notableFlash} onChange={(v) => set({ notableFlash: v })} /></ListRow>
        <ListRow label="Photos"><Switch value={c.showPhotos} onChange={(v) => set({ showPhotos: v })} /></ListRow>
      </ListSection>

      <ListSection title="Filters">
        <ListRow label="Hide ground" first><Switch value={c.hideOnGround} onChange={(v) => set({ hideOnGround: v })} /></ListRow>
        <ListRow label={`Min alt ${fmtAlt(c.minAltitudeFt)}`}>
          <Slider value={c.minAltitudeFt} min={0} max={20000} step={500} onChange={(v) => set({ minAltitudeFt: v })} />
        </ListRow>
        <ListRow label={`Max alt ${c.maxAltitudeFt ? fmtAlt(c.maxAltitudeFt) : "off"}`}>
          <Slider value={c.maxAltitudeFt} min={0} max={50000} step={1000} onChange={(v) => set({ maxAltitudeFt: v })} />
        </ListRow>
      </ListSection>

      <ListSection title="Motion & performance">
        <ListRow label="Smooth motion" first><Switch value={c.interpolate} onChange={(v) => set({ interpolate: v })} /></ListRow>
        <ListRow label={`Max FPS ${Math.round(c.maxFps)}`}><Slider value={c.maxFps} min={10} max={60} step={1} onChange={(v) => set({ maxFps: v })} /></ListRow>
        <ListRow label={`Render scale ${c.renderScale.toFixed(2)}`}><Slider value={c.renderScale} min={0.5} max={2} step={0.05} onChange={(v) => set({ renderScale: v })} /></ListRow>
      </ListSection>

      <ListSection title="Display power">
        <ListRow label="Mode" first>
          <Segmented<MonitorMode> value={c.monitorMode}
            options={[{ value: "day", label: "Day" }, { value: "night", label: "Night" }, { value: "red", label: "Red" }, { value: "lightsout", label: "Lights-out" }]}
            onChange={(v) => set({ monitorMode: v })} />
        </ListRow>
        {c.monitorMode === "lightsout" && (
          <ListRow label={`Bedtime ${pad2(c.lightsOutHour)}:00`}>
            <Slider value={c.lightsOutHour} min={17} max={23} step={1} onChange={(v) => set({ lightsOutHour: v })} />
          </ListRow>
        )}
        <ListRow label={`Lights-out brightness ${Math.round((c.lightsOutBrightness ?? 0.47) * 100)}%`}>
          <Slider value={c.lightsOutBrightness ?? 0.47} min={0.1} max={0.9} step={0.05} onChange={(v) => set({ lightsOutBrightness: v })} />
        </ListRow>
        <ListRow label="Burn-in shift"><Switch value={c.burnInOrbit} onChange={(v) => set({ burnInOrbit: v })} /></ListRow>
      </ListSection>
      {c.monitorMode === "lightsout" && (
        <div style={{ font: "12px system-ui", color: "#8a8f98", textAlign: "center", margin: "-8px 4px 18px" }}>
          Lively all evening, then a dim red night view from bedtime until sunrise — readable by a bed,
          blue light dropped. Use the 🌙 button to mute early. A ceiling projector (if set) powers off instead.
        </div>
      )}

      {surface === "web" && (
        <ListSection title="Advanced">
          <ListRow label="Highlight emergencies" first><Switch value={c.highlightEmergency} onChange={(v) => set({ highlightEmergency: v })} /></ListRow>
          <ListRow label="Cursor on display"><Switch value={c.showCursor} onChange={(v) => set({ showCursor: v })} /></ListRow>
          <ListRow label={`Sky time offset ${c.skyTimeOffsetMin > 0 ? "+" : ""}${Math.round((c.skyTimeOffsetMin || 0) / 60)} h`}>
            <Slider value={c.skyTimeOffsetMin || 0} min={-720} max={720} step={30} onChange={(v) => set({ skyTimeOffsetMin: v })} />
          </ListRow>
          <ListRow label="Notable webhook">
            <input value={c.notableWebhook || ""} placeholder="https://… (Discord/Slack)" onChange={(e) => set({ notableWebhook: e.target.value })}
              style={{ width: 180, font: "13px system-ui", padding: "6px 8px", borderRadius: 7,
                border: "1px solid var(--sv-border,#d6d6db)", background: "var(--sv-surface,#fff)", color: "var(--sv-text,#1c1c1e)" }} />
          </ListRow>
        </ListSection>
      )}

      <ListSection title="Scenes">
        {scenes.length === 0 && (
          <ListRow label="No saved scenes yet" first><span style={{ font: "13px system-ui", color: "#8a8f98" }}>Save one below</span></ListRow>
        )}
        {scenes.map((s, i) => (
          <ListRow key={s.name} label={s.name} first={i === 0}>
            <span style={{ display: "inline-flex", gap: 8 }}>
              <Btn onClick={() => onApplyScene?.(s.name)}>Apply</Btn>
              <Btn danger onClick={() => { if (confirm(`Delete scene "${s.name}"?`)) onDeleteScene?.(s.name); }}>✕</Btn>
            </span>
          </ListRow>
        ))}
        <ListRow label="" first={scenes.length === 0}>
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <input value={sceneName} onChange={(e) => setSceneName(e.target.value)} placeholder="Scene name"
              style={{ width: 120, padding: "7px 10px", border: "1px solid #d9dce2", borderRadius: 9, font: "14px system-ui" }} />
            <Btn primary onClick={() => { const n = sceneName.trim(); if (n) { onSaveScene?.(n); setSceneName(""); } }}>Save</Btn>
          </span>
        </ListRow>
      </ListSection>

      {surface === "web" && (
        <div style={{ font: "12px system-ui", color: "#8a8f98", textAlign: "center", margin: "-8px 4px 18px" }}>
          Applying a scene sets the live display and clears your local web tweaks.
        </div>
      )}

      {surface === "touch" && (
        <ListSection title="System">
          <ListRow label="Restart display" first><Btn onClick={() => onRestart?.()}>Restart</Btn></ListRow>
          <ListRow label="Reset all settings"><Btn danger onClick={() => onResetAll?.()}>Reset</Btn></ListRow>
        </ListSection>
      )}
    </div>
  );
}

const card = { background: "var(--sv-surface,#fff)", borderRadius: 12 } as const;

function Btn({ children, onClick, primary, danger }: { children: ReactNode; onClick: () => void; primary?: boolean; danger?: boolean }) {
  const bg = primary ? "#0a84ff" : danger ? "#ffe5e3" : "#e4e4ea";
  const fg = primary ? "#fff" : danger ? "#d11a0f" : "#1c1c1e";
  return (
    <button onClick={onClick} style={{ border: 0, background: bg, color: fg, borderRadius: 10,
      padding: "8px 16px", font: "600 14px system-ui", cursor: "pointer" }}>{children}</button>
  );
}

function fmtAlt(ft: number): string { return ft >= 1000 ? `${(ft / 1000).toFixed(0)}k` : `${ft}`; }
function pad2(n: number): string { return n.toString().padStart(2, "0"); }
