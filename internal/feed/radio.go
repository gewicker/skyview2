// Radio ingest: poll the local decoder's aircraft.json and keep the latest
// normalized snapshot. Config (URLs, intervals, merge policy) is ported faithfully
// from v1; the API-supplement merge is carried as config but left for the optimal
// pass after we confirm the live setup (radio URL, radius, whether airplanes.live
// is wanted). Defaults match v1: radio at :8080, 1 Hz poll.
package feed

import (
	"context"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Options carries the ported v1 data-acquisition config.
type Options struct {
	// RadioURL is the dump1090/readsb aircraft.json (env AIRCRAFT_JSON_URL).
	RadioURL string
	// PollInterval is the radio poll cadence (env POLL_MS, default 1s).
	PollInterval time.Duration

	// --- API supplement (ported config; wiring deferred to the optimal pass) ---
	// APIURLTemplate is airplanes.live point query; {lat}/{lon}/{r} are filled from
	// config, r in nautical miles capped at 250 (env API_URL).
	APIURLTemplate string
	// SupplementAPI: when on radio, also poll the API and merge so landing aircraft
	// stay alive when the local ADS-B drops them (env SUPPLEMENT_API, default on).
	SupplementAPI bool
	// APIPollInterval is the slower API cadence to respect rate limits (env API_POLL_MS).
	APIPollInterval time.Duration
}

// DefaultOptions returns v1's defaults. NOTE the radio URL is the ROOT path
// (http://localhost:8080/aircraft.json): v1's decoder serves /run/dump1090-fa at
// the root via `python3 -m http.server`, so there is no /data/ path on the Pi (the
// /data/ default in v1's code was a latent bug, overridden by the service env).
// The poller auto-falls-back to the sibling /data/ layout for FlightAware/lighttpd
// setups, so either decoder layout works without config.
func DefaultOptions() Options {
	return Options{
		RadioURL:        "http://localhost:8080/aircraft.json",
		PollInterval:    500 * time.Millisecond, // 2×/s: catch each 1 Hz JSON write promptly (lower latency, steadier fixes)
		APIURLTemplate:  "https://api.airplanes.live/v2/point/{lat}/{lon}/{r}",
		SupplementAPI:   true,
		APIPollInterval: 4 * time.Second,
	}
}

// altPath returns the sibling aircraft.json layout (root <-> /data/) so the poller
// can auto-detect FlightAware/lighttpd (/data/) vs from-source python (root).
func altPath(url string) string {
	if strings.Contains(url, "/data/aircraft.json") {
		return strings.Replace(url, "/data/aircraft.json", "/aircraft.json", 1)
	}
	if strings.HasSuffix(url, "/aircraft.json") {
		return strings.Replace(url, "/aircraft.json", "/data/aircraft.json", 1)
	}
	return ""
}

// RadioSource polls the decoder's aircraft.json and holds the latest snapshot.
type RadioSource struct {
	opts   Options
	client *http.Client
	url    string // the working URL (may auto-switch to the sibling layout)
	mu     sync.RWMutex
	latest Snapshot
}

// NewRadio returns a radio source for the given options.
func NewRadio(opts Options) *RadioSource {
	return &RadioSource{opts: opts, url: opts.RadioURL, client: &http.Client{Timeout: 5 * time.Second}}
}

// Latest returns the most recent snapshot (implements Source).
func (r *RadioSource) Latest() Snapshot {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.latest
}

// Run polls until ctx is cancelled.
func (r *RadioSource) Run(ctx context.Context) {
	t := time.NewTicker(r.opts.PollInterval)
	defer t.Stop()
	r.poll(ctx) // prime immediately
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			r.poll(ctx)
		}
	}
}

func (r *RadioSource) poll(ctx context.Context) {
	if r.fetch(ctx, r.url) {
		return
	}
	// Current URL failed — try the sibling layout once; adopt it if it works.
	if alt := altPath(r.url); alt != "" && r.fetch(ctx, alt) {
		log.Printf("feed: radio URL switched to %s", alt)
		r.url = alt
	}
}

// fetch retrieves + stores a snapshot from url; returns true on success.
func (r *RadioSource) fetch(ctx context.Context, url string) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false
	}
	resp, err := r.client.Do(req)
	if err != nil {
		return false // decoder not up yet / transient; keep the last snapshot
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return false
	}
	snap, err := parseSnapshot(body, float64(time.Now().UnixMilli()))
	if err != nil {
		log.Printf("feed: parse aircraft.json: %v", err)
		return false
	}
	r.mu.Lock()
	r.latest = snap
	r.mu.Unlock()
	return true
}
