// Off-air weather radar (FIS-B NEXRAD from the 978 UAT SDR). A separate decoder (see
// pi-setup/install-fisb.sh + docs/DUAL-RADIO-BUILD-PLAN.md) writes a georeferenced reflectivity raster
// into `dir` as two files: nexrad.png (dBZ-ramp colored, transparent where no data) and nexrad.json
// ({bounds:[N,S,E,W], time, kind}). This feed just reads the small json into memory and hands the PNG
// straight from disk to httpd. It degrades to nothing when no FIS-B has been decoded yet, so it's safe
// to run with no second radio — /api/wxradar returns {} and the client falls back to online radar.
package feed

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// wxMeta mirrors nexrad.json.
type wxMeta struct {
	Bounds []float64 `json:"bounds"` // [north, south, east, west]
	Time   int64     `json:"time"`   // product time, epoch ms
	Kind   string    `json:"kind,omitempty"`
}

// WxRadar holds the latest off-air NEXRAD metadata; the PNG is served from disk on demand.
type WxRadar struct {
	dir  string
	mu   sync.RWMutex
	meta *wxMeta
}

// NewWxRadar returns a feed reading the decoder's output dir (empty dir = disabled).
func NewWxRadar(dir string) *WxRadar { return &WxRadar{dir: dir} }

// Enabled reports whether a decoder output dir was configured.
func (w *WxRadar) Enabled() bool { return w.dir != "" }

// Latest returns the metadata for /api/wxradar, or {} when there's no raster yet.
func (w *WxRadar) Latest() any {
	w.mu.RLock()
	defer w.mu.RUnlock()
	if w.meta == nil || len(w.meta.Bounds) != 4 {
		return map[string]any{}
	}
	age := (time.Now().UnixMilli() - w.meta.Time) / 1000
	return map[string]any{
		"url":    "/api/wxradar/nexrad.png",
		"bounds": w.meta.Bounds, // [N, S, E, W]
		"time":   w.meta.Time,
		"age":    age, // seconds since the product time; client prefers off-air while fresh
		"kind":   w.meta.Kind,
	}
}

// PNG returns the current raster bytes (nil, false when none).
func (w *WxRadar) PNG() ([]byte, bool) {
	if w.dir == "" {
		return nil, false
	}
	b, err := os.ReadFile(filepath.Join(w.dir, "nexrad.png"))
	if err != nil {
		return nil, false
	}
	return b, true
}

// Run reloads the metadata every 20 s until ctx is cancelled.
func (w *WxRadar) Run(ctx context.Context) {
	if w.dir == "" {
		return
	}
	t := time.NewTicker(20 * time.Second)
	defer t.Stop()
	w.reload()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			w.reload()
		}
	}
}

func (w *WxRadar) reload() {
	b, err := os.ReadFile(filepath.Join(w.dir, "nexrad.json"))
	if err != nil {
		return // no product yet — keep last-good
	}
	var m wxMeta
	if json.Unmarshal(b, &m) != nil || len(m.Bounds) != 4 {
		return
	}
	w.mu.Lock()
	w.meta = &m
	w.mu.Unlock()
}
