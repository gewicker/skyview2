// AeroDataBox (RapidAPI) — a TARGETED, quota-aware route+equipment upgrade over the free adsbdb
// baseline. The Basic plan is ~600 requests/month (hard) at 1 request per flight-status call, so we
// spend a call only where it helps: an enroute commercial flight near home whose route the geometry
// verifier flagged uncertain or missing (and, later, the tapped aircraft). Results are cached on disk
// with a long TTL + negative cache, and guarded by a persisted ROLLING 30-DAY unit budget + a daily
// call budget. The window is rolling (not a calendar month) on purpose: RapidAPI resets its quota on
// the SUBSCRIPTION ANNIVERSARY, not the 1st, so a calendar-month cap let a provider cycle straddling
// the month boundary exceed the real limit (the 100%-used overage). When the budget is spent it
// silently does nothing and the adsbdb route + geometry verifier carry on.
package enrich

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
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
	Days  map[string]int `json:"days"` // "2006-01-02" -> UNITS spent that day (rolling 30-day window)
	Day   string         `json:"day"`  // "2006-01-02" — daily CALL budget window
	Calls int            `json:"calls"`
	// Legacy calendar-month counter (pre-v6). Read once for back-compat, migrated into Days, cleared.
	Month string `json:"month,omitempty"`
	Units int    `json:"units,omitempty"`
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

// rollQuota migrates the legacy counter, prunes unit buckets older than 30 days, and resets the daily
// CALL window. The unit budget is a ROLLING 30-day sum (cycle-agnostic) — see the file header for why.
// Caller holds c.mu.
func (c *cache) rollQuota(now int64) {
	t := time.UnixMilli(now).UTC()
	d := t.Format("2006-01-02")
	if c.q.Days == nil {
		c.q.Days = map[string]int{}
	}
	if c.q.Units > 0 { // one-time migration of the old calendar-month counter into today's bucket
		c.q.Days[d] += c.q.Units
		c.q.Units, c.q.Month = 0, ""
	}
	cutoff := t.AddDate(0, 0, -30).Format("2006-01-02") // YYYY-MM-DD sorts lexicographically
	for k := range c.q.Days {
		if k < cutoff {
			delete(c.q.Days, k)
		}
	}
	if c.q.Day != d {
		c.q.Day, c.q.Calls = d, 0
	}
}

// rolling30 sums the units spent over the last 30 days. Caller holds c.mu.
func (c *cache) rolling30() int {
	s := 0
	for _, v := range c.q.Days {
		s += v
	}
	return s
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
	// Budget pre-check (rolling 30-day units + daily calls) + circuit breaker (skip while a provider
	// quota/auth failure is backing us off — the adsbdb baseline carries routes meanwhile).
	c.mu.Lock()
	c.rollQuota(now)
	blocked := now < c.adbBreakerUntil ||
		c.rolling30()+adbUnitsPerCall > c.adbMonthlyUnits || c.q.Calls+1 > c.adbDailyCalls
	c.mu.Unlock()
	if blocked {
		c.end("adb:" + cs)
		return
	}
	go func() {
		defer c.end("adb:" + cs)
		adbThrottle()
		var arr []adbFlight
		u := adbBase + "/flights/number/" + url.PathEscape(cs) + "?withLocation=true&withAircraftImage=false"
		ok, counted := c.getADB(u, &arr)
		if !counted {
			return // network error: don't count, don't cache — retry later
		}
		c.mu.Lock()
		c.rollQuota(now)
		c.q.Days[time.UnixMilli(now).UTC().Format("2006-01-02")] += adbUnitsPerCall
		c.q.Calls++
		if ok {
			c.adb[cs] = routeEntry{Data: pickADB(arr), At: time.Now().UnixMilli()} // nil ri = negative cache
		} else {
			c.adb[cs] = routeEntry{Data: nil, At: time.Now().UnixMilli()}
		}
		c.dirty = true
		c.mu.Unlock()
		c.flush() // persist the spent unit IMMEDIATELY so a restart can't lose it (crash-safe budget)
	}()
}

// getADB issues the RapidAPI request. Returns (decoded-ok, counted) where counted means the call
// consumed quota (any server response, incl. 4xx/empty); a network failure is not counted. Records
// the outcome (status + provider quota headers) so the circuit breaker + /api/enrich can react.
func (c *cache) getADB(u string, v any) (bool, bool) {
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return false, false
	}
	req.Header.Set("x-rapidapi-key", c.adbKey)
	req.Header.Set("x-rapidapi-host", adbHost)
	resp, err := c.client.Do(req)
	if err != nil {
		c.recordADB(0, err, nil)
		return false, false
	}
	defer resp.Body.Close()
	c.recordADB(resp.StatusCode, nil, resp.Header)
	if resp.StatusCode != http.StatusOK {
		return false, true // 204/404 etc. still consumes a unit → negative cache
	}
	return json.NewDecoder(resp.Body).Decode(v) == nil, true
}

