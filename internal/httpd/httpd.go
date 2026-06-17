// Package httpd serves the REST API and the embedded web app. The built Vite bundle
// is compiled into the binary (go:embed dist), so deployment is a single file.
package httpd

import (
	"embed"
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"os/exec"
	"runtime"
	"time"

	"github.com/gewicker/skyview2/internal/aircraft"
	"github.com/gewicker/skyview2/internal/hub"
	"github.com/gewicker/skyview2/internal/msg"
	"github.com/gewicker/skyview2/internal/store"
)

//go:embed all:dist
var distFS embed.FS

// Process start time, reported by /api/diag as uptime.
var startedAt = time.Now()

// Deps are the server's collaborators.
type Deps struct {
	Hub      *hub.Hub
	Cfg      *store.Config
	Scenes   *store.Scenes
	Notable  *store.Notable
	Snapshot func() (float64, []aircraft.Aircraft)
	Status   func() msg.SourceStatus
	// Traffic returns the latest WSDOT flow snapshot (any-typed to keep httpd
	// decoupled from the feed package). May be nil when traffic is unwired.
	Traffic func() any
}

// New builds the HTTP handler: WS, REST, and the embedded SPA.
func New(d Deps) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/ws", d.Hub.Handle)

	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]bool{"ok": true})
	})

	mux.HandleFunc("/api/config", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, d.Cfg.Get())
		case http.MethodPost:
			body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
			writeJSON(w, d.Cfg.Patch(body))
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})
	mux.HandleFunc("/api/config/reset", func(w http.ResponseWriter, r *http.Request) {
		d.Cfg.Reset()
		writeJSON(w, d.Cfg.Get())
	})

	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, d.Status()) })
	mux.HandleFunc("/api/aircraft", func(w http.ResponseWriter, r *http.Request) {
		now, ac := d.Snapshot()
		writeJSON(w, map[string]any{"now": now, "aircraft": ac})
	})
	mux.HandleFunc("/api/notable", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, d.Notable.List()) })

	// Live highway congestion snapshot (WSDOT flow stations). Empty when disabled.
	mux.HandleFunc("/api/traffic", func(w http.ResponseWriter, r *http.Request) {
		if d.Traffic == nil {
			writeJSON(w, map[string]any{"stations": []any{}, "updated": 0})
			return
		}
		writeJSON(w, d.Traffic())
	})

	// Diagnostics: feed health + live counts + runtime stats (for the Pi and dev).
	mux.HandleFunc("/api/diag", func(w http.ResponseWriter, r *http.Request) {
		now, ac := d.Snapshot()
		var ms runtime.MemStats
		runtime.ReadMemStats(&ms)
		writeJSON(w, map[string]any{
			"now":        now,
			"aircraft":   len(ac),
			"source":     d.Status(),
			"goroutines": runtime.NumGoroutine(),
			"allocMB":    ms.Alloc / (1 << 20),
			"numGC":      ms.NumGC,
			"uptimeSec":  time.Since(startedAt).Seconds(),
			"goVersion":  runtime.Version(),
		})
	})

	// Scenes.
	mux.HandleFunc("GET /api/scenes", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, d.Scenes.List()) })
	mux.HandleFunc("POST /api/scenes", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Name string `json:"name"`
		}
		_ = json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&body)
		d.Scenes.Save(body.Name, d.Cfg.Get())
		writeJSON(w, d.Scenes.List())
	})
	mux.HandleFunc("POST /api/scenes/{name}/apply", func(w http.ResponseWriter, r *http.Request) {
		if c, ok := d.Scenes.Apply(r.PathValue("name")); ok {
			d.Cfg.Set(c)
			writeJSON(w, d.Cfg.Get())
			return
		}
		http.NotFound(w, r)
	})
	mux.HandleFunc("DELETE /api/scenes/{name}", func(w http.ResponseWriter, r *http.Request) {
		d.Scenes.Delete(r.PathValue("name"))
		writeJSON(w, d.Scenes.List())
	})

	mux.HandleFunc("/api/photo/", photoHandler)

	// Relaunch the kiosk (Pi); best-effort, no-op elsewhere.
	mux.HandleFunc("POST /api/kiosk/restart", func(w http.ResponseWriter, r *http.Request) {
		_ = exec.Command("pkill", "-f", "/usr/lib/chromium").Run()
		writeJSON(w, map[string]bool{"ok": true})
	})

	// Display power for the lights-out sleep schedule. Delegates to a small Pi script
	// (skyview-display-power on|off) that knows the compositor's blanking command;
	// best-effort, no-op where the script is absent.
	mux.HandleFunc("POST /api/display/power", func(w http.ResponseWriter, r *http.Request) {
		arg := "on"
		if r.URL.Query().Get("on") == "0" {
			arg = "off"
		}
		_ = exec.Command("skyview-display-power", arg).Run()
		writeJSON(w, map[string]bool{"ok": true})
	})

	// Static assets + the two MPA entry points (no SPA fallback, like v1).
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
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			serveFile("index.html")(w, r)
			return
		}
		files.ServeHTTP(w, r)
	})

	return mux
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
