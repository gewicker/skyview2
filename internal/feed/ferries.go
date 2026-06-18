// Live Washington State Ferries from the WSDOT WSF Vessel Locations REST API. Uses the SAME free
// WSDOT Traveler API access code as the traffic source (one account covers all WSDOT APIs), passed
// as a query param. Polls every 15 s, keeps in-service vessels within the home radius, and serves a
// compact snapshot the client eases onto the Sound. Degrades like the other feeds: no key disables
// it; a failed poll keeps the last good snapshot (disk-cached).
//
// It also resolves GPS-accurate terminal locations from the WSF Terminals API (terminallocations).
// Terminal positions are effectively static, so they're fetched once and refreshed ~daily, cached
// to a sibling file, and last-good on failure. Each ferry is enriched with its departing/arriving
// terminal coords (for crossing-lane plotting), and the snapshot carries the in-range terminals
// (for dock anchors).
package feed

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
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
	Speed   float64 `json:"speed"` // knots
	AtDock  bool    `json:"atDock"`
	Route   string  `json:"route"`           // "Seattle → Bainbridge Island" (departing → arriving)
	DepLat  float64 `json:"depLat,omitempty"` // departing terminal coords (0 if unresolved)
	DepLon  float64 `json:"depLon,omitempty"`
	ArrLat  float64 `json:"arrLat,omitempty"` // arriving terminal coords (0 if unresolved)
	ArrLon  float64 `json:"arrLon,omitempty"`
	Updated int64   `json:"updated"`
}

// FerryTerminal is a WSF terminal location — a dock anchor + an endpoint for crossing-lane plotting.
type FerryTerminal struct {
	ID   int     `json:"id"`
	Name string  `json:"name"`
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
}

// FerrySnapshot is what /api/ferries serves.
type FerrySnapshot struct {
	Ferries   []Ferry         `json:"ferries"`
	Terminals []FerryTerminal `json:"terminals,omitempty"`
	Updated   int64           `json:"updated"`
}

// Ferries polls WSF and holds the latest snapshot.
type Ferries struct {
	code      string
	client    *http.Client
	cacheFile string
	termCache string // sibling cache for the (near-static) terminal table
	view      func() View
	mu        sync.RWMutex
	snap      FerrySnapshot
	terms     map[int]FerryTerminal    // by TerminalID
	termByNm  map[string]FerryTerminal // by normalized name (fallback when no ID match)
	termsAt   int64                    // last successful terminal fetch (ms); 0 = never this run
}

// NewFerries builds the source. code "" disables it. view supplies home center + radius.
func NewFerries(code, cacheFile string, view func() View) *Ferries {
	f := &Ferries{
		code:      code,
		client:    &http.Client{Timeout: 8 * time.Second},
		cacheFile: cacheFile,
		termCache: terminalCachePath(cacheFile),
		view:      view,
		terms:     map[int]FerryTerminal{},
		termByNm:  map[string]FerryTerminal{},
	}
	f.loadCache()
	f.loadTermCache()
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
	DepartingTerminalID   int     `json:"DepartingTerminalID"`
	DepartingTerminalName string  `json:"DepartingTerminalName"`
	ArrivingTerminalID    int     `json:"ArrivingTerminalID"`
	ArrivingTerminalName  string  `json:"ArrivingTerminalName"`
}

// wsfTerminal mirrors the fields we use from a terminallocations element.
type wsfTerminal struct {
	TerminalID   int     `json:"TerminalID"`
	TerminalName string  `json:"TerminalName"`
	Latitude     float64 `json:"Latitude"`
	Longitude    float64 `json:"Longitude"`
}

