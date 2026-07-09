// adsbdb enrichment: callsign -> route (origin/dest + airline) and hex -> aircraft
// type/registration. Cached aggressively and persisted to disk so a restart doesn't
// re-hammer the free API. One request per new key; negative results are cached (so
// misses don't retry for the TTL) but network errors are not (so they recover).
// Ported from v1 server/src/enrich/routes.ts.
package enrich

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

const adsbdbAPI = "https://api.adsbdb.com/v0"

// RouteInfo is a resolved callsign route.
type RouteInfo struct {
	Airline     string   `json:"airline,omitempty"`
	Origin      string   `json:"origin,omitempty"`
	Destination string   `json:"destination,omitempty"`
	OriginName  string   `json:"originName,omitempty"`
	DestName    string   `json:"destName,omitempty"`
	OriginLat   *float64 `json:"originLat,omitempty"`
	OriginLon   *float64 `json:"originLon,omitempty"`
	DestLat     *float64 `json:"destLat,omitempty"`
	DestLon     *float64 `json:"destLon,omitempty"`
	Reg         string   `json:"reg,omitempty"`   // scheduled equipment (AeroDataBox only)
	Model       string   `json:"model,omitempty"` // scheduled aircraft model (AeroDataBox only)
}

// AircraftInfo is resolved airframe data.
type AircraftInfo struct {
	TypeName     string `json:"typeName,omitempty"`
	Registration string `json:"registration,omitempty"`
}

type routeEntry struct {
	Data *RouteInfo `json:"data"` // nil = looked up, not found (negative cache)
	At   int64      `json:"at"`
}
type acEntry struct {
	Data *AircraftInfo `json:"data"`
	At   int64         `json:"at"`
}
type cacheFile struct {
	Routes   map[string]routeEntry `json:"routes"`
	Aircraft map[string]acEntry    `json:"aircraft"`
	ADB      map[string]routeEntry `json:"adb"`   // AeroDataBox routes (keyed by callsign)
	Quota    *quotaState           `json:"quota"` // persisted AeroDataBox unit/call budget
}

type cache struct {
	mu       sync.Mutex
	routes   map[string]routeEntry
	aircraft map[string]acEntry
	adb      map[string]routeEntry // AeroDataBox results (separate from free adsbdb routes)
	inflight map[string]bool
	dirty    bool
	path     string
	ttl      time.Duration
	client   *http.Client

	// AeroDataBox (RapidAPI) — keyed, quota-limited upgrade source. Empty key = disabled.
	adbKey          string
	adbMonthlyUnits int // rolling 30-day UNIT cap (name kept for env/back-compat; window is rolling, not calendar)
	adbDailyCalls   int
	adbTTL          time.Duration // longer than the adsbdb TTL: each scarce call is reused all day
	q               quotaState

	// AeroDataBox health / circuit-breaker (in-memory; reset on restart, repopulated on the next call).
	adbBreakerUntil int64  // ms — source suspended until this time after a quota/auth failure
	adbLastStatus   string // last call outcome ("ok" / "quota exhausted" / "auth error" / "http 404" / "network error")
	adbLastAt       int64  // ms — last call attempt
	adbLastOKAt     int64  // ms — last successful (200) call
	adbQuotaRem     int    // provider's X-RateLimit-Requests-Remaining (-1 = unknown)
	adbQuotaLimit   int    // provider's X-RateLimit-Requests-Limit   (-1 = unknown)
}

func newCache(path string, ttlHours float64, adbKey string, adbMonthlyUnits, adbDailyCalls int) *cache {
	c := &cache{
		routes: map[string]routeEntry{}, aircraft: map[string]acEntry{}, adb: map[string]routeEntry{},
		inflight: map[string]bool{}, path: path,
		ttl:             time.Duration(ttlHours * float64(time.Hour)),
		client:          &http.Client{Timeout: 8 * time.Second},
		adbKey:          adbKey,
		adbMonthlyUnits: adbMonthlyUnits,
		adbDailyCalls:   adbDailyCalls,
		adbTTL:          18 * time.Hour, // a flight's leg is stable for its whole visit; reuse the call
		adbQuotaRem:     -1,
		adbQuotaLimit:   -1,
	}
	if b, err := os.ReadFile(path); err == nil {
		var f cacheFile
		if json.Unmarshal(b, &f) == nil {
			if f.Routes != nil {
				c.routes = f.Routes
			}
			if f.Aircraft != nil {
				c.aircraft = f.Aircraft
			}
			if f.ADB != nil {
				c.adb = f.ADB
			}
			if f.Quota != nil {
				c.q = *f.Quota
			}
		}
	}
	return c
}

func (c *cache) fresh(at int64, now int64) bool {
	return now-at < int64(c.ttl/time.Millisecond)
}

// route returns the cached route for a callsign (and whether it was fresh); a miss
// kicks a background fetch.
func (c *cache) route(cs string, now int64) (*RouteInfo, bool) {
	c.mu.Lock()
	e, ok := c.routes[cs]
	fresh := ok && c.fresh(e.At, now)
	c.mu.Unlock()
	if fresh {
		return e.Data, true
	}
	c.fetchRoute(cs)
	return nil, false
}

// aircraftInfo returns the cached airframe info for a hex; a miss kicks a fetch.
func (c *cache) aircraftInfo(hex string, now int64) (*AircraftInfo, bool) {
	c.mu.Lock()
	e, ok := c.aircraft[hex]
	fresh := ok && c.fresh(e.At, now)
	c.mu.Unlock()
	if fresh {
		return e.Data, true
	}
	c.fetchAircraft(hex)
	return nil, false
}

