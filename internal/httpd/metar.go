package httpd

import (
	"io"
	"net/http"
	"sync"
	"time"
)

// METAR proxy: the display can't call aviationweather.gov directly (CORS + keeps the
// kiosk's only outbound dependency on the Pi's allow-list), so the server fetches and
// caches the current KSEA observation. JSON is forwarded as-is for the client to parse.
const metarStation = "KSEA"
const metarURL = "https://aviationweather.gov/api/data/metar?ids=" + metarStation + "&format=json&taf=false"

var (
	metarMu   sync.Mutex
	metarBody []byte
	metarAt   time.Time
	metarHTTP = &http.Client{Timeout: 8 * time.Second}
)

func metarHandler(w http.ResponseWriter, r *http.Request) {
	metarMu.Lock()
	fresh := time.Since(metarAt) < 5*time.Minute && len(metarBody) > 0
	body := metarBody
	metarMu.Unlock()

	if !fresh {
		if b, err := fetchMETAR(); err == nil && len(b) > 0 {
			metarMu.Lock()
			metarBody, metarAt = b, time.Now()
			body = b
			metarMu.Unlock()
		}
	}
	if len(body) == 0 {
		http.Error(w, "[]", http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(body)
}

func fetchMETAR() ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, metarURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "skyview2")
	resp, err := metarHTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(io.LimitReader(resp.Body, 1<<16))
}