func (f *Ferries) poll() {
	f.ensureTerminals()

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
		fr := Ferry{
			ID: vs.VesselID, Name: vs.VesselName,
			Lat: vs.Latitude, Lon: vs.Longitude, Heading: vs.Heading, Speed: vs.Speed,
			AtDock: vs.AtDock, Route: route, Updated: now,
		}
		if dep, ok := f.lookupTerm(vs.DepartingTerminalID, vs.DepartingTerminalName); ok {
			fr.DepLat, fr.DepLon = dep.Lat, dep.Lon
		}
		if arr, ok := f.lookupTerm(vs.ArrivingTerminalID, vs.ArrivingTerminalName); ok {
			fr.ArrLat, fr.ArrLon = arr.Lat, arr.Lon
		}
		ferries = append(ferries, fr)
	}

	// In-range terminals for dock anchors (terminal table is read-only here; only ensureTerminals
	// writes it, on this same goroutine).
	terms := make([]FerryTerminal, 0, len(f.terms))
	for _, t := range f.terms {
		if distMiles(v.Lat, v.Lon, t.Lat, t.Lon) <= radius {
			terms = append(terms, t)
		}
	}

	snap := FerrySnapshot{Ferries: ferries, Terminals: terms, Updated: now}
	f.mu.Lock()
	f.snap = snap
	f.mu.Unlock()
	f.saveCache(snap)
}

// ensureTerminals fetches the (near-static) WSF terminal locations once, then refreshes ~daily.
// On any failure it keeps whatever is already loaded (disk or a prior fetch).
func (f *Ferries) ensureTerminals() {
	if len(f.terms) > 0 && time.Now().UnixMilli()-f.termsAt < 24*60*60*1000 {
		return
	}
	const base = "https://www.wsdot.wa.gov/ferries/api/terminals/rest/terminallocations?apiaccesscode="
	req, err := http.NewRequest(http.MethodGet, base+url.QueryEscape(f.code), nil)
	if err != nil {
		return
	}
	req.Header.Set("Accept", "application/json")
	resp, err := f.client.Do(req)
	if err != nil {
		return // keep last good
	}
	var raw []wsfTerminal
	decErr := json.NewDecoder(resp.Body).Decode(&raw)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK || decErr != nil || len(raw) == 0 {
		return
	}
	byID := make(map[int]FerryTerminal, len(raw))
	byNm := make(map[string]FerryTerminal, len(raw))
	for _, t := range raw {
		if t.Latitude == 0 || t.Longitude == 0 {
			continue
		}
		ft := FerryTerminal{ID: t.TerminalID, Name: t.TerminalName, Lat: t.Latitude, Lon: t.Longitude}
		byID[t.TerminalID] = ft
		byNm[normTerm(t.TerminalName)] = ft
	}
	if len(byID) == 0 {
		return
	}
	f.mu.Lock()
	f.terms = byID
	f.termByNm = byNm
	f.termsAt = time.Now().UnixMilli()
	f.mu.Unlock()
	f.saveTermCache(byID)
}

// lookupTerm resolves a terminal by ID first, then by name. Safe to call from poll (only
// ensureTerminals mutates the maps, on the same goroutine).
func (f *Ferries) lookupTerm(id int, name string) (FerryTerminal, bool) {
	if id != 0 {
		if t, ok := f.terms[id]; ok {
			return t, true
		}
	}
	if name != "" {
		if t, ok := f.termByNm[normTerm(name)]; ok {
			return t, true
		}
	}
	return FerryTerminal{}, false
}

func normTerm(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

func terminalCachePath(cacheFile string) string {
	if cacheFile == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(cacheFile), "ferry-terminals-cache.json")
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

func (f *Ferries) loadTermCache() {
	if f.termCache == "" {
		return
	}
	b, err := os.ReadFile(f.termCache)
	if err != nil {
		return
	}
	var list []FerryTerminal
	if json.Unmarshal(b, &list) != nil {
		return
	}
	for _, t := range list {
		f.terms[t.ID] = t
		f.termByNm[normTerm(t.Name)] = t
	}
}

func (f *Ferries) saveTermCache(byID map[int]FerryTerminal) {
	if f.termCache == "" {
		return
	}
	list := make([]FerryTerminal, 0, len(byID))
	for _, t := range byID {
		list = append(list, t)
	}
	if b, err := json.Marshal(list); err == nil {
		_ = os.WriteFile(f.termCache, b, 0o644)
	}
}
