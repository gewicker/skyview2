// WSDOT traffic-flow source: polls the (keyed, free) Traffic Flow API for live
// congestion on I-5 / I-90 / I-405 / SR-520, normalises each sensor station to a
// 0..1 scalar, and serves a compact station list the web client snaps onto the
// road geometry. One statewide call every 60 s, shared by all clients, key held
// server-side (never shipped to the browser). Degrades gracefully: no key disables
// it; a failed poll keeps the last good snapshot (persisted to disk so a restart
// starts warm). The client treats an empty/old snapshot as "no live data" and
// falls back to the time-of-day model.
package feed

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"sync"
	"time"
)

// TrafficStation is one normalised flow sensor: a point on a known freeway with a
// congestion scalar in 0..1.
type TrafficStation struct {
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
	Road string  `json:"road"` // normalised id: i5 / i90 / i405 / sr520
	Cong float64 `json:"cong"` // 0 wide-open … 1 stop-and-go
}

// TrafficSnapshot is what /api/traffic serves.
type TrafficSnapshot struct {
	Stations []TrafficStation `json:"stations"`
	Updated  int64            `json:"updated"` // unix ms when we last got fresh data (0 = none)
}

// Traffic polls WSDOT and holds the latest snapshot.
type Traffic struct {
	code      string
	client    *http.Client
	cacheFile string
	mu        sync.RWMutex
	snap      TrafficSnapshot
}

// NewTraffic builds the source. accessCode "" means disabled (Run is a no-op and
// Latest stays empty). cacheFile persists the last good snapshot across restarts.
func NewTraffic(accessCode, cacheFile string) *Traffic {
	t := &Traffic{
		code:      accessCode,
		client:    &http.Client{Timeout: 8 * time.Second},
		cacheFile: cacheFile,
	}
	t.loadCache()
	return t
}

// Enabled reports whether a key is configured.
func (t *Traffic) Enabled() bool { return t.code != "" }

// Latest returns the most recent snapshot (safe for concurrent reads).
func (t *Traffic) Latest() TrafficSnapshot {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.snap
}

// Run polls every 60 s until ctx is cancelled. No-op without a key.
func (t *Traffic) Run(ctx context.Context) {
	if t.code == "" {
		return
	}
	t.poll()
	tk := time.NewTicker(60 * time.Second)
	defer tk.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tk.C:
			t.poll()
		}
	}
}

// wsdotFlow mirrors the fields we use from a FlowData object.
type wsdotFlow struct {
	FlowReadingValue    int `json:"FlowReadingValue"`
	FlowStationLocation struct {
		Latitude  float64 `json:"Latitude"`
		Longitude float64 `json:"Longitude"`
		RoadName  string  `json:"RoadName"`
	} `json:"FlowStationLocation"`
}

func (t *Traffic) poll() {
	const url = "https://wsdot.wa.gov/Traffic/api/TrafficFlow/TrafficFlowREST.svc/GetTrafficFlowsAsJson?AccessCode="
	req, err := http.NewRequest(http.MethodGet, url+t.code, nil)
	if err != nil {
		return
	}
	req.Header.Set("Accept", "application/json")
	resp, err := t.client.Do(req)
	if err != nil {
		return // keep last good
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return
	}
	var raw []wsdotFlow
	if json.NewDecoder(resp.Body).Decode(&raw) != nil {
		return
	}
	stations := make([]TrafficStation, 0, len(raw))
	for _, f := range raw {
		road := normalizeRoad(f.FlowStationLocation.RoadName)
		if road == "" {
			continue // not one of our four freeways
		}
		cong, ok := flowToCong(f.FlowReadingValue)
		if !ok {
			continue // Unknown / NoData — leave the segment to the model
		}
		lat, lon := f.FlowStationLocation.Latitude, f.FlowStationLocation.Longitude
		if lat == 0 || lon == 0 || !inMetro(lat, lon) {
			continue // missing coords or outside greater Seattle
		}
		stations = append(stations, TrafficStation{Lat: lat, Lon: lon, Road: road, Cong: cong})
	}
	if len(stations) == 0 {
		return // treat an empty parse as a blip; keep last good
	}
	snap := TrafficSnapshot{Stations: stations, Updated: time.Now().UnixMilli()}
	t.mu.Lock()
	t.snap = snap
	t.mu.Unlock()
	t.saveCache(snap)
}

// Greater-Seattle bounding box covering our four freeways (I-5/90/405/520) with margin.
// WSDOT returns these routes statewide (Portland, Tacoma, Spokane …); we drop anything
// outside the metro so the payload stays small and only relevant sensors ship.
const (
	bbMinLat, bbMaxLat = 47.25, 47.95
	bbMinLon, bbMaxLon = -122.55, -121.90
)

func inMetro(lat, lon float64) bool {
	return lat >= bbMinLat && lat <= bbMaxLat && lon >= bbMinLon && lon <= bbMaxLon
}

// flowToCong maps the WSDOT FlowReadingValue enum to a 0..1 scalar.
// 0 Unknown, 1 WideOpen, 2 Moderate, 3 Heavy, 4 StopAndGo, 5 NoData.
func flowToCong(v int) (float64, bool) {
	switch v {
	case 1:
		return 0.10, true
	case 2:
		return 0.45, true
	case 3:
		return 0.72, true
	case 4:
		return 0.95, true
	default:
		return 0, false
	}
}

// normalizeRoad reduces a WSDOT RoadName ("I-5", "005", "I-405", "SR 520", …) to
// our highway id, or "" if it isn't one of the four we draw. Works off the digits
// so it tolerates "I-5" / "5" / "005" spellings.
func normalizeRoad(name string) string {
	digits := make([]byte, 0, len(name))
	for i := 0; i < len(name); i++ {
		if name[i] >= '0' && name[i] <= '9' {
			digits = append(digits, name[i])
		}
	}
	// strip leading zeros
	i := 0
	for i < len(digits)-1 && digits[i] == '0' {
		i++
	}
	switch string(digits[i:]) {
	case "5":
		return "i5"
	case "90":
		return "i90"
	case "405":
		return "i405"
	case "520":
		return "sr520"
	default:
		return ""
	}
}

func (t *Traffic) loadCache() {
	if t.cacheFile == "" {
		return
	}
	b, err := os.ReadFile(t.cacheFile)
	if err != nil {
		return
	}
	var snap TrafficSnapshot
	if json.Unmarshal(b, &snap) == nil {
		t.snap = snap
	}
}

func (t *Traffic) saveCache(snap TrafficSnapshot) {
	if t.cacheFile == "" {
		return
	}
	if b, err := json.Marshal(snap); err == nil {
		_ = os.WriteFile(t.cacheFile, b, 0o644)
	}
}
