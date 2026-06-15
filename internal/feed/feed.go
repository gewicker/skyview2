// Package feed ingests live ADS-B data. The primary source is a local decoder's
// JSON (readsb / dump1090 aircraft.json) with an optional API supplement; the two
// are merged with the local radio winning on freshness. [stub — Phase 1]
package feed

import "github.com/gewicker/skyview2/internal/aircraft"

// Snapshot is one moment of the sky.
type Snapshot struct {
	Now      float64             `json:"now"`
	Aircraft []aircraft.Aircraft `json:"aircraft"`
}

// Source yields the latest snapshot on demand.
type Source interface {
	Latest() Snapshot
}

// Stub is an empty source until radio/API ingest lands.
type Stub struct{}

// Latest returns an empty snapshot.
func (Stub) Latest() Snapshot { return Snapshot{} }
