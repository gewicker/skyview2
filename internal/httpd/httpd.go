// Package httpd serves the REST API and the embedded web app. The built Vite bundle
// is compiled into the binary (go:embed dist), so deployment is a single file.
// Vite is configured to output into internal/httpd/dist (see web/vite.config.ts).
package httpd

import (
	"embed"
	"encoding/json"
	"io"
	"io/fs"
	"net/http"

	"github.com/gewicker/skyview2/internal/hub"
	"github.com/gewicker/skyview2/internal/store"
)

//go:embed all:dist
var distFS embed.FS

// New builds the HTTP handler: WS, REST, and the embedded SPA.
func New(h *hub.Hub, cfg *store.Config) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/ws", h.Handle)

	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]bool{"ok": true})
	})

	mux.HandleFunc("/api/config", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, cfg.Get())
		case http.MethodPost:
			body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
			writeJSON(w, cfg.Patch(body))
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/config/reset", func(w http.ResponseWriter, r *http.Request) {
		cfg.Reset()
		writeJSON(w, cfg.Get())
	})

	mux.HandleFunc("/api/photo/", photoHandler)

	// Static assets + the two MPA entry points (like v1's express.static + the two
	// explicit routes). There is no SPA fallback: "/" serves the display and
	// "/control" the phone panel; everything else resolves to a real embedded file.
	sub, _ := fs.Sub(distFS, "dist")
	files := http.FileServer(http.FS(sub))
	serveFile := func(name string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			b, err := fs.ReadFile(sub, name)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write(b)
		}
	}
	mux.HandleFunc("/control", serveFile("control.html"))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			serveFile("index.html")(w, r)
			return
		}
		files.ServeHTTP(w, r) // hashed /assets/*, control.html, etc.
	})

	return mux
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
