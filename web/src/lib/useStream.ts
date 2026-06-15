import { useEffect, useRef, useState } from "react";
import { Connection, type StreamState } from "./connection";

// One WebSocket connection per page, exposing live state + the handle for patches.
export function useStream(role: "display" | "control"): { state: StreamState; conn: Connection } {
  const ref = useRef<Connection | null>(null);
  if (!ref.current) ref.current = new Connection(role);
  const conn = ref.current;
  const [state, setState] = useState<StreamState>(conn.state);
  useEffect(() => {
    const unsub = conn.subscribe(setState);
    conn.connect();
    return () => { unsub(); conn.close(); };
  }, [conn]);
  return { state, conn };
}
