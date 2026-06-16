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

	// Autopilot intent — Mode-S BDS 4,0 / nav state decoded by readsb. Present only
	// when the aircraft transmits it (most airliners do; most GA does not).
	SelAlt     *float64 `json:"selAlt,omitempty"`     // MCP/FCU selected altitude
	FMSAlt     *float64 `json:"fmsAlt,omitempty"`     // FMS-managed selected altitude
	SelHeading *float64 `json:"selHeading,omitempty"` // selected heading, deg
	NavQNH     *float64 `json:"navQNH,omitempty"`     // selected baro setting, hPa
	NavModes   []string `json:"navModes,omitempty"`   // engaged modes: autopilot/vnav/lnav/althold/approach/tcas

	// Decoder-derived Mode-S EHS fields — feed the winds-aloft overlay.
	WindSpd *float64 `json:"windSpd,omitempty"` // kt
	WindDir *float64 `json:"windDir,omitempty"` // deg FROM
	OAT     *float64 `json:"oat,omitempty"`     // outside air temp, °C
	IAS     *float64 `json:"ias,omitempty"`     // indicated airspeed, kt (Mode-S EHS)
	TAS     *float64 `json:"tas,omitempty"`     // true airspeed, kt
	Mach    *float64 `json:"mach,omitempty"`    // Mach number

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
