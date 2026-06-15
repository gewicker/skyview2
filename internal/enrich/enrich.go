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
}

// New returns an enricher with its adsbdb cache at cachePath (ttlHours = route TTL).
func New(cachePath string, ttlHours float64) *Enricher {
	return &Enricher{cache: newCache(cachePath, ttlHours), sticky: map[string]sticky{}}
}

// Run flushes the disk cache periodically + on shutdown.
func (e *Enricher) Run(ctx context.Context) { e.cache.runFlush(ctx) }

// Process enriches a snapshot in place-ish (returns the same slice, mutated).
func (e *Enricher) Process(list []aircraft.Aircraft, now int64) []aircraft.Aircraft {
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
	}
	e.prune(now)
	return list
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
