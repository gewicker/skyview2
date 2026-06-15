// Package enrich fills route (origin/destination), airline, type and registration
// from adsbdb, with a bounded, disk-backed LRU cache (v2 fixes v1's unbounded
// growth). Route/airline are scoped to the callsign that produced them so a new leg
// under a different callsign never inherits a stale route. [stub — Phase 1]
package enrich

import "github.com/gewicker/skyview2/internal/aircraft"

// Enricher resolves and caches enrichment.
type Enricher struct {
	cachePath string
	maxItems  int
}

// New returns an enricher backed by a cache at cachePath.
func New(cachePath string) *Enricher {
	return &Enricher{cachePath: cachePath, maxItems: 4000}
}

// Apply fills cached enrichment onto ac in place, kicking off a fetch on a miss.
// (No-op until the adsbdb client + cache are implemented.)
func (e *Enricher) Apply(ac *aircraft.Aircraft) {}
