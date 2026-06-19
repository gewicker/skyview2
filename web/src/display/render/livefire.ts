// Live Fire/EMS 911 incidents from the backend proxy (/api/fire). An incident is a PLACE where
// something is happening (not a moving contact), so the store is simple: fetch the recent set every
// ~30 s, remember when we first saw each one (for the one-time arrival cue), and drop it after a
// fixed client-side lifetime. Severity category is derived once from the dispatch `type` string.
// See docs/FIRE-EMS-DESIGN.md.

export type IncidentCat = "major" | "medical" | "vehicle" | "alarm";

interface FireMsg { id: string; type: string; address: string; lat: number; lon: number; time: number; }

export interface Incident {
  id: string; type: string; address: string; lat: number; lon: number;
  time: number;       // dispatch time (ms) — drives "X min ago" + age fade
  firstSeen: number;  // local ms we first rendered it — drives the one-time arrival ripple
  cat: IncidentCat;
}

export const LIFETIME_MIN = 45;  // drop an incident this long after its dispatch time

let started = false;
const incidents = new Map<string, Incident>();

/** Map a dispatch `type` to a severity category (ordered checks, first match wins). */
export function classifyIncident(type: string): IncidentCat {
  const t = (type || "").toUpperCase();
  const injury = /INJUR|ENTRAP|EXTRIC|PIN|ROLLOVER/.test(t);
  if (/FIRE IN|BUILDING|STRUCTURE|RESCUE|EXPLOS|HAZMAT|AIRCRAFT|BRUSH|WATER RESCUE/.test(t)) return "major";
  if ((/MVI|MOTOR VEHICLE|COLLISION|\bCAR\b/.test(t)) && injury) return "major";
  if (/MVI|MOTOR VEHICLE|COLLISION|\bCAR\b/.test(t)) return "vehicle";
  if (/AID|MEDIC/.test(t)) return "medical";
  return "alarm"; // ALARM, AUTO FIRE ALARM, INVESTIGATE, and anything unmatched
}

/** Begin polling /api/fire (~every 30 s). Idempotent. */
export function startLiveFire(): void {
  if (started) return;
  started = true;
  const poll = () => {
    fetch("/api/fire")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j || !Array.isArray(j.incidents)) return;
        const now = Date.now();
        for (const m of j.incidents as FireMsg[]) {
          if (!m.id || (m.lat === 0 && m.lon === 0)) continue;
          if (incidents.has(m.id)) continue; // first-seen timestamp is sticky
          incidents.set(m.id, {
            id: m.id, type: m.type, address: m.address, lat: m.lat, lon: m.lon,
            time: m.time, firstSeen: now, cat: classifyIncident(m.type),
          });
        }
      })
      .catch(() => {});
  };
  poll();
  setInterval(poll, 30 * 1000);
}

/** Current incidents within their lifetime (oldest dropped). */
export function fireIncidents(): Incident[] {
  const now = Date.now();
  const out: Incident[] = [];
  for (const [id, inc] of incidents) {
    // Lifetime is measured from when we FIRST saw it (the SODA feed lags real-time by ~30-60 min, so
    // dispatch time is already old on arrival; firstSeen keeps it visible a sensible while regardless).
    if ((now - inc.firstSeen) / 60000 >= LIFETIME_MIN) { incidents.delete(id); continue; }
    out.push(inc);
  }
  return out;
}
