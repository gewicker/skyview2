// Per-surface config overrides. The server config is the KIOSK's (the Pi display) —
// authoritative + persisted. A web browser keeps its OWN overrides here in
// localStorage, so the web view can differ from the touch display. "Push to Display"
// sends these overrides to the server so the kiosk jumps to what you designed on web.
import type { Config } from "@shared/types";

const KEY = "skyview-local-config-v1";

export function loadLocal(): Partial<Config> {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<Config>; }
  catch { return {}; }
}

export function saveLocal(c: Partial<Config>): void {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private mode */ }
}

export function clearLocal(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
