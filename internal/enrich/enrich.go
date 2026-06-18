// Package enrich fills route/airline/type/registration onto each snapshot from
// adsbdb (cached) plus instant bundled-table lookups, and makes the result sticky so
// labels don't flicker. Two scopes (ported from v1, incl. this session's bug fix):
// type/registration stick by AIRFRAME (hex); airline/route stick by CALLSIGN (tagged
// routeFlight) so a new leg under a different callsign never shows the previous
// leg's origin/destination. The render loop never blocks: a cache miss returns
// nothing and kicks a background fetch picked up on a later tick.
package enrich

import (
	"context"
	"math"
	"strings"

	"github.com/gewicker/skyview2/internal/aircraft"
)

type sticky struct {
	typeName, registration string
	routeFlight            string // normalised callsign the route/airline below belong to
	airline                string
	origin, destination    string
	originName, destName   string
	originLat, originLon   *float64
	destLat, destLon       *float64
	lastSeen               int64
}

// Enricher resolves + caches enrichment and applies it stickily.
type Enricher struct {
	cache  *cache
	sticky map[string]sticky
	view   func() (lat, lon, radiusMi float64) // home center + radius (gates AeroDataBox spend)
}

// New returns an enricher with its adsbdb cache at cachePath (ttlHours = route TTL). adbKey enables
// the AeroDataBox upgrade source; adbMonthlyUnits/adbDailyCalls bound its free-tier spend.
func New(cachePath string, ttlHours float64, adbKey string, adbMonthlyUnits, adbDailyCalls int) *Enricher {
	return &Enricher{cache: newCache(cachePath, ttlHours, adbKey, adbMonthlyUnits, adbDailyCalls), sticky: map[string]sticky{}}
}

// UseView wires the home center + radius so AeroDataBox lookups are limited to nearby flights.
func (e *Enricher) UseView(fn func() (lat, lon, radiusMi float64)) { e.view = fn }

// nearHome reports whether the aircraft is within the configured radius of home.
func (e *Enricher) nearHome(ac *aircraft.Aircraft) bool {
	if e.view == nil || ac.Lat == nil || ac.Lon == nil {
		return false
	}
	lat, lon, radius := e.view()
	if radius <= 0 {
		radius = 60
	}
	return distNM(*ac.Lat, *ac.Lon, lat, lon) <= radius
}

// Run flushes the disk cache periodically + on shutdown.
func (e *Enricher) Run(ctx context.Context) { e.cache.runFlush(ctx) }

