// iOS-style control primitives — the foundation of the V2 design system, shared by
// the phone panel and (later) the on-screen touch drawer. Grouped inset lists,
// large tap targets, switch/segmented/slider. Expand into NavStack/Sheet/etc. as the
// panel grows.
import type { ReactNode } from "react";

// Colours are CSS variables so a night/lights-out theme can recolour the whole control
// surface (dark red-shifted) without touching every component — the bedside panel must not
// blast white light into a dark room. Light defaults keep the daytime iOS look.
const C = {
  group: { background: "var(--sv-surface,#fff)", borderRadius: 12, overflow: "hidden", margin: "0 0 22px" } as const,
  header: { font: "500 12px system-ui", letterSpacing: ".04em", textTransform: "uppercase",
    color: "var(--sv-muted,#8a8f98)", padding: "0 16px 8px" } as const,
  row: { display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 12, padding: "14px 16px", minHeight: 48, borderTop: "0.5px solid var(--sv-border,#e6e6ea)" } as const,
};

export function ListSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div style={{ margin: "0 0 22px" }}>
      {title && <div style={C.header}>{title}</div>}
      <div style={C.group}>{children}</div>
    </div>
  );
}

export function ListRow({ label, children, first }: { label: string; children?: ReactNode; first?: boolean }) {
  return (
    <div style={{ ...C.row, borderTop: first ? "none" : C.row.borderTop }}>
      <span style={{ font: "400 16px system-ui", color: "var(--sv-text,#1c1c1e)" }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}

export function Switch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button aria-pressed={value} onClick={() => onChange(!value)}
      style={{ width: 51, height: 31, borderRadius: 999, border: "none", padding: 2, cursor: "pointer",
        background: value ? "#34c759" : "var(--sv-switch-off,#e4e4e9)", transition: "background .15s" }}>
      <span style={{ display: "block", width: 27, height: 27, borderRadius: "50%", background: "#fff",
        transform: value ? "translateX(20px)" : "none", transition: "transform .15s",
        boxShadow: "0 1px 2px rgba(0,0,0,.25)" }} />
    </button>
  );
}

export function Segmented<T extends string>(
  { value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void },
) {
  return (
    <div style={{ display: "inline-flex", background: "var(--sv-seg,#e9e9ee)", borderRadius: 9, padding: 2 }}>
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          style={{ font: "500 14px system-ui", padding: "7px 14px", border: "none", borderRadius: 7, cursor: "pointer",
            background: value === o.value ? "var(--sv-seg-active,#fff)" : "transparent",
            color: value === o.value ? "var(--sv-text,#1c1c1e)" : "var(--sv-text2,#3c3c43)",
            boxShadow: value === o.value ? "0 1px 2px rgba(0,0,0,.18)" : "none" }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider(
  { value, min, max, step = 1, onChange }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void },
) {
  return (
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(Number(e.target.value))} style={{ width: 160 }} />
  );
}
