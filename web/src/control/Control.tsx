import { useEffect, useState } from "react";
import { useStream } from "../lib/useStream";
import { ListSection, ListRow, Switch, Segmented, Slider } from "./ui";
import type { Config, MapStyle, Skin, TrailMode } from "@shared/types";

// Phase 0 control panel: settings wired with optimistic local config that reconciles
// on the server echo (so controls feel instant). Grows into the full iOS-grade panel.
export default function Control() {
  const { state, conn } = useStream("control");
  const [local, setLocal] = useState<Config | null>(state.config);
  useEffect(() => { setLocal(state.config); }, [state.config]);

  if (!local) {
    return <div style={{ font: "16px system-ui", color: "#8a8f98", padding: 24 }}>
      {state.connected ? "Loading…" : "Connecting to SkyView…"}</div>;
  }
  const set = (patch: Partial<Config>) => { setLocal({ ...local, ...patch }); conn.patchConfig(patch); };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "max(16px, env(safe-area-inset-top)) 16px 48px",
      background: "#f2f2f7", minHeight: "100%", font: "16px system-ui", color: "#1c1c1e" }}>
      <h1 style={{ font: "600 28px system-ui", margin: "8px 4px 20px" }}>SkyView</h1>

      <ListSection title="Display">
        <ListRow label="Skin" first>
          <Segmented<Skin> value={local.skin}
            options={[{ value: "map", label: "Map" }, { value: "ambient", label: "Sky" }]}
            onChange={(v) => set({ skin: v })} />
        </ListRow>
        <ListRow label="Map style">
          <Segmented<MapStyle> value={local.mapStyle}
            options={[{ value: "satellite", label: "Satellite" }, { value: "wire", label: "Wire" }, { value: "dark", label: "Dark" }]}
            onChange={(v) => set({ mapStyle: v })} />
        </ListRow>
        <ListRow label="Brightness">
          <Slider value={local.brightness} min={0.1} max={1} step={0.05} onChange={(v) => set({ brightness: v })} />
        </ListRow>
      </ListSection>

      <ListSection title="Trails">
        <ListRow label="Colour" first>
          <Segmented<TrailMode> value={local.trailMode}
            options={[{ value: "climb", label: "Climb" }, { value: "altitude", label: "Altitude" }, { value: "flat", label: "Flat" }]}
            onChange={(v) => set({ trailMode: v })} />
        </ListRow>
        <ListRow label="Length">
          <Slider value={local.trailSeconds} min={15} max={180} step={5} onChange={(v) => set({ trailSeconds: v })} />
        </ListRow>
        <ListRow label="Intensity">
          <Slider value={local.trailBoost} min={0} max={1} step={0.05} onChange={(v) => set({ trailBoost: v })} />
        </ListRow>
      </ListSection>

      <ListSection title="Traffic">
        <ListRow label="Show traffic" first>
          <Switch value={local.showTraffic} onChange={(v) => set({ showTraffic: v })} />
        </ListRow>
        <ListRow label="Spotlight">
          <Switch value={local.showSpotlight} onChange={(v) => set({ showSpotlight: v })} />
        </ListRow>
        <ListRow label="Altitude colour">
          <Switch value={local.altitudeColor} onChange={(v) => set({ altitudeColor: v })} />
        </ListRow>
      </ListSection>

      <div style={{ font: "13px system-ui", color: "#8a8f98", textAlign: "center" }}>
        {state.connected ? "Connected" : "Reconnecting…"}
      </div>
    </div>
  );
}
