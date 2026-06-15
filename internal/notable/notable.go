// Package notable classifies aircraft as worth flagging: emergencies (squawk),
// military (callsign/type heuristics), or rare/interesting types. Ported and kept
// deliberately conservative — false positives erode the signal.
package notable

import (
	"strings"

	"github.com/gewicker/skyview2/internal/aircraft"
)

// Category is the kind of notable.
type Category string

const (
	Emergency Category = "EMERGENCY"
	Military  Category = "MILITARY"
	Rare      Category = "RARE"
)

var emergencySquawks = map[string]string{
	"7500": "HIJACK", "7600": "RADIO FAIL", "7700": "EMERGENCY",
}

// militaryCallsignPrefixes is a small, high-confidence set (extend as needed).
var militaryCallsignPrefixes = []string{
	"RCH", "REACH", "EVAC", "PAT", "CNV", "GRZLY", "DOOM", "SENTRY", "BLKCAT",
}

// Classify returns a non-empty reason string if the aircraft is notable.
func Classify(a aircraft.Aircraft) (Category, string, bool) {
	if r, ok := emergencySquawks[a.Squawk]; ok {
		return Emergency, r, true
	}
	cs := strings.ToUpper(strings.TrimSpace(a.Flight))
	for _, p := range militaryCallsignPrefixes {
		if strings.HasPrefix(cs, p) {
			return Military, "MILITARY", true
		}
	}
	// Rare types are matched against a type list in a later pass (TODO: load a
	// curated rare/vintage/heavy ICAO type table).
	return "", "", false
}
