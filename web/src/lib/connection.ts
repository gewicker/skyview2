// Single auto-reconnecting WebSocket with a ping/pong heartbeat + stale-socket
// watchdog (a v1 hard-won fix, baked in from day one): a half-open socket on a
// sleeping phone is force-reconnected, and the server re-primes config on connect.
import type {
  Aircraft, ClientMessage, Config, NotableEvent, SceneMeta, ServerMessage, SourceStatus,
} from "@shared/types";

export interface StreamState {
  connected: boolean;
  config: Config | null;
  now: number;
  aircraft: Aircraft[];
  status: SourceStatus | null;
  scenes: SceneMeta[];
  notable: NotableEvent[];
}

type Listener = (s: StreamState) => void;

const PING_MS = 10_000;
const STALE_MS = 25_000;

export class Connection {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastRxAt = 0;
  private closed = false;

  state: StreamState = {
    connected: false, config: null, now: 0, aircraft: [],
    status: null, scenes: [], notable: [],
  };

  constructor(private role: "display" | "control") {}

  connect(): void { this.closed = false; this.open(); }

  private url(): string {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}/ws`;
  }

  private open(): void {
    try { this.ws = new WebSocket(this.url()); }
    catch { this.scheduleReconnect(); return; }
    this.ws.onopen = () => {
      this.send({ type: "hello", role: this.role });
      this.lastRxAt = Date.now();
      this.update({ connected: true });
      this.startHeartbeat();
    };
    this.ws.onclose = () => { this.stopHeartbeat(); this.update({ connected: false }); this.scheduleReconnect(); };
    this.ws.onerror = () => this.ws?.close();
    this.ws.onmessage = (ev) => this.onMessage(ev.data as string);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastRxAt > STALE_MS) { this.ws?.close(); return; }
      this.send({ type: "ping" });
    }, PING_MS);
  }
  private stopHeartbeat(): void {
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed) this.open();
    }, 1500);
  }

  private onMessage(raw: string): void {
    let m: ServerMessage;
    try { m = JSON.parse(raw) as ServerMessage; } catch { return; }
    this.lastRxAt = Date.now();
    switch (m.type) {
      case "pong": break;
      case "config": this.update({ config: m.config }); break;
      case "aircraft":
        if (this.role === "display") this.update({ now: m.now, aircraft: m.aircraft });
        break;
      case "status": this.update({ status: m.status }); break;
      case "scenes": this.update({ scenes: m.scenes }); break;
      case "notable": this.update({ notable: m.notable }); break;
    }
  }

  send(m: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
  patchConfig(patch: Partial<Config>): void { this.send({ type: "patchConfig", patch }); }
  resetConfig(): void { this.send({ type: "resetConfig" }); }
  saveScene(name: string, config?: Config): void { this.send({ type: "saveScene", name, ...(config ? { config } : {}) }); }
  applyScene(name: string): void { this.send({ type: "applyScene", name }); }
  deleteScene(name: string): void { this.send({ type: "deleteScene", name }); }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn); fn(this.state);
    return () => this.listeners.delete(fn);
  }
  private update(p: Partial<StreamState>): void {
    this.state = { ...this.state, ...p };
    for (const fn of this.listeners) fn(this.state);
  }

  close(): void {
    this.closed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    const ws = this.ws; this.ws = null;
    if (ws) { ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null; ws.close(); }
  }
}
