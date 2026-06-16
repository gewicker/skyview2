// Low-precision solar/lunar geometry — enough for an auto day/night dim, golden-hour
// tint, and a sun/moon marker. Sun follows the NOAA low-precision formulae (well
// under 0.1° for our purposes); the moon uses a simplified ELP-style mean-element
// model (a few arc-minutes, fine for a marker + phase). All angles in degrees unless
// noted; time is a JS Date (UTC under the hood).
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function julian(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}
function norm360(d: number): number {
  return ((d % 360) + 360) % 360;
}

export interface SunMoon {
  dec: number; // declination, deg
  ra: number; // right ascension, deg
  subLat: number; // subsolar/sublunar latitude, deg
  subLon: number; // subsolar/sublunar longitude, deg (−180..180)
  gha: number; // Greenwich hour angle, deg
}

function gmstDeg(jd: number): number {
  return norm360(280.46061837 + 360.98564736629 * (jd - 2451545.0));
}

/** Sun ecliptic→equatorial→geographic (subsolar point). */
export function sunPosition(date: Date): SunMoon {
  const jd = julian(date);
  const n = jd - 2451545.0;
  const L = norm360(280.46 + 0.9856474 * n);
  const g = norm360(357.528 + 0.9856003 * n) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda)) * RAD;
  const ra = norm360(Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) * RAD);
  const gha = norm360(gmstDeg(jd) - ra);
  let subLon = -gha;
  subLon = ((subLon + 180) % 360 + 360) % 360 - 180;
  return { dec, ra, subLat: dec, subLon, gha };
}

/** Simplified lunar position (mean elements) — good to a few arc-minutes. */
export function moonPosition(date: Date): SunMoon {
  const jd = julian(date);
  const d = jd - 2451545.0;
  const L = norm360(218.316 + 13.176396 * d) * DEG; // mean longitude
  const M = norm360(134.963 + 13.064993 * d) * DEG; // mean anomaly
  const F = norm360(93.272 + 13.229350 * d) * DEG; // argument of latitude
  const lon = L * RAD + 6.289 * Math.sin(M); // ecliptic longitude, deg
  const lat = 5.128 * Math.sin(F); // ecliptic latitude, deg
  const eps = (23.439 - 0.0000004 * d) * DEG;
  const lam = lon * DEG, bet = lat * DEG;
  const dec = Math.asin(Math.sin(bet) * Math.cos(eps) + Math.cos(bet) * Math.sin(eps) * Math.sin(lam)) * RAD;
  const ra = norm360(Math.atan2(
    Math.sin(lam) * Math.cos(eps) - Math.tan(bet) * Math.sin(eps),
    Math.cos(lam),
  ) * RAD);
  const gha = norm360(gmstDeg(jd) - ra);
  let subLon = -gha;
  subLon = ((subLon + 180) % 360 + 360) % 360 - 180;
  return { dec, ra, subLat: dec, subLon, gha };
}

export interface AltAz { alt: number; az: number } // degrees; az 0=N, 90=E

/** Altitude/azimuth of a body (given its GHA + declination) from an observer. */
export function altAz(body: SunMoon, obsLat: number, obsLon: number): AltAz {
  const lha = (body.gha + obsLon) * DEG; // local hour angle
  const lat = obsLat * DEG, dec = body.dec * DEG;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(lha);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const az = Math.atan2(Math.sin(lha), Math.cos(lha) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat));
  return { alt: alt * RAD, az: norm360(az * RAD + 180) };
}

/** Convenience: sun altitude (deg) at a place/time. >0 day, <−6 night, between = twilight. */
export function sunAltitude(lat: number, lon: number, date: Date): number {
  return altAz(sunPosition(date), lat, lon).alt;
}

/** Lights-out (sleep) window: dark from the bedtime hour through the night until
 *  sunrise. Evening side starts at lightsOutHour; morning side ends when the sun is
 *  up. Independent of any wake-hour setting — "bedtime → sunrise". */
export function isLightsOut(lat: number, lon: number, lightsOutHour: number, date: Date): boolean {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h < 12) return sunAltitude(lat, lon, date) < 0; // pre-dawn: dark until sunrise
  return h >= lightsOutHour;                           // evening: dark after bedtime
}

/** Illuminated fraction of the moon (0=new, 1=full) and waxing flag. */
export function moonPhase(date: Date): { illum: number; waxing: boolean } {
  const s = sunPosition(date), m = moonPosition(date);
  let elong = norm360(m.ra - s.ra); // crude phase angle proxy
  const waxing = elong < 180;
  const phaseAngle = elong * DEG;
  const illum = (1 - Math.cos(phaseAngle)) / 2;
  return { illum, waxing };
}
