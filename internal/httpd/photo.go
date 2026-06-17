// Aircraft photo proxy: hex (or registration fallback) -> a planespotters thumbnail
// URL, cached in-process for 6 h. Ported from v1. Real User-Agent/Accept to avoid
// 403s. Returns {url, photographer, link} or 404.
package httpd

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type photoResp struct {
	URL          string `json:"url"`
	Photographer string `json:"photographer,omitempty"`
	Link         string `json:"link,omitempty"`
}

type photoEntry struct {
	data photoResp
	at   time.Time
	ok   bool
}

var (
	photoMu     sync.Mutex
	photoCache  = map[string]photoEntry{}
	photoClient = &http.Client{Timeout: 5 * time.Second}
)

func photoHandler(w http.ResponseWriter, r *http.Request) {
	hex := sanitizeHex(strings.ToLower(strings.TrimPrefix(r.URL.Path, "/api/photo/")))
	if hex == "" {
		http.NotFound(w, r)
		return
	}
	reg := r.URL.Query().Get("reg")

	photoMu.Lock()
	e, cached := photoCache[hex]
	photoMu.Unlock()
	if cached && time.Since(e.at) < 6*time.Hour {
		if e.ok {
			writeJSON(w, e.data)
		} else {
			http.NotFound(w, r)
		}
		return
	}

	res, ok := fetchPhoto(hex, reg)
	photoMu.Lock()
	photoCache[hex] = photoEntry{data: res, at: time.Now(), ok: ok}
	// Bound the cache: it previously only TTL-gated on read and never deleted, so it grew for
	// every hex ever queried. Sweep expired entries once it gets large (keeps a long-running
	// Pi from slowly leaking the photo map).
	if len(photoCache) > 600 {
		cut := time.Now().Add(-6 * time.Hour)
		for k, v := range photoCache {
			if v.at.Before(cut) {
				delete(photoCache, k)
			}
		}
	}
	photoMu.Unlock()
	if ok {
		writeJSON(w, res)
	} else {
		http.NotFound(w, r)
	}
}

func fetchPhoto(hex, reg string) (photoResp, bool) {
	if r, ok := planespotters("hex", hex); ok {
		return r, true
	}
	if reg != "" {
		if r, ok := planespotters("reg", reg); ok {
			return r, true
		}
	}
	return photoResp{}, false
}

func planespotters(kind, id string) (photoResp, bool) {
	req, err := http.NewRequest(http.MethodGet, "https://api.planespotters.net/pub/photos/"+kind+"/"+url.PathEscape(id), nil)
	if err != nil {
		return photoResp{}, false
	}
	req.Header.Set("User-Agent", "SkyView/2 (+https://github.com/gewicker/skyview2)")
	req.Header.Set("Accept", "application/json")
	resp, err := photoClient.Do(req)
	if err != nil {
		return photoResp{}, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return photoResp{}, false
	}
	var d struct {
		Photos []struct {
			ThumbnailLarge struct {
				Src string `json:"src"`
			} `json:"thumbnail_large"`
			Link         string `json:"link"`
			Photographer string `json:"photographer"`
		} `json:"photos"`
	}
	if json.NewDecoder(resp.Body).Decode(&d) != nil || len(d.Photos) == 0 {
		return photoResp{}, false
	}
	p := d.Photos[0]
	if p.ThumbnailLarge.Src == "" {
		return photoResp{}, false
	}
	return photoResp{URL: p.ThumbnailLarge.Src, Photographer: p.Photographer, Link: p.Link}, true
}

func sanitizeHex(s string) string {
	out := make([]rune, 0, len(s))
	for _, c := range s {
		if (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') {
			out = append(out, c)
		}
	}
	return string(out)
}
