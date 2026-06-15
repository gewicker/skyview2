// Package aircraft defines the per-aircraft snapshot broadcast to clients.
// Enrichment fields (typeName, airline, route) are filled server-side; route and
// airline are scoped to the callsign that produced them (see internal/enrich), so a
// new leg under a different callsign never inherits the previous leg's origin/dest.
package aircraft

// Aircraft is one tracked target at a point in time.
type Aircraft struct {
	Hex      string   `json:"hex"`
	Flight   string   `json:"flight,omitempty"`
	Lat      *float64 `json:"lat,omitempty"`
	Lon      *float64 `json:"lon,omitempty"`
	AltBaro  *float64 `json:"altBaro,omitempty"`
	AltGeom  *float64 `json:"altGeom,omitempty"`
	GS       *float64 `json:"gs,omitempty"`
	Track    *float64 `json:"track,omitempty"`
	BaroRate *float64 `json:"baroRate,omitempty"`
	Squawk   string   `json:"squawk,omitempty"`
	Seen     float64  `json:"seen"`
	OnGround bool     `json:"onGround,omitempty"`
	Category string   `json:"category,omitempty"` // ADS-B emitter category (e.g. A3, B2)
	SelAlt   *float64 `json:"selAlt,omitempty"`   // selected/MCP altitude (final-approach cue)

	// Decoder-derived Mode-S EHS fields — feed the winds-aloft overlay.
	WindSpd *float64 `json:"windSpd,omitempty"` // kt
	WindDir *float64 `json:"windDir,omitempty"` // deg FROM
	OAT     *float64 `json:"oat,omitempty"`     // outside air temp, °C

	// Enrichment (server-filled).
	TypeCode     string   `json:"typeCode,omitempty"`
	TypeName     string   `json:"typeName,omitempty"`
	Airline      string   `json:"airline,omitempty"`
	Registration string   `json:"registration,omitempty"`
	Origin       string   `json:"origin,omitempty"`
	Destination  string   `json:"destination,omitempty"`
	OriginName   string   `json:"originName,omitempty"`
	DestName     string   `json:"destName,omitempty"`
	OriginLat    *float64 `json:"originLat,omitempty"`
	OriginLon    *float64 `json:"originLon,omitempty"`
	DestLat      *float64 `json:"destLat,omitempty"`
	DestLon      *float64 `json:"destLon,omitempty"`
}
