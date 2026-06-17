// Package config is the single source of truth for SkyView's configuration.
// These structs generate the frontend's TypeScript types (tools/tygo.yaml), so
// the server and the web app can never drift. Patches are applied by unmarshalling
// a partial JSON object onto a copy of the live config (json.Unmarshal leaves
// absent fields, including nested ones, untouched) — see internal/store.
//
// V2 drops the v1 projector, recording/replay, and the transient nightDim/nightRed
// render flags (those are computed client-side, not persisted).
package config

// Skin selects the display surface: the pure-black ambient sky, or the geographic map.
type Skin string

const (
	SkinAmbient Skin = "ambient"
	SkinMap     Skin = "map"
)

// MapStyle is the basemap look for the "map" skin.
type MapStyle string

const (
	StyleSatellite MapStyle = "satellite"
	StyleWire      MapStyle = "wire"
	StyleDark      MapStyle = "dark"
)

// GridOverlay draws radar range-rings, a square distance grid, or nothing.
type GridOverlay string

// MonitorMode is the day/night tuning for the fixed touch screen.
type MonitorMode string

// TrailMode colours comet trails flat, by altitude, or by climb/descent.
type TrailMode string

// LabelDensity controls how many aircraft get labels.
type LabelDensity string

// Palette holds the themeable colours (hex strings).
type Palette struct {
	BG     string `json:"bg"`
	Glyph  string `json:"glyph"`
	Trail  string `json:"trail"`
	Accent string `json:"accent"`
	Warn   string `json:"warn"`
	Grid   string `json:"grid"`
	Text   string `json:"text"`
}

// Fonts holds the label and mono font stacks.
type Fonts struct {
	Label string `json:"label"`
	Mono  string `json:"mono"`
}

// ShowFields toggles each label line.
type ShowFields struct {
	Airline      bool `json:"airline"`
	Flight       bool `json:"flight"`
	Type         bool `json:"type"`
	Altitude     bool `json:"altitude"`
	Speed        bool `json:"speed"`
	VerticalRate bool `json:"verticalRate"`
	Destination  bool `json:"destination"`
	Registration bool `json:"registration"`
}

