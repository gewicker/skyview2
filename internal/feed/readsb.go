// readsb / dump1090-fa JSON schema + normalizer, ported from v1. dump1090-fa and
// airplanes.live share the readsb schema, so one normalizer covers both. The raw
// feed lives at the decoder's aircraft.json (default http://localhost:8080/data/aircraft.json).
package feed

import (
	"encoding/json"

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
	Category string          `json:"category"`
	SelAlt   *float64        `json:"nav_altitude_mcp"`
	FMSAlt   *float64        `json:"nav_altitude_fms"`
	NavHdg   *float64        `json:"nav_heading"`
	NavQNH   *float64        `json:"nav_qnh"`
	NavModes []string        `json:"nav_modes"`
	WindSpd  *float64        `json:"ws"`
	WindDir  *float64        `json:"wd"`
	OAT      *float64        `json:"oat"`
}

func ptr(f float64) *float64 { return &f }

// normalize converts a raw record into our Aircraft, or nil if it has no hex.
func normalize(raw rawAircraft) *aircraft.Aircraft {
	if raw.Hex == "" {
		return nil
	}
	ac := &aircraft.Aircraft{
		Hex:          raw.Hex,
		Flight:       trimFlight(raw.Flight),
		Lat:          raw.Lat,
		Lon:          raw.Lon,
		AltGeom:      raw.AltGeom,
		GS:           raw.GS,
		Track:        raw.Track,
		BaroRate:     raw.BaroRate,
		Squawk:       raw.Squawk,
		Registration: raw.Reg,
		TypeCode:     raw.Type,
		Seen:         raw.Seen,
		Category:     raw.Category,
		SelAlt:       raw.SelAlt,
		FMSAlt:       raw.FMSAlt,
		SelHeading:   raw.NavHdg,
		NavQNH:       raw.NavQNH,
		NavModes:     raw.NavModes,
		WindSpd:      raw.WindSpd,
		WindDir:      raw.WindDir,
		OAT:          raw.OAT,
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
	return Snapshot{Now: nowMs, Aircraft: out}, nil
}
