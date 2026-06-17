// Keyless real-time weather: pulls the latest surface observation for KSEA from NWS
// api.weather.gov (free, no key, CORS-enabled) and derives a 0..1 "marine layer" factor from
// the real conditions — low ceiling, low visibility, fog/mist, and near-saturation humidity.
// The marine-layer overlay multiplies its intensity by this so the fog surges when it's actually
// foggy and thins when it's clear. Degrades gracefully: if the fetch fails (offline / CORS),
// the factor holds a neutral fallback so the layer still works off the manual slider.
const STATIONS = ["KSEA", "KBFI", "KPAE"];
let marineFog = 0.45; // 0..1; neutral fallback until the first observation lands
let started = false;

export function getMarineFog(): number {
  return marineFog;
}

/** Begin polling NWS observations (~every 10 min). Idempotent. */
export function startWeather(): void {
  if (started) return;
  started = true;
  const poll = () => {
    Promise.all(STATIONS.map(fetchStationFog))
      .then((vals) => {
        const real = vals.filter((v): v is number => v != null);
        if (real.length) marineFog = Math.max(...real); // worst (foggiest) station wins
      })
      .catch(() => {});
  };
  poll();
  setInterval(poll, 10 * 60 * 1000);
}

function fetchStationFog(id: string): Promise<number | null> {
  return fetch(`https://api.weather.gov/stations/${id}/observations/latest`, { headers: { Accept: "application/geo+json" } })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (j ? fogFrom(j.properties) : null))
    .catch(() => null);
}

function fogFrom(p: any): number {
  let f = 0;
  // Lowest BKN/OVC ceiling (m → ft AGL). Low ceiling ⇒ marine layer overhead.
  let ceilFt: number | null = null;
  for (const c of p?.cloudLayers ?? []) {
    if ((c.amount === "BKN" || c.amount === "OVC") && c.base?.value != null) {
      const ft = c.base.value / 0.3048;
      if (ceilFt == null || ft < ceilFt) ceilFt = ft;
    }
  }
  if (ceilFt != null) f = Math.max(f, clamp((1500 - ceilFt) / 1500));
  // Visibility (m → statute mi). Low vis ⇒ fog/mist.
  if (p?.visibility?.value != null) {
    const mi = p.visibility.value / 1609.34;
    f = Math.max(f, clamp((3 - mi) / 3));
  }
  // Present weather: fog / mist / haze.
  for (const w of p?.presentWeather ?? []) {
    const s = `${w.weather ?? ""} ${w.rawString ?? ""}`.toLowerCase();
    if (s.includes("fog") || s.includes("mist") || s.includes("haze")) f = Math.max(f, 0.7);
  }
  // Near-saturation (small temp/dewpoint spread) ⇒ fog likely forming.
  if (p?.temperature?.value != null && p?.dewpoint?.value != null) {
    f = Math.max(f, clamp((2 - (p.temperature.value - p.dewpoint.value)) / 2));
  } else if (p?.relativeHumidity?.value != null) {
    f = Math.max(f, clamp((p.relativeHumidity.value - 90) / 10));
  }
  return f;
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
