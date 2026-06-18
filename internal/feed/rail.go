// Live Link light-rail vehicle positions from the Sound Transit OneBusAway (OBA)
// "where" API. Polls trips-for-route for the two Link routes, pulls each active
// vehicle's real-time position + schedule deviation, and serves a compact snapshot
// the web client eases onto the map. One pair of calls every 20 s, shared by all
// clients, key held server-side (never shipped to the browser). Degrades like the
// traffic source: no key disables it; a failed poll keeps the last good snapshot
// (persisted to disk so a restart starts warm). The client treats an empty/old
// snapshot as "no live data" and falls back to the timetable simulation.
//
// Note: trips-for-route for either Link route returns BOTH lines' trips, so the
// line is derived from activeTripId (_2LINE_ vs _100479_) and vehicles are deduped
// by vehicleId — not assumed from the route queried.
package feed

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// Link route ids on the Puget Sound OBA agency (40 = Sound Transit).
var railRoutes = []string{"40_100479", "40_2LINE"} // 1 Line, 2 Line

// RailTrain is one live train: a position, line id, and freshness/holdup info.
type RailTrain struct {
	ID      string  `json:"id"`      // vehicle id — stable key so the client can ease motion
	Line    string  `json:"line"`    // "1" or "2"
	Lat     float64 `json:"lat"`
	Lon     float64 `json:"lon"`
	DevSec  int     `json:"devSec"`  // schedule deviation, seconds (+ late, - early)
	Updated int64   `json:"updated"` // vehicle's lastUpdateTime, unix ms
}

// RailSnapshot is what /api/rail serves.
type RailSnapshot struct {
	Trains  []RailTrain `json:"trains"`
	Updated int64       `json:"updated"` // unix ms when we last got fresh data (0 = none)
}

// Rail polls OBA and holds the latest snapshot.
type Rail struct {
	key       string
	client    *http.Client
	cacheFile string
	mu        sync.RWMutex
	snap      RailSnapshot
}

// NewRail builds the source. key "" means disabled (Run is a no-op and Latest stays
// empty). cacheFile persists the last good snapshot across restarts.
func NewRail(key, cacheFile string) *Rail {
	r := &Rail{
		key:       key,
		client:    &http.Client{Timeout: 8 * time.Second},
		cacheFile: cacheFile,
	}
	r.loadCache()
	return r
}

// Enabled reports whether a key is configured.
func (r *Rail) Enabled() bool { return r.key != "" }

// Latest returns the most recent snapshot (safe for concurrent reads).
func (r *Rail) Latest() RailSnapshot {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.snap
}

// Run polls every 20 s until ctx is cancelled. No-op without a key.
func (r *Rail) Run(ctx context.Context) {
	if r.key == "" {
		return
	}
	r.poll()
	tk := time.NewTicker(20 * time.Second)
	defer tk.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tk.C:
			r.poll()
		}
	}
}

// obaTripsResp mirrors the fields we use from a trips-for-route response.
type obaTripsResp struct {
	Data struct {
		List []struct {
			Status struct {
				Position struct {
					Lat float64 `json:"lat"`
					Lon float64 `json:"lon"`
				} `json:"position"`
				ScheduleDeviation int    `json:"scheduleDeviation"`
				LastUpdateTime    int64  `json:"lastUpdateTime"`
				Predicted         bool   `json:"predicted"`
				Phase             string `json:"phase"`
				ActiveTripID      string `json:"activeTripId"`
				VehicleID         string `json:"vehicleId"`
			} `json:"status"`
		} `json:"list"`
	} `json:"data"`
}

func (r *Rail) poll() {
	const base = "https://api.pugetsound.onebusaway.org/api/where/trips-for-route/"
	byVehicle := map[string]RailTrain{}
	got := false
	for _, route := range railRoutes {
		url := base + route + ".json?includeStatus=true&includeSchedule=false&key=" + r.key
		req, err := http.NewRequest(http.MethodGet, url, nil)
		if err != nil {
			continue
		}
		req.Header.Set("Accept", "application/json")
		resp, err := r.client.Do(req)
		if err != nil {
			continue // keep last good
		}
		var body obaTripsResp
		decErr := json.NewDecoder(resp.Body).Decode(&body)
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK || decErr != nil {
			continue
		}
		got = true
		for _, it := range body.Data.List {
			s := it.Status
			if !s.Predicted || s.Phase != "in_progress" {
				continue // scheduled-only / not in service => no real position
			}
			if s.Position.Lat == 0 || s.Position.Lon == 0 {
				continue
			}
			line := lineFromTrip(s.ActiveTripID)
			if line == "" || s.VehicleID == "" {
				continue
			}
			byVehicle[s.VehicleID] = RailTrain{
				ID:      s.VehicleID,
				Line:    line,
				Lat:     s.Position.Lat,
				Lon:     s.Position.Lon,
				DevSec:  s.ScheduleDeviation,
				Updated: s.LastUpdateTime,
			}
		}
	}
	if !got {
		return // both calls failed — keep last good
	}
	trains := make([]RailTrain, 0, len(byVehicle))
	for _, t := range byVehicle {
		trains = append(trains, t)
	}
	// An empty list is a VALID result (e.g. overnight, no trains running): publish it
	// so the client stops showing stale beads and falls back to the timetable model.
	snap := RailSnapshot{Trains: trains, Updated: time.Now().UnixMilli()}
	r.mu.Lock()
	r.snap = snap
	r.mu.Unlock()
	r.saveCache(snap)
}

// lineFromTrip maps an OBA activeTripId to our line id. Link trip ids embed the
// route number (e.g. "..._2LINE_4050" => 2 Line, "..._100479_2048" => 1 Line).
func lineFromTrip(tripID string) string {
	switch {
	case strings.Contains(tripID, "2LINE"):
		return "2"
	case strings.Contains(tripID, "100479"):
		return "1"
	default:
		return ""
	}
}

func (r *Rail) loadCache() {
	if r.cacheFile == "" {
		return
	}
	b, err := os.ReadFile(r.cacheFile)
	if err != nil {
		return
	}
	var snap RailSnapshot
	if json.Unmarshal(b, &snap) == nil {
		r.snap = snap
	}
}

func (r *Rail) saveCache(snap RailSnapshot) {
	if r.cacheFile == "" {
		return
	}
	if b, err := json.Marshal(snap); err == nil {
		_ = os.WriteFile(r.cacheFile, b, 0o644)
	}
}
