// readsb / dump1090-fa JSON schema + normalizer, ported from v1. dump1090-fa and
// airplanes.live share the readsb schema, so one normalizer covers both. The raw
// feed lives at the decoder's aircraft.json (default http://localhost:8080/data/aircraft.json).
package feed

import (
	"encoding/json"
	"strings"

	"github.com/gewicker/skyview2/internal/aircraft"
)

// readsbFile is the top-level aircraft.json document.
type readsbFile struct {
	Now      float64       `json:"now"`
	Aircraft []rawAircraft `json:"aircraft"`
	AC       []rawAircraft `json:"ac"` // airplanes.live uses "ac"
}

// rawAircraft is the subset of the readsb record we use. alt_baro is a number OR
// the string "ground", so it's parsed from raw JSON.
type rawAircraft struct {
	Hex      string          `json:"hex"`
	Flight   string          `json:"flight"`
	Lat      *float64        `json:"lat"`
	Lon      *float64        `json:"lon"`
	AltBaro  json.RawMessage `json:"alt_baro"` // number | "ground"
	AltGeom  *float64        `json:"alt_geom"`
	GS       *float64        `json:"gs"`
	Track    *float64        `json:"track"`
	BaroRate *float64        `json:"baro_rate"`
	Squawk   string          `json:"squawk"`
	Reg      string          `json:"r"`
	Type     string          `json:"t"`
	Seen     float64         `json:"seen"`
	SeenPos  *float64        `json:"seen_pos"` // age of the latest POSITION, seconds
	Category string          `json:"category"`
	SelAlt   *float64        `json:"nav_altitude_mcp"`
	FMSAlt   *float64        `json:"nav_altitude_fms"`
	NavHdg   *float64        `json:"nav_heading"`
	NavQNH   *float64        `json:"nav_qnh"`
	NavModes []string        `json:"nav_modes"`
	WindSpd  *float64        `json:"ws"`
	WindDir  *float64        `json:"wd"`
	OAT      *float64        `json:"oat"`
	IAS      *float64        `json:"ias"`
	TAS      *float64        `json:"tas"`
	Mach     *float64        `json:"mach"`

	// --- Legacy dump1090 / mutability uat2json field names ---------------------------------------
	// The native 978 UAT chain (rtl_sdr | dump978 | uat2json) emits the OLD dump1090 schema:
	// "altitude" (ft) / "speed" (kts) / "vert_rate" (ft/min) instead of readsb's alt_baro/gs/baro_rate.
	// Parsed as fallbacks only — readsb/1090 and airplanes.live feeds never set these, so there's no
	// conflict; they just fill in altitude/speed/climb for UAT contacts that would otherwise be bare.
	AltitudeLegacy *float64 `json:"altitude"`
	SpeedLegacy    *float64 `json:"speed"`
	VertRateLegacy *float64 `json:"vert_rate"`
}

func ptr(f float64) *float64 { return &f }

// normalize converts a raw record into our Aircraft, or nil if it should be dropped. This is
// the single server-side validity gate (no client should have to defend against feed garbage):
// drop records with no hex, TIS-B/ADS-R surrogate echoes, ground service vehicles, and records
// with no plottable or a frozen/stale position — the things that otherwise render as phantom
// "ground targets spawning and moving around the map."
func normalize(raw rawAircraft) *aircraft.Aircraft {
	if raw.Hex == "" || strings.HasPrefix(raw.Hex, "~") {
		return nil // no hex, or a TIS-B/ADS-R surrogate that would shadow the real airframe
	}
	// Emitter categories C1 (surface emergency), C2 (surface service), C3 (point obstacle) are
	// ground vehicles/obstacles that drive around the ramp — not aircraft.
	switch raw.Category {
	case "C1", "C2", "C3":
		return nil
	}
	// No position, or a frozen/stale one (readsb keeps a target ~60 s after last contact with
	// its last position) — drop, so it never spawns as a phantom that then jumps.
	if raw.Lat == nil || raw.Lon == nil {
		return nil
	}
	if raw.SeenPos != nil && *raw.SeenPos > 60 {
		return nil
	}
	// Fall back to the legacy uat2json field names when the readsb ones are absent (978 UAT feed).
	gs := raw.GS
	if gs == nil {
		gs = raw.SpeedLegacy
	}
	baroRate := raw.BaroRate
	if baroRate == nil {
		baroRate = raw.VertRateLegacy
	}
	ac := &aircraft.Aircraft{
		Hex:          raw.Hex,
		Flight:       trimFlight(raw.Flight),
		Lat:          raw.Lat,
		Lon:          raw.Lon,
		AltGeom:      raw.AltGeom,
		GS:           gs,
		Track:        raw.Track,
		BaroRate:     baroRate,
		Squawk:       raw.Squawk,
		Registration: raw.Reg,
		TypeCode:     raw.Type,
		Seen:         raw.Seen,
		SeenPos:      raw.SeenPos,
		Category:     raw.Category,
		SelAlt:       raw.SelAlt,
		FMSAlt:       raw.FMSAlt,
		SelHeading:   raw.NavHdg,
		NavQNH:       raw.NavQNH,
		NavModes:     raw.NavModes,
		WindSpd:      raw.WindSpd,
		WindDir:      raw.WindDir,
		OAT:          raw.OAT,
		IAS:          raw.IAS,
		TAS:          raw.TAS,
		Mach:         raw.Mach,
	}
	// alt_baro: "ground" -> nil + onGround flag; otherwise the numeric altitude.
	if len(raw.AltBaro) > 0 && string(raw.AltBaro) == `"ground"` {
		ac.OnGround = true
	} else if len(raw.AltBaro) > 0 {
		var alt float64
		if err := json.Unmarshal(raw.AltBaro, &alt); err == nil {
			ac.AltBaro = ptr(alt)
		}
	}
	// Legacy uat2json has no alt_baro; use its "altitude" so UAT contacts get a real height (and the
	// low/slow surface heuristic below can act on it) rather than defaulting to airborne with no alt.
	if ac.AltBaro == nil && !ac.OnGround && raw.AltitudeLegacy != nil {
		ac.AltBaro = raw.AltitudeLegacy
	}
	// Low + slow with no "ground" string → still treat as a surface contact, so it doesn't reach
	// the client's airborne dead-reckoner (which would fling it across the ramp between fixes).
	// Conservative thresholds so genuine slow/low approach traffic stays airborne.
	if !ac.OnGround && ac.AltBaro != nil && *ac.AltBaro < 1000 && (ac.GS == nil || *ac.GS < 40) {
		ac.OnGround = true
	}
	return ac
}

func trimFlight(s string) string {
	// readsb pads callsigns with spaces.
	b, e := 0, len(s)
	for b < e && s[b] == ' ' {
		b++
	}
	for e > b && s[e-1] == ' ' {
		e--
	}
	return s[b:e]
}

// parseSnapshot turns an aircraft.json body into a normalized Snapshot.
func parseSnapshot(body []byte, nowMs float64) (Snapshot, error) {
	var f readsbFile
	if err := json.Unmarshal(body, &f); err != nil {
		return Snapshot{}, err
	}
	list := f.Aircraft
	if len(list) == 0 {
		list = f.AC
	}
	out := make([]aircraft.Aircraft, 0, len(list))
	for i := range list {
		if ac := normalize(list[i]); ac != nil {
			out = append(out, *ac)
		}
	}
	return Snapshot{Now: nowMs, SourceNow: f.Now, Aircraft: out}, nil
}