// recordADB captures the outcome of a call and trips the circuit breaker on a provider-level failure
// (HTTP 429 or the RapidAPI "requests remaining" header hitting 0 → quota exhausted; 401/403 → key or
// plan problem). While the breaker is open, fetchADB skips the source entirely and the free adsbdb
// baseline + geometry verifier carry the routes. A network error is transient — it does NOT trip the
// breaker (the per-call retry handles it). A healthy 200 closes the breaker.
func (c *cache) recordADB(status int, netErr error, h http.Header) {
	now := time.Now().UnixMilli()
	c.mu.Lock()
	defer c.mu.Unlock()
	c.adbLastAt = now
	if netErr != nil {
		c.adbLastStatus = "network error"
		return
	}
	if h != nil {
		if n, err := strconv.Atoi(h.Get("X-RateLimit-Requests-Remaining")); err == nil {
			c.adbQuotaRem = n
		}
		if n, err := strconv.Atoi(h.Get("X-RateLimit-Requests-Limit")); err == nil {
			c.adbQuotaLimit = n
		}
	}
	exhausted := status == http.StatusTooManyRequests || (c.adbQuotaLimit > 0 && c.adbQuotaRem == 0)
	switch {
	case exhausted:
		c.adbLastStatus = "quota exhausted"
		c.adbBreakerUntil = now + int64(6*time.Hour/time.Millisecond) // back off; auto-probe after
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		c.adbLastStatus = "auth/plan error (http " + strconv.Itoa(status) + ")"
		c.adbBreakerUntil = now + int64(24*time.Hour/time.Millisecond)
	case status == http.StatusOK:
		c.adbLastStatus = "ok"
		c.adbLastOKAt = now
		c.adbBreakerUntil = 0 // healthy → close the breaker
	default:
		c.adbLastStatus = "http " + strconv.Itoa(status) // 204/404 = no match, still consumed a unit
	}
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

// ADBStatus is a health snapshot of the AeroDataBox source for /api/enrich.
type ADBStatus struct {
	Enabled        bool   `json:"enabled"`
	Units30d       int    `json:"units30d"` // rolling 30-day units spent (our accounting)
	UnitCap        int    `json:"unitCap"`
	CallsToday     int    `json:"callsToday"`
	CallCap        int    `json:"callCap"`
	BreakerOpen    bool   `json:"breakerOpen"` // currently backing off after a provider failure
	BreakerUntil   int64  `json:"breakerUntil,omitempty"`
	LastStatus     string `json:"lastStatus"`
	LastAt         int64  `json:"lastAt,omitempty"`
	LastOKAt       int64  `json:"lastOkAt,omitempty"`
	QuotaRemaining int    `json:"quotaRemaining"` // provider header (-1 = unknown until the first call)
	QuotaLimit     int    `json:"quotaLimit"`
}

func (c *cache) adbStatus(now int64) ADBStatus {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.rollQuota(now)
	return ADBStatus{
		Enabled:        c.adbKey != "",
		Units30d:       c.rolling30(),
		UnitCap:        c.adbMonthlyUnits,
		CallsToday:     c.q.Calls,
		CallCap:        c.adbDailyCalls,
		BreakerOpen:    now < c.adbBreakerUntil,
		BreakerUntil:   c.adbBreakerUntil,
		LastStatus:     c.adbLastStatus,
		LastAt:         c.adbLastAt,
		LastOKAt:       c.adbLastOKAt,
		QuotaRemaining: c.adbQuotaRem,
		QuotaLimit:     c.adbQuotaLimit,
	}
}

// ADBProbeResult is the outcome of a manual /api/enrich?probe=CALLSIGN test call.
type ADBProbeResult struct {
	Callsign string     `json:"callsign"`
	OK       bool       `json:"ok"`     // got a usable route back
	Status   string     `json:"status"` // the recorded call outcome ("ok" / "quota exhausted" / …)
	Route    *RouteInfo `json:"route,omitempty"`
	Message  string     `json:"message"`
}

// adbProbe makes ONE real AeroDataBox call for a callsign, bypassing the budget + breaker (it's an
// explicit manual test), then reports the outcome. It still counts the unit + updates health/breaker,
// so a probe while over quota returns "quota exhausted" — exactly the diagnostic. A disabled source or
// blank callsign short-circuits with no network call.
func (c *cache) adbProbe(cs string, now int64) ADBProbeResult {
	res := ADBProbeResult{Callsign: cs}
	if c.adbKey == "" {
		res.Status, res.Message = "disabled", "AeroDataBox is disabled (no key / AERODATABOX_DISABLE=1)"
		return res
	}
	if cs == "" {
		res.Status, res.Message = "bad request", "provide ?probe=CALLSIGN (e.g. ASA123)"
		return res
	}
	adbThrottle()
	var arr []adbFlight
	u := adbBase + "/flights/number/" + url.PathEscape(cs) + "?withLocation=true&withAircraftImage=false"
	ok, counted := c.getADB(u, &arr) // recordADB fires inside → status/quota/breaker updated
	c.mu.Lock()
	if counted {
		c.rollQuota(now)
		c.q.Days[time.UnixMilli(now).UTC().Format("2006-01-02")] += adbUnitsPerCall
		c.q.Calls++
		c.dirty = true
	}
	res.Status = c.adbLastStatus
	c.mu.Unlock()
	if counted {
		c.flush()
	}
	if ok {
		if ri := pickADB(arr); ri != nil {
			c.mu.Lock()
			c.adb[cs] = routeEntry{Data: ri, At: time.Now().UnixMilli()} // reuse the paid call
			c.dirty = true
			c.mu.Unlock()
			res.OK, res.Route, res.Message = true, ri, "route resolved"
			return res
		}
		res.Message = "call succeeded but no usable leg found for this callsign"
		return res
	}
	res.Message = "no route — see status"
	return res
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
