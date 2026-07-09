// Keyless precipitation radar via RainViewer's public maps index + tile CDN. The index
// (api.rainviewer.com/public/weather-maps.json) needs no key and is CORS-enabled; it lists
// a tile host plus a series of recent ("past") radar frames and a couple of "nowcast"
// (short forecast) frames. We hand RadarLayer the host + an ordered list of frame paths and
// the index of the newest real observation ("now"); the layer paints the active frame's
// tiles through the same Web-Mercator affine path as the basemap, so precip registers
// exactly with the aircraft. Degrades gracefully: if the fetch fails, frames stay empty and
// the layer simply draws nothing.

export interface RadarState {
  host: string;     // tile CDN host, e.g. https://tilecache.rainviewer.com
  frames: string[]; // ordered frame path prefixes (past… then nowcast)
  nowIndex: number; // index of the newest real observation in `frames` (-1 = none)
}

let state: RadarState = { host: "", frames: [], nowIndex: -1 };
let started = false;

export function getRadar(): RadarState {
  return state;
}

/** Begin polling the RainViewer index (~every 5 min). Idempotent. */
export function startRadar(): void {
  if (started) return;
  started = true;
  const poll = () => {
    fetch("https://api.rainviewer.com/public/weather-maps.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j || !j.host) return;
        const past = (j.radar?.past ?? []) as Array<{ path: string }>;
        const now = (j.radar?.nowcast ?? []) as Array<{ path: string }>;
        const pastPaths = past.slice(-10).map((fr) => fr.path);
        const nowPaths = now.slice(0, 2).map((fr) => fr.path);
        const frames = [...pastPaths, ...nowPaths];
        if (frames.length) {
          state = { host: j.host, frames, nowIndex: pastPaths.length - 1 };
        }
      })
      .catch(() => {});
  };
  poll();
  setInterval(poll, 5 * 60 * 1000);
}

// --- Off-air (FIS-B) NEXRAD from the 978 SDR ------------------------------------------------------
// The server exposes the decoded off-air radar at /api/wxradar (metadata) + /api/wxradar/nexrad.png
// (the raster). It's a SINGLE georeferenced image over a lat/lon box, not tiles — RadarLayer draws it
// through the same mercator affine. When fresh, it's preferred over the online RainViewer radar; when
// absent/stale the online path carries on. Works with NO internet — the whole point of the 2nd radio.

export interface OffAirRadar {
  url: string;                                   // image URL (served by our own origin)
  bounds: [number, number, number, number];      // [north, south, east, west]
  time: number;                                  // product time, epoch ms
  age: number;                                   // seconds since the product time
}

let offair: OffAirRadar | null = null;
let offairStarted = false;

export function getOffAirRadar(): OffAirRadar | null { return offair; }

/** Poll the server's off-air radar metadata (~every 60 s). Idempotent. Absent/empty → null. */
export function startOffAirRadar(): void {
  if (offairStarted) return;
  offairStarted = true;
  const poll = () => {
    fetch("/api/wxradar")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && typeof j.url === "string" && Array.isArray(j.bounds) && j.bounds.length === 4) {
          offair = { url: j.url, bounds: [j.bounds[0], j.bounds[1], j.bounds[2], j.bounds[3]], time: j.time || 0, age: j.age ?? 1e9 };
        } else {
          offair = null;
        }
      })
      .catch(() => {});
  };
  poll();
  setInterval(poll, 60 * 1000);
}
