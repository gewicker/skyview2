// Live buses from the Sound Transit OneBusAway (OBA) "where" API. Polls vehicles-for-agency
// for King County Metro (1) + Sound Transit (40), keeps in-service vehicles with a fresh GPS
// fix WITHIN the home radius, drops the rail vehicles (Link/Sounder/T Line — those live on the
// rail layer), dedupes by vehicleId, and serves a compact snapshot the client eases onto the
// map. One pair of calls every 20 s, shared by all clients, key held server-side. Degrades like
// the other feeds: no key disables it; a failed poll keeps the last good snapshot (persisted to
// disk). The client caps how many it draws and dims them when zoomed way out.
package feed

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// Agencies whose buses we pull (everything in the home radius is essentially these two).
var busAgencies = []string{"1", "40"} // King County Metro, Sound Transit

// Bus is one live bus: a position + freshness. No route/line needed (ambient beads, no labels).
type Bus struct {
	ID      string  `json:"id"`
	Lat     float64 `json:"lat"`
	Lon     float64 `json:"lon"`
	Updated int64   `json:"updated"` // vehicle's lastLocationUpdateTime, unix ms
}

// BusSnapshot is what /api/buses serves.
type BusSnapshot struct {
	Buses   []Bus `json:"buses"`
	Updated int64 `json:"updated"` // unix ms when we last got fresh data (0 = none)
}

// Buses polls OBA and holds the latest snapshot.
type Buses struct {
	key       string
	client    *http.Client
	cacheFile string
	view      func() View // home center + radius (so buses follow the configured location)
	mu        sync.RWMutex
	snap      BusSnapshot
}

// NewBuses builds the source. key "" disables it. view supplies the home center + radius filter.
func NewBuses(key, cacheFile string, view func() View) *Buses {
	b := &Buses{
		key:       key,
		client:    &http.Client{Timeout: 10 * time.Second},
		cacheFile: cacheFile,
		view:      view,
	}
	b.loadCache()
	return b
}

func (b *Buses) Enabled() bool { return b.key != "" }

func (b *Buses) Latest() BusSnapshot {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.snap
}

// Run polls every 20 s until ctx is cancelled. No-op without a key.
func (b *Buses) Run(ctx context.Context) {
	if b.key == "" {
		return
	}
	b.poll()
	tk := time.NewTicker(20 * time.Second)
	defer tk.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tk.C:
			b.poll()
		}
	}
}

// obaVehiclesResp mirrors the fields we use from a vehicles-for-agency response.
type obaVehiclesResp struct {
	Data struct {
		List []struct {
			VehicleID              string `json:"vehicleId"`
			LastLocationUpdateTime int64  `json:"lastLocationUpdateTime"`
			Location               struct {
				Lat float64 `json:"lat"`
				Lon float64 `json:"lon"`
			} `json:"location"`
			Phase  string `json:"phase"`
			TripID string `json:"tripId"`
		} `json:"list"`
	} `json:"data"`
}

func (b *Buses) poll() {
	const base = "https://api.pugetsound.onebusaway.org/api/where/vehicles-for-agency/"
	v := b.view()
	radius := v.RadiusMiles
	if radius <= 0 {
		radius = 25
	}
	now := time.Now().UnixMilli()
	byVehicle := map[string]Bus{}
	got := false
	for _, ag := range busAgencies {
		url := base + ag + ".json?key=" + b.key
		req, err := http.NewRequest(http.MethodGet, url, nil)
		if err != nil {
			continue
		}
		req.Header.Set("Accept", "application/json")
		resp, err := b.client.Do(req)
		if err != nil {
			continue // keep last good
		}
		var body obaVehiclesResp
		decErr := json.NewDecoder(resp.Body).Decode(&body)
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK || decErr != nil {
			continue
		}
		got = true
		for _, it := range body.Data.List {
			if it.Phase != "in_progress" || it.VehicleID == "" {
				continue
			}
			if it.Location.Lat == 0 || it.Location.Lon == 0 {
				continue // no GPS fix
			}
			if it.LastLocationUpdateTime == 0 || now-it.LastLocationUpdateTime > 120000 {
				continue // stale fix (parked/old) — drop so we don't show ghosts
			}
			if isRailTrip(it.TripID) {
				continue // Link / Sounder / T Line ride the rail layer, not here
			}
			if distMiles(v.Lat, v.Lon, it.Location.Lat, it.Location.Lon) > radius {
				continue // outside the home radius
			}
			byVehicle[it.VehicleID] = Bus{
				ID:      it.VehicleID,
				Lat:     it.Location.Lat,
				Lon:     it.Location.Lon,
				Updated: it.LastLocationUpdateTime,
			}
		}
	}
	if !got {
		return // all calls failed — keep last good
	}
	buses := make([]Bus, 0, len(byVehicle))
	for _, x := range byVehicle {
		buses = append(buses, x)
	}
	snap := BusSnapshot{Buses: buses, Updated: now}
	b.mu.Lock()
	b.snap = snap
	b.mu.Unlock()
	b.saveCache(snap)
}

// isRailTrip reports whether an OBA tripId belongs to a rail service (Link 1/2 Line, Sounder, T
// Line) — those are drawn by the rail layer, so we exclude them from the bus feed.
func isRailTrip(tripID string) bool {
	return strings.Contains(tripID, "2LINE") || strings.Contains(tripID, "100479") ||
		strings.Contains(tripID, "TLINE") || strings.Contains(tripID, "SNDR")
}

func distMiles(la1, lo1, la2, lo2 float64) float64 {
	const R = 3958.8 // earth radius, miles
	d := math.Pi / 180
	dla := (la2 - la1) * d
	dlo := (lo2 - lo1) * d
	a := math.Sin(dla/2)*math.Sin(dla/2) + math.Cos(la1*d)*math.Cos(la2*d)*math.Sin(dlo/2)*math.Sin(dlo/2)
	return 2 * R * math.Asin(math.Min(1, math.Sqrt(a)))
}

func (b *Buses) loadCache() {
	if b.cacheFile == "" {
		return
	}
	bytes, err := os.ReadFile(b.cacheFile)
	if err != nil {
		return
	}
	var snap BusSnapshot
	if json.Unmarshal(bytes, &snap) == nil {
		b.snap = snap
	}
}

func (b *Buses) saveCache(snap BusSnapshot) {
	if b.cacheFile == "" {
		return
	}
	if bytes, err := json.Marshal(snap); err == nil {
		_ = os.WriteFile(b.cacheFile, bytes, 0o644)
	}
}
