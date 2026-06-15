package feed

import "github.com/gewicker/skyview2/internal/aircraft"

// MergeSources overlays a primary (radio) list on a secondary (API) list by hex,
// preferring whichever fix is fresher. Ported faithfully from v1: the radio is
// biased −2 s so it wins while tracking, and a missing API `seen` is treated as 6
// (NOT 999 — that was the v1 bug where radio won forever and landing aircraft
// vanished; the API takes over once the radio fix goes ~8 s stale).
//
// Nuance carried over: Go can't distinguish "seen absent" from "seen == 0" after
// JSON decode, so a zero API `seen` is treated as the 6 s fallback. airplanes.live
// normally reports `seen`, so this only bites when it's omitted — matching v1.
func MergeSources(radio, api []aircraft.Aircraft) []aircraft.Aircraft {
	byHex := make(map[string]aircraft.Aircraft, len(api)+len(radio))
	for _, a := range api {
		byHex[a.Hex] = a
	}
	for _, r := range radio {
		existing, ok := byHex[r.Hex]
		if !ok {
			byHex[r.Hex] = r
			continue
		}
		rSeen := r.Seen - 2 // bias toward the local radio
		aSeen := existing.Seen
		if aSeen == 0 {
			aSeen = 6 // missing/zero API seen → 6 s, so radio doesn't win forever
		}
		if rSeen <= aSeen {
			byHex[r.Hex] = r // radio still fresh → it wins
		}
	}
	out := make([]aircraft.Aircraft, 0, len(byHex))
	for _, a := range byHex {
		out = append(out, a)
	}
	return out
}