// Config is the full persisted configuration.
type Config struct {
	// Location & scope.
	CenterLat   float64 `json:"centerLat"`
	CenterLon   float64 `json:"centerLon"`
	RadiusMiles float64 `json:"radiusMiles"`

	Zoom float64 `json:"zoom"`

	// Map-skin view.
	MapZoom        float64 `json:"mapZoom"`
	MapCenterLat   float64 `json:"mapCenterLat"`
	MapCenterLon   float64 `json:"mapCenterLon"`
	MapRotationDeg float64 `json:"mapRotationDeg"`

	// Calibration.
	RotationDeg float64 `json:"rotationDeg"`
	MirrorX     bool    `json:"mirrorX"`
	MirrorY     bool    `json:"mirrorY"`

	// Filtering.
	MinAltitudeFt float64 `json:"minAltitudeFt"`
	MaxAltitudeFt float64 `json:"maxAltitudeFt"`
	HideOnGround  bool    `json:"hideOnGround"`

	// Motion / performance.
	Interpolate         bool    `json:"interpolate"`
	MaxExtrapolationSec float64 `json:"maxExtrapolationSec"`
	StaleSec            float64 `json:"staleSec"`
	MaxFps              float64 `json:"maxFps"`
	RenderScale         float64 `json:"renderScale"`

	// Skin & style.
	Skin        Skin        `json:"skin"`
	MapStyle    MapStyle    `json:"mapStyle"`
	GridOverlay GridOverlay `json:"gridOverlay"`

	// Visuals.
	Palette     Palette   `json:"palette"`
	Fonts       Fonts     `json:"fonts"`
	GlyphSizePx float64   `json:"glyphSizePx"`
	AltitudeColor bool    `json:"altitudeColor"`
	TrailMode   TrailMode `json:"trailMode"`
	TrailSeconds float64  `json:"trailSeconds"`
	TrailBoost  float64   `json:"trailBoost"`
	Brightness  float64   `json:"brightness"`

	// Labels.
	LabelDensity LabelDensity `json:"labelDensity"`
	NearestN     int          `json:"nearestN"`
	ShowFields   ShowFields   `json:"showFields"`

	// Overlays & alerts.
	RangeRings        bool   `json:"rangeRings"`
	Compass           bool   `json:"compass"`
	ShowAirport       bool   `json:"showAirport"`
	ShowApproaches    bool   `json:"showApproaches"`
	ShowFinal         bool   `json:"showFinal"`
	ShowTraffic       bool   `json:"showTraffic"`
	ShowHome          bool   `json:"showHome"`
	ShowHud           bool   `json:"showHud"`
	ShowRelative      bool   `json:"showRelative"`
	HighlightEmergency bool  `json:"highlightEmergency"`
	ShowNotable       bool   `json:"showNotable"`
	NotableFlash      bool   `json:"notableFlash"`
	NotableWebhook    string `json:"notableWebhook"`
	ShowWinds         bool   `json:"showWinds"`
	ShowPhotos        bool   `json:"showPhotos"`
	BurnInOrbit       bool   `json:"burnInOrbit"`

	// Spotlight.
	ShowSpotlight     bool    `json:"showSpotlight"`
	SpotlightRadiusMi float64 `json:"spotlightRadiusMi"`
	SpotlightLat      float64 `json:"spotlightLat"`
	SpotlightLon      float64 `json:"spotlightLon"`

	// Sky time offset (used by the sun/golden-hour math).
	SkyTimeOffsetMin float64 `json:"skyTimeOffsetMin"`

	// Navaid + procedure overlays (off by default). Vector data is bundled in the
	// web app; the optional raster underlay points at a georeferenced FAA chart image.
	ShowNavaids       bool    `json:"showNavaids"`
	ShowProcedures    bool    `json:"showProcedures"`
	ShowProcRaster    bool    `json:"showProcRaster"`
	ProcRasterURL     string  `json:"procRasterUrl"`
	ProcRasterOpacity float64 `json:"procRasterOpacity"`

	// Aircraft + airport lighting: "auto" follows the real sun (night factor), "on" forces full
	// night lighting any time, "off" hides all the lights (nav/landing + approach/runway).
	LightsMode string `json:"lightsMode"`

	// Monitor (touch screen).
	MonitorMode  MonitorMode `json:"monitorMode"`
	LightsOutHour int        `json:"lightsOutHour"`
	MuteUntil    float64     `json:"muteUntil"` // manual "night now" override: epoch ms; honored only while dark, auto-clears at sunrise
	ShowCursor   bool        `json:"showCursor"`
}

// Default returns the baseline config (Bellevue / Sea-Tac corridor).
func Default() Config {
	return Config{
		CenterLat: 47.618431, CenterLon: -122.191076, RadiusMiles: 22, // home: 909 112th Ave NE, Bellevue
		Zoom: 2.5,
		MapZoom: 1, MapCenterLat: 47.585, MapCenterLon: -122.255, MapRotationDeg: 270, // East up (faces 405)
		MaxExtrapolationSec: 8, StaleSec: 30, MaxFps: 24, RenderScale: 1, Interpolate: true,
		Skin: SkinMap, MapStyle: StyleSatellite, GridOverlay: "off",
		Palette: Palette{BG: "#05080d", Glyph: "#ff9a3c", Trail: "#cfd8e3",
			Accent: "#39c2d8", Warn: "#ff5a4d", Grid: "#1d3a44", Text: "#dfe7f2"},
		Fonts:       Fonts{Label: "system-ui, sans-serif", Mono: "ui-monospace, monospace"},
		GlyphSizePx: 24, AltitudeColor: true, TrailMode: "climb", TrailSeconds: 40,
		TrailBoost: 0.5, Brightness: 1,
		LabelDensity: "nearestN", NearestN: 8,
		ShowFields: ShowFields{Airline: true, Flight: true, Type: true, Altitude: true,
			Speed: true, Destination: true, Registration: false},
		ShowAirport: true, ShowApproaches: true, ShowFinal: true, ShowTraffic: true,
		ShowHome: true, ShowRelative: true, HighlightEmergency: true,
		ShowNotable: true, NotableFlash: true, ShowWinds: true, ShowPhotos: true,
		BurnInOrbit: false, // IPS panel — no burn-in risk
		ShowSpotlight: true, SpotlightRadiusMi: 15, SpotlightLat: 47.618431, SpotlightLon: -122.191076,
		ProcRasterOpacity: 0.5, // overlays off by default; opacity used when raster enabled
		LightsMode:  "auto",
		MonitorMode: "lightsout", LightsOutHour: 23, ShowCursor: false,
	}
}
