// Live Fire/EMS 911 incidents from the City of Seattle real-time fire dispatch open-data feed
// (Socrata SODA endpoint, keyless). Polls every 60 s, keeps recent incidents within the home radius,
// and serves a compact snapshot the client renders as subordinate ground markers. Degrades like the
// other feeds: a failed poll keeps the last good snapshot (disk-cached). No key required.
package feed

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"sync"
	"time"
)

// Incident is one 911 dispatch.
type Incident struct {
	ID      string  `json:"id"`   // incident_number
	Type    string  `json:"type"` // "Aid Response", "Fire in Building", "MVI - Motor Vehicle Incident", …
	Address string  `json:"address"`
	Lat     float64 `json:"lat"`
	Lon     float64 `json:"lon"`
	Time    int64   `json:"time"` // dispatch time, unix ms
}

// FireSnapshot is what /api/fire serves.
type FireSnapshot struct {
	Incidents []Incident `json:"incidents"`
	Updated   int64      `json:"updated"`
}

// Fire polls the Seattle Fire real-time 911 feed and holds the latest snapshot.
type Fire struct {
	client    *http.Client
	cacheFile string
	view      func() View
	loc       *time.Location
	mu        sync.RWMutex
	snap      FireSnapshot
}

// NewFire builds the source. view supplies home center + radius.
func NewFire(cacheFile string, view func() View) *Fire {
	loc, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		loc = time.UTC // datetimes are Seattle-local; fall back to UTC if tzdata is missing
	}
	f := &Fire{
		client:    &http.Client{Timeout: 8 * time.Second},
		cacheFile: cacheFile,
		view:      view,
		loc:       loc,
	}
	f.loadCache()
	return f
}

func (f *Fire) Enabled() bool { return true } // keyless public feed — always on

func (f *Fire) Latest() FireSnapshot {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.snap
}

// Run polls every 60 s until ctx is cancelled.
func (f *Fire) Run(ctx context.Context) {
	f.poll()
	tk := time.NewTicker(60 * time.Second)
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

// sodaIncident mirrors the fields we use from a Seattle Real-Time Fire 911 record.
type sodaIncident struct {
	Address       string `json:"address"`
	Type          string `json:"type"`
	Datetime      string `json:"datetime"`
	Latitude      string `json:"latitude"`
	Longitude     string `json:"longitude"`
	IncidentNumber string `json:"incident_number"`
}

func (f *Fire) poll() {
	// Newest first; a few hundred rows easily covers the last hour county-wide.
	const base = "https://data.seattle.gov/resource/kzjm-xkqj.json"
	q := url.Values{}
	q.Set("$order", "datetime DESC")
	q.Set("$limit", "300")
	req, err := http.NewRequest(http.MethodGet, base+"?"+q.Encode(), nil)
	if err != nil {
		return
	}
	req.Header.Set("Accept", "application/json")
	resp, err := f.client.Do(req)
	if err != nil {
		return // keep last good
	}
	var raw []sodaIncident
	decErr := json.NewDecoder(resp.Body).Decode(&raw)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK || decErr != nil {
		return
	}

	v := f.view()
	radius := v.RadiusMiles
	if radius < 30 {
		radius = 30 // incidents are sparse civic texture — show the metro, not just <22 mi
	}
	now := time.Now()
	cutoff := now.Add(-120 * time.Minute) // wide window — the SODA dataset lags real-time ~30-60 min;
	// the client shows each incident for ~45 min from when it FIRST appears, not from dispatch time
	out := make([]Incident, 0, 64)
	for _, r := range raw {
		lat, e1 := strconv.ParseFloat(r.Latitude, 64)
		lon, e2 := strconv.ParseFloat(r.Longitude, 64)
		if e1 != nil || e2 != nil || lat == 0 || lon == 0 {
			continue
		}
		if distMiles(v.Lat, v.Lon, lat, lon) > radius {
			continue
		}
		t, e3 := time.ParseInLocation("2006-01-02T15:04:05.000", r.Datetime, f.loc)
		if e3 != nil {
			// some rows omit milliseconds
			if t, e3 = time.ParseInLocation("2006-01-02T15:04:05", r.Datetime, f.loc); e3 != nil {
				continue
			}
		}
		if t.Before(cutoff) {
			continue
		}
		out = append(out, Incident{
			ID: r.IncidentNumber, Type: r.Type, Address: r.Address,
			Lat: lat, Lon: lon, Time: t.UnixMilli(),
		})
	}
	snap := FireSnapshot{Incidents: out, Updated: now.UnixMilli()}
	f.mu.Lock()
	f.snap = snap
	f.mu.Unlock()
	f.saveCache(snap)
}

func (f *Fire) loadCache() {
	if f.cacheFile == "" {
		return
	}
	b, err := os.ReadFile(f.cacheFile)
	if err != nil {
		return
	}
	var snap FireSnapshot
	if json.Unmarshal(b, &snap) == nil {
		f.snap = snap
	}
}

func (f *Fire) saveCache(snap FireSnapshot) {
	if f.cacheFile == "" {
		return
	}
	if b, err := json.Marshal(snap); err == nil {
		_ = os.WriteFile(f.cacheFile, b, 0o644)
	}
}
