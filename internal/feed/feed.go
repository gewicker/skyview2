// Package feed ingests live ADS-B data. The primary source is a local decoder's
// JSON (readsb / dump1090 aircraft.json) with an optional API supplement; the two
// are merged with the local radio winning on freshness.
package feed

import "github.com/gewicker/skyview2/internal/aircraft"

// Snapshot is one moment of the sky.
type Snapshot struct {
	Now       float64             `json:"now"`       // our fetch/arrival time (ms)
	SourceNow float64             `json:"sourceNow"` // the decoder's own "now" — advances once per write; used to dedupe broadcasts
	Aircraft  []aircraft.Aircraft `json:"aircraft"`
}