// Process enriches a snapshot in place-ish (returns the same slice, mutated).
func (e *Enricher) Process(list []aircraft.Aircraft, now int64) []aircraft.Aircraft {
	adbSpent := 0 // cap NEW AeroDataBox lookups per tick so a startup burst can't drain the day
	for i := range list {
		ac := &list[i]

		// Instant bundled-table lookups (stubs until datasets land; adsbdb covers it).
		if t := lookupType(ac.TypeCode); t != "" {
			ac.TypeName = t
		}
		if a := lookupAirline(ac.Flight); a != "" {
			ac.Airline = a
		}

		// adsbdb (from cache; misses fetch in the background).
		if info, ok := e.cache.aircraftInfo(ac.Hex, now); ok && info != nil {
			ac.TypeName = orStr(ac.TypeName, info.TypeName)
			ac.Registration = orStr(ac.Registration, info.Registration)
		}
		cs := strings.ToUpper(strings.TrimSpace(ac.Flight))
		if cs != "" {
			if r, ok := e.cache.route(cs, now); ok && r != nil {
				ac.Airline = orStr(ac.Airline, r.Airline)
				ac.Origin = orStr(ac.Origin, r.Origin)
				ac.Destination = orStr(ac.Destination, r.Destination)
				ac.OriginName = orStr(ac.OriginName, r.OriginName)
				ac.DestName = orStr(ac.DestName, r.DestName)
				ac.OriginLat = orF(ac.OriginLat, r.OriginLat)
				ac.OriginLon = orF(ac.OriginLon, r.OriginLon)
				ac.DestLat = orF(ac.DestLat, r.DestLat)
				ac.DestLon = orF(ac.DestLon, r.DestLon)
			}
		}

		// Sticky merge. Type/reg by hex; airline/route by callsign.
		prev := e.sticky[ac.Hex]
		ac.TypeName = orStr(ac.TypeName, prev.typeName)
		ac.Registration = orStr(ac.Registration, prev.registration)

		// Inherit airline/route only when the callsign hasn't CHANGED (a missing
		// callsign keeps inheriting; a present, different one does not).
		sameFlight := cs == "" || prev.routeFlight == cs
		if sameFlight {
			ac.Airline = orStr(ac.Airline, prev.airline)
			ac.Origin = orStr(ac.Origin, prev.origin)
			ac.Destination = orStr(ac.Destination, prev.destination)
			ac.OriginName = orStr(ac.OriginName, prev.originName)
			ac.DestName = orStr(ac.DestName, prev.destName)
			ac.OriginLat = orF(ac.OriginLat, prev.originLat)
			ac.OriginLon = orF(ac.OriginLon, prev.originLon)
			ac.DestLat = orF(ac.DestLat, prev.destLat)
			ac.DestLon = orF(ac.DestLon, prev.destLon)
		}

		routeFlight := cs
		if cs == "" {
			routeFlight = prev.routeFlight // keep the tag through a transient drop
		}
		e.sticky[ac.Hex] = sticky{
			typeName: ac.TypeName, registration: ac.Registration,
			routeFlight: routeFlight, airline: ac.Airline,
			origin: ac.Origin, destination: ac.Destination,
			originName: ac.OriginName, destName: ac.DestName,
			originLat: ac.OriginLat, originLon: ac.OriginLon,
			destLat: ac.DestLat, destLon: ac.DestLon,
			lastSeen: now,
		}

		// Verify the schedule-DB route against the aircraft's actual motion. Runs on the OUTPUT
		// only (the sticky cache above keeps the RAW route), so it re-evaluates fresh each tick
		// from current heading and can't oscillate. Corrects reversed legs; flags the rest.
		verifyRoute(ac)

		// AeroDataBox upgrade (keyed, quota-limited): spend a call only on an enroute commercial
		// flight near home whose adsbdb route is uncertain or missing. A hit is authoritative —
		// today's actual leg + equipment — so it overrides and clears the uncertainty flag.
		if cs != "" {
			if r, ok := e.cache.adbCached(cs, now); ok {
				if r != nil {
					applyADB(ac, r) // reuse the cached call: route + equipment + (later) the tap card
				}
			} else if adbSpent < maxADBPerTick && commercialCallsign(cs) && e.nearHome(ac) &&
				(ac.RouteUncertain || ac.Destination == "") {
				e.cache.fetchADB(cs, now) // budget-guarded; result reused for the rest of the day
				adbSpent++
			}
		}
	}
	e.prune(now)
	return list
}

// maxADBPerTick bounds new AeroDataBox lookups kicked off in a single Process pass.
const maxADBPerTick = 3

// applyADB overlays an AeroDataBox result (today's actual leg + scheduled equipment) onto the
// aircraft. It's authoritative, so it overrides the schedule-DB origin/dest and clears the
// geometry-uncertainty flag; equipment fills only gaps (the observed airframe stays primary).
func applyADB(ac *aircraft.Aircraft, r *RouteInfo) {
	ac.Origin, ac.Destination = r.Origin, r.Destination
	if r.OriginName != "" {
		ac.OriginName = r.OriginName
	}
	if r.DestName != "" {
		ac.DestName = r.DestName
	}
	if r.OriginLat != nil {
		ac.OriginLat, ac.OriginLon = r.OriginLat, r.OriginLon
	}
	if r.DestLat != nil {
		ac.DestLat, ac.DestLon = r.DestLat, r.DestLon
	}
	if r.Airline != "" && ac.Airline == "" {
		ac.Airline = r.Airline
	}
	if r.Reg != "" && ac.Registration == "" {
		ac.Registration = r.Reg
	}
	if r.Model != "" && ac.TypeName == "" {
		ac.TypeName = r.Model
	}
	ac.RouteUncertain = false
	ac.RouteVerified = true // confirmed against the live flight-status API
}

