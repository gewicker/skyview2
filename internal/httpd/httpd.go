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

	// Static assets + SPA entry points, served from the embedded bundle.
	sub, _ := fs.Sub(distFS, "dist")
	mux.Handle("/", http.FileServer(http.FS(sub)))

	return mux
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