func (c *cache) begin(key string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.inflight[key] {
		return false
	}
	c.inflight[key] = true
	return true
}
func (c *cache) end(key string) { c.mu.Lock(); delete(c.inflight, key); c.mu.Unlock() }

func (c *cache) fetchRoute(cs string) {
	if !c.begin("r:" + cs) {
		return
	}
	go func() {
		defer c.end("r:" + cs)
		var data *RouteInfo
		var resp struct {
			Response struct {
				FlightRoute struct {
					Airline     struct{ Name string } `json:"airline"`
					Origin      adsbdbPlace            `json:"origin"`
					Destination adsbdbPlace            `json:"destination"`
				} `json:"flightroute"`
			} `json:"response"`
		}
		if c.get(adsbdbAPI+"/callsign/"+url.PathEscape(cs), &resp) {
			fr := resp.Response.FlightRoute
			data = &RouteInfo{
				Airline:     fr.Airline.Name,
				Origin:      fr.Origin.code(),
				Destination: fr.Destination.code(),
				OriginName:  fr.Origin.Municipality,
				DestName:    fr.Destination.Municipality,
				OriginLat:   fr.Origin.Latitude, OriginLon: fr.Origin.Longitude,
				DestLat: fr.Destination.Latitude, DestLon: fr.Destination.Longitude,
			}
		}
		// Fallback to hexdb.io when adsbdb has no route (down / rate-limited / missing flight).
		// hexdb returns just the ICAO endpoints, so codes only — still far better than "unknown".
		if data == nil || data.Origin == "" || data.Destination == "" {
			if r := c.hexdbRoute(cs); r != nil {
				data = r
			}
		}
		c.mu.Lock()
		c.routes[cs] = routeEntry{Data: data, At: time.Now().UnixMilli()}
		c.dirty = true
		c.mu.Unlock()
	}()
}

func (c *cache) fetchAircraft(hex string) {
	if !c.begin("a:" + hex) {
		return
	}
	go func() {
		defer c.end("a:" + hex)
		var data *AircraftInfo
		var resp struct {
			Response struct {
				Aircraft struct {
					Manufacturer string `json:"manufacturer"`
					Type         string `json:"type"`
					Registration string `json:"registration"`
				} `json:"aircraft"`
			} `json:"response"`
		}
		if c.get(adsbdbAPI+"/aircraft/"+url.PathEscape(hex), &resp) {
			a := resp.Response.Aircraft
			tn := a.Type
			if a.Manufacturer != "" && a.Type != "" {
				tn = a.Manufacturer + " " + a.Type
			}
			data = &AircraftInfo{TypeName: tn, Registration: a.Registration}
		}
		c.mu.Lock()
		c.aircraft[hex] = acEntry{Data: data, At: time.Now().UnixMilli()}
		c.dirty = true
		c.mu.Unlock()
	}()
}

// hexdbRoute is the fallback route source: hexdb.io returns the route as "ORIG-DEST" in ICAO
// (e.g. "CYYZ-KSEA"). Codes only — no city names/coords — but a real route where adsbdb had none.
func (c *cache) hexdbRoute(cs string) *RouteInfo {
	var resp struct {
		Route string `json:"route"`
	}
	if !c.get("https://hexdb.io/api/v1/route/icao/"+url.PathEscape(cs), &resp) {
		return nil
	}
	// Route may be "A-B" or a multi-leg "A-VIA-B" — take the FIRST and LAST airport so a
	// multi-segment string doesn't glue "B-C" together as one bogus destination.
	var first, last string
	for _, p := range strings.Split(resp.Route, "-") {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if first == "" {
			first = p
		}
		last = p
	}
	if first == "" || last == "" || first == last {
		return nil
	}
	return &RouteInfo{Origin: first, Destination: last}
}

// get decodes a successful JSON response into v; returns false on any error (so the
// caller leaves the entry uncached and retries later — only "not found" is cached).
func (c *cache) get(u string, v any) bool {
	resp, err := c.client.Get(u)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false // 404 etc. -> caller records a negative cache entry
	}
	return json.NewDecoder(resp.Body).Decode(v) == nil
}

// flush persists the cache to disk when dirty (called on a timer + at shutdown).
func (c *cache) flush() {
	c.mu.Lock()
	if !c.dirty {
		c.mu.Unlock()
		return
	}
	c.dirty = false
	q := c.q
	f := cacheFile{Routes: c.routes, Aircraft: c.aircraft, ADB: c.adb, Quota: &q}
	c.mu.Unlock()
	b, err := json.Marshal(f)
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(c.path), 0o755)
	tmp := c.path + ".tmp"
	if os.WriteFile(tmp, b, 0o644) == nil {
		_ = os.Rename(tmp, c.path)
	}
}

func (c *cache) runFlush(ctx context.Context) {
	t := time.NewTicker(15 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			c.flush()
			return
		case <-t.C:
			c.flush()
		}
	}
}

type adsbdbPlace struct {
	IATA         string   `json:"iata_code"`
	ICAO         string   `json:"icao_code"`
	Municipality string   `json:"municipality"`
	Latitude     *float64 `json:"latitude"`
	Longitude    *float64 `json:"longitude"`
}

func (p adsbdbPlace) code() string {
	if p.IATA != "" {
		return p.IATA
	}
	return p.ICAO
}