// verifyRoute cross-checks origin/dest (from the callsign schedule DB) against the aircraft's own
// position + track. Same principle as the local-arrival approach-physics fix, but for enroute
// flights: if the plane is clearly flying toward the claimed ORIGIN, the leg is reversed → swap;
// if its heading points at NEITHER endpoint while still far out, the route is untrustworthy → flag
// RouteUncertain (the client marks it). Needs both endpoints' coords (adsbdb), so code-only hexdb
// fallbacks are left as-is. Terminal-area maneuvering (near the field) is never judged here.
func verifyRoute(ac *aircraft.Aircraft) {
	if ac.OnGround || ac.Lat == nil || ac.Lon == nil || ac.Track == nil ||
		ac.OriginLat == nil || ac.OriginLon == nil || ac.DestLat == nil || ac.DestLon == nil {
		return
	}
	if ac.GS != nil && *ac.GS < 60 {
		return // too slow for track to be a reliable direction
	}
	lat, lon, trk := *ac.Lat, *ac.Lon, *ac.Track
	distDest := distNM(lat, lon, *ac.DestLat, *ac.DestLon)
	distOrig := distNM(lat, lon, *ac.OriginLat, *ac.OriginLon)
	// Don't judge in the terminal area (just departed / arriving) or during an active climb-out:
	// the track legitimately doesn't point at the destination there, which produced FALSE swaps on
	// departures and SID/vector maneuvering. Only judge a settled, enroute aircraft.
	if distDest < 30 || distOrig < 30 {
		return
	}
	if ac.BaroRate != nil && *ac.BaroRate > 200 && ac.AltBaro != nil && *ac.AltBaro < 18000 {
		return
	}
	bDest := bearing(lat, lon, *ac.DestLat, *ac.DestLon)
	bOrig := bearing(lat, lon, *ac.OriginLat, *ac.OriginLon)
	dDest := angDiff(trk, bDest)
	dOrig := angDiff(trk, bOrig)

	// Reversed leg: a STRONG ABSOLUTE signal — heading squarely at the origin AND squarely away
	// from the dest (not a loose relative margin, which over-corrected). Swap so it shows where
	// it's actually going.
	if dOrig < 35 && dDest > 110 {
		ac.Origin, ac.Destination = ac.Destination, ac.Origin
		ac.OriginName, ac.DestName = ac.DestName, ac.OriginName
		ac.OriginLat, ac.DestLat = ac.DestLat, ac.OriginLat
		ac.OriginLon, ac.DestLon = ac.DestLon, ac.OriginLon
		dDest = angDiff(trk, bearing(lat, lon, *ac.DestLat, *ac.DestLon))
		distDest = distNM(lat, lon, *ac.DestLat, *ac.DestLon)
	}
	// Untrustworthy: heading still isn't toward the dest while well enroute. Flag it; the client
	// shows the guess but marks it unverified.
	ac.RouteUncertain = dDest > 80 && distDest > 60
}

// bearing returns the initial great-circle bearing from (la1,lo1) to (la2,lo2) in degrees 0..360.
func bearing(la1, lo1, la2, lo2 float64) float64 {
	d := math.Pi / 180
	y := math.Sin((lo2-lo1)*d) * math.Cos(la2*d)
	x := math.Cos(la1*d)*math.Sin(la2*d) - math.Sin(la1*d)*math.Cos(la2*d)*math.Cos((lo2-lo1)*d)
	b := math.Atan2(y, x) / d
	if b < 0 {
		b += 360
	}
	return b
}

// angDiff is the smallest absolute difference between two bearings, 0..180.
func angDiff(a, b float64) float64 {
	d := math.Mod(math.Abs(a-b), 360)
	if d > 180 {
		d = 360 - d
	}
	return d
}

func distNM(la1, lo1, la2, lo2 float64) float64 {
	const R = 3440.065 // nautical miles
	d := math.Pi / 180
	dla := (la2 - la1) * d
	dlo := (lo2 - lo1) * d
	a := math.Sin(dla/2)*math.Sin(dla/2) + math.Cos(la1*d)*math.Cos(la2*d)*math.Sin(dlo/2)*math.Sin(dlo/2)
	return 2 * R * math.Asin(math.Min(1, math.Sqrt(a)))
}

// prune drops sticky entries for aircraft gone > 10 min (keep the map small).
func (e *Enricher) prune(now int64) {
	for hex, s := range e.sticky {
		if now-s.lastSeen > 600_000 {
			delete(e.sticky, hex)
		}
	}
}

func orStr(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
func orF(a, b *float64) *float64 {
	if a != nil {
		return a
	}
	return b
}
