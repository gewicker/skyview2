// AeroDataBox (RapidAPI) — a TARGETED, quota-aware route+equipment upgrade over the free adsbdb
// baseline. The Basic plan is metered in API UNITS (600/month, hard) at ~1 unit per flight-status
// call, so we spend a call only where it helps: an enroute commercial flight near home whose route
// the geometry verifier flagged uncertain or missing (and, later, the tapped aircraft). Results are
// cached on disk with a long TTL + negative cache, and guarded by persisted monthly-unit + daily-call
// budgets so we can never blow the cap. When the budget is spent it silently does nothing and the
// adsbdb route + geometry verifier carry on.
package enrich

import (
	"encoding/json"
	"net/http"
	"net/url"
	"sync"
	"time"
)

const (
	adbBase         = "https://aerodatabox.p.rapidapi.com"
	adbHost         = "aerodatabox.p.rapidapi.com"
	adbUnitsPerCall = 1 // Flight status is a Tier-1 endpoint on Basic (1 API unit/request)
)

// quotaState is persisted with the cache so budgets survive restarts.
type quotaState struct {
	Month string `json:"month"` // "2006-01" — monthly UNIT budget window
	Units int    `json:"units"`
	Day   string `json:"day"` // "2006-01-02" — daily CALL budget window
	Calls int    `json:"calls"`
}

// 1 req/sec rate limit (Basic) — serialize AeroDataBox calls across goroutines.
var (
	adbThrottleMu sync.Mutex
	adbLast       time.Time
)

func adbThrottle() {
	adbThrottleMu.Lock()
	defer adbThrottleMu.Unlock()
	if w := time.Second - time.Since(adbLast); w > 0 {
		time.Sleep(w)
	}
	adbLast = time.Now()
}

// rollQuota resets the unit/call windows when the month/day rolls over. Caller holds c.mu.
func (c *cache) rollQuota(now int64) {
	t := time.UnixMilli(now).UTC()
	m, d := t.Format("2006-01"), t.Format("2006-01-02")
	if c.q.Month != m {
		c.q.Month, c.q.Units = m, 0
	}
	if c.q.Day != d {
		c.q.Day, c.q.Calls = d, 0
	}
}

// adbCached returns the cached AeroDataBox route for a callsign and whether a FRESH entry exists
// (so the caller can skip spending a call). A fresh negative "no match" returns (nil, true). When
// the source is disabled (no key) it reports (nil, true) so the caller never attempts a fetch.
func (c *cache) adbCached(cs string, now int64) (*RouteInfo, bool) {
	if c.adbKey == "" {
		return nil, true
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.adb[cs]
	if ok && now-e.At < int64(c.adbTTL/time.Millisecond) {
		return e.Data, true
	}
	return nil, false
}

func (c *cache) fetchADB(cs string, now int64) {
	if c.adbKey == "" || !c.begin("adb:"+cs) {
		return
	}
	// Budget pre-check (final guard is the post-increment below).
	c.mu.Lock()
	c.rollQuota(now)
	overBudget := c.q.Units+adbUnitsPerCall > c.adbMonthlyUnits || c.q.Calls+1 > c.adbDailyCalls
	c.mu.Unlock()
	if overBudget {
		c.end("adb:" + cs)
		return
	}
	go func() {
		defer c.end("adb:" + cs)
		adbThrottle()
		var arr []adbFlight
		u := adbBase + "/flights/number/" + url.PathEscape(cs) + "?withLocation=true&withAircraftImage=false"
		ok, counted := c.getADB(u, &arr)
		c.mu.Lock()
		defer c.mu.Unlock()
		if counted {
			c.rollQuota(now)
			c.q.Units += adbUnitsPerCall
			c.q.Calls++
		} else {
			return // network error: don't count, don't cache — retry later
		}
		var ri *RouteInfo
		if ok {
			ri = pickADB(arr)
		}
		c.adb[cs] = routeEntry{Data: ri, At: time.Now().UnixMilli()} // ri nil = negative cache
		c.dirty = true
	}()
}

// getADB issues the RapidAPI request. Returns (decoded-ok, counted) where counted means the call
// consumed quota (any server response, incl. 4xx/empty); a network failure is not counted.
func (c *cache) getADB(u string, v any) (bool, bool) {
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return false, false
	}
	req.Header.Set("x-rapidapi-key", c.adbKey)
	req.Header.Set("x-rapidapi-host", adbHost)
	resp, err := c.client.Do(req)
	if err != nil {
		return false, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false, true // 204/404 etc. still consumes a unit → negative cache
	}
	return json.NewDecoder(resp.Body).Decode(v) == nil, true
}

