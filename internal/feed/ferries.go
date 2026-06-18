// Live Washington State Ferries from the WSDOT WSF Vessel Locations REST API. Uses the SAME free
// WSDOT Traveler API access code as the traffic source (one account covers all WSDOT APIs), passed
// as a query param. Polls every 15 s, keeps in-service vessels within the home radius, and serves a
// compact snapshot the client eases onto the Sound. Degrades like the other feeds: no key disables
// it; a failed poll keeps the last good snapshot (disk-cached).
package feed

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"sync"
	"time"
)

// Ferry is one live WSF vessel.
type Ferry struct {
	ID      int     `json:"id"`
	Name    string  `json:"name"`
	Lat     float64 `json:"lat"`
	Lon     float64 `json:"lon"`
	Heading float64 `json:"heading"`
	Speed   float64 `json:"speed"`  // knots
	AtDock  bool    `json:"atDock"`
	Route   string  `json:"route"`  // "Seattle → Bainbridge Island" (departing → arriving)
	Updated int64   `json:"updated"`
}

// FerrySnapshot is what /api/ferries serves.
type FerrySnapshot struct {
	Ferries []Ferry `json:"ferries"`
	Updated int64   `json:"updated"`
}

// Ferries polls WSF and holds the latest snapshot.
type Ferries struct {
	code      string
	client    *http.Client
	cacheFile string
	view      func() View
	mu        sync.RWMutex
	snap      FerrySnapshot
}

// NewFerries builds the source. code "" disables it. view supplies home center + radius.
func NewFerries(code, cacheFile string, view func() View) *Ferries {
	f := &Ferries{
		code:      code,
		client:    &http.Client{Timeout: 8 * time.Second},
		cacheFile: cacheFile,
		view:      view,
	}
	f.loadCache()
	return f
}

func (f *Ferries) Enabled() bool { return f.code != "" }

func (f *Ferries) Latest() FerrySnapshot {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.snap
}

// Run polls every 15 s until ctx is cancelled. No-op without a key.
func (f *Ferries) Run(ctx context.Context) {
	if f.code == "" {
		return
	}
	f.poll()
	tk := time.NewTicker(15 * time.Second)
	defer tk.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tk.C:
			f.poll()
		}
	}
}

// wsfVessel mirrors the fields we use from a vessellocations element.
type wsfVessel struct {
	VesselID              int     `json:"VesselID"`
	VesselName            string  `json:"VesselName"`
	Latitude              float64 `json:"Latitude"`
	Longitude             float64 `json:"Longitude"`
	Speed                 float64 `json:"Speed"`
	Heading               float64 `json:"Heading"`
	InService             bool    `json:"InService"`
	AtDock                bool    `json:"AtDock"`
	DepartingTerminalName string  `json:"DepartingTerminalName"`
	ArrivingTerminalName  string  `json:"ArrivingTerminalName"`
}

func (f *Ferries) poll() {
	const base = "https://www.wsdot.wa.gov/ferries/api/vessels/rest/vessellocations?apiaccesscode="
	v := f.view()
	radius := v.RadiusMiles
	if radius < 40 {
		radius = 40 // ferries are sparse landmarks — show the whole central Sound, not just <22mi
	}
	req, err := http.NewRequest(http.MethodGet, base+url.QueryEscape(f.code), nil)
	if err != nil {
		return
	}
	req.Header.Set("Accept", "application/json")
	resp, err := f.client.Do(req)
	if err != nil {
		return // keep last good
	}
	var raw []wsfVessel
	decErr := json.NewDecoder(resp.Body).Decode(&raw)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK || decErr != nil {
		return
	}
	now := time.Now().UnixMilli()
	ferries := make([]Ferry, 0, len(raw))
	for _, vs := range raw {
		if !vs.InService || vs.Latitude == 0 || vs.Longitude == 0 {
			continue // out of service / no fix
		}
		if distMiles(v.Lat, v.Lon, vs.Latitude, vs.Longitude) > radius {
			continue
		}
		route := vs.DepartingTerminalName
		if vs.ArrivingTerminalName != "" {
			route = vs.DepartingTerminalName + " → " + vs.ArrivingTerminalName
		}
		ferries = append(ferries, Ferry{
			ID: vs.VesselID, Name: vs.VesselName,
			Lat: vs.Latitude, Lon: vs.Longitude, Heading: vs.Heading, Speed: vs.Speed,
			AtDock: vs.AtDock, Route: route, Updated: now,
		})
	}
	snap := FerrySnapshot{Ferries: ferries, Updated: now}
	f.mu.Lock()
	f.snap = snap
	f.mu.Unlock()
	f.saveCache(snap)
}

func (f *Ferries) loadCache() {
	if f.cacheFile == "" {
		return
	}
	b, err := os.ReadFile(f.cacheFile)
	if err != nil {
		return
	}
	var snap FerrySnapshot
	if json.Unmarshal(b, &snap) == nil {
		f.snap = snap
	}
}

func (f *Ferries) saveCache(snap FerrySnapshot) {
	if f.cacheFile == "" {
		return
	}
	if b, err := json.Marshal(snap); err == nil {
		_ = os.WriteFile(f.cacheFile, b, 0o644)
	}
}
