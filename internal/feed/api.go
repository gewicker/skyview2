// API supplement: poll airplanes.live's point query and keep the latest snapshot,
// merged with the radio (see MergeSources) so aircraft the local receiver briefly
// drops or that are beyond its range stay alive. Ported from v1's apiUrlTemplate +
// buildApiUrl (radius in nautical miles, capped at 250). airplanes.live uses the
// readsb schema with an "ac" array, which parseSnapshot already handles.
package feed

import (
	"context"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const nmPerMile = 0.868976

// View is the projection origin + range the API query is built from.
type View struct {
	Lat, Lon, RadiusMiles float64
}

// APISource polls the airplanes.live point query around the configured view.
type APISource struct {
	template string
	view     func() View
	client   *http.Client
	mu       sync.RWMutex
	latest   Snapshot
}

// NewAPI returns an API source. view supplies the live center/radius each poll.
func NewAPI(template string, view func() View) *APISource {
	return &APISource{template: template, view: view, client: &http.Client{Timeout: 5 * time.Second}}
}

// Latest returns the most recent API snapshot.
func (s *APISource) Latest() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.latest
}

// Run polls until ctx is cancelled.
func (s *APISource) Run(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	s.poll(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.poll(ctx)
		}
	}
}

func (s *APISource) url() string {
	v := s.view()
	r := math.Min(250, math.Ceil(v.RadiusMiles*nmPerMile)+1)
	rep := strings.NewReplacer(
		"{lat}", trimFloat(v.Lat),
		"{lon}", trimFloat(v.Lon),
		"{r}", trimFloat(r),
	)
	return rep.Replace(s.template)
}

func (s *APISource) poll(ctx context.Context) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.url(), nil)
	if err != nil {
		return
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return
	}
	snap, err := parseSnapshot(body, float64(time.Now().UnixMilli()))
	if err != nil {
		return
	}
	s.mu.Lock()
	s.latest = snap
	s.mu.Unlock()
}

func trimFloat(f float64) string {
	return strconv.FormatFloat(f, 'f', -1, 64) // shortest exact form, e.g. 47.617 / 20
}