// adbFlight mirrors the fields we use from a /flights/number response element.
type adbAirport struct {
	IATA             string `json:"iata"`
	ICAO             string `json:"icao"`
	MunicipalityName string `json:"municipalityName"`
	Location         *struct {
		Lat float64 `json:"lat"`
		Lon float64 `json:"lon"`
	} `json:"location"`
}

func (a adbAirport) code() string {
	if a.IATA != "" {
		return a.IATA
	}
	return a.ICAO
}

type adbFlight struct {
	Number    string `json:"number"`
	Status    string `json:"status"`
	Departure struct {
		Airport adbAirport `json:"airport"`
	} `json:"departure"`
	Arrival struct {
		Airport adbAirport `json:"airport"`
	} `json:"arrival"`
	Airline struct {
		Name string `json:"name"`
	} `json:"airline"`
	Aircraft struct {
		Reg   string `json:"reg"`
		Model string `json:"model"`
	} `json:"aircraft"`
}

// pickADB chooses the most relevant leg (one with both endpoints; prefer an active status) and maps
// it to a RouteInfo carrying today's real origin/dest + coords + equipment.
func pickADB(arr []adbFlight) *RouteInfo {
	var chosen *adbFlight
	for i := range arr {
		f := &arr[i]
		if f.Departure.Airport.code() == "" || f.Arrival.Airport.code() == "" {
			continue
		}
		if chosen == nil {
			chosen = f
		}
		switch f.Status {
		case "EnRoute", "Departed", "Approaching", "Expected", "Boarding", "Active":
			chosen = f // prefer a live/imminent leg over a historical/scheduled one
		}
	}
	if chosen == nil {
		return nil
	}
	ri := &RouteInfo{
		Airline:     chosen.Airline.Name,
		Origin:      chosen.Departure.Airport.code(),
		Destination: chosen.Arrival.Airport.code(),
		OriginName:  chosen.Departure.Airport.MunicipalityName,
		DestName:    chosen.Arrival.Airport.MunicipalityName,
		Reg:         chosen.Aircraft.Reg,
		Model:       chosen.Aircraft.Model,
	}
	if l := chosen.Departure.Airport.Location; l != nil {
		ri.OriginLat, ri.OriginLon = &l.Lat, &l.Lon
	}
	if l := chosen.Arrival.Airport.Location; l != nil {
		ri.DestLat, ri.DestLon = &l.Lat, &l.Lon
	}
	if ri.Origin == "" || ri.Destination == "" {
		return nil
	}
	return ri
}

// commercialCallsign reports whether cs looks like an airline ICAO callsign (3-letter prefix +
// digits, e.g. ASA123) — excludes bare N-number GA so we don't waste quota on flights with no
// scheduled route. cs is already uppercased by the caller.
func commercialCallsign(cs string) bool {
	if len(cs) < 4 {
		return false
	}
	for i := 0; i < 3; i++ {
		if cs[i] < 'A' || cs[i] > 'Z' {
			return false
		}
	}
	for i := 3; i < len(cs); i++ {
		if cs[i] >= '0' && cs[i] <= '9' {
			return true
		}
	}
	return false
}
