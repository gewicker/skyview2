// Command skyview is the SkyView 2 server: it ingests the ADS-B feed (radio +
// optional API supplement), merges + enriches + flags aircraft, serves the WebSocket
// hub + REST, and ships the embedded web app — all from a single binary.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/gewicker/skyview2/internal/aircraft"
	"github.com/gewicker/skyview2/internal/config"
	"github.com/gewicker/skyview2/internal/enrich"
	"github.com/gewicker/skyview2/internal/feed"
	"github.com/gewicker/skyview2/internal/httpd"
	"github.com/gewicker/skyview2/internal/hub"
	"github.com/gewicker/skyview2/internal/msg"
	"github.com/gewicker/skyview2/internal/store"
)

func main() {
	addr := flag.String("addr", ":3000", "listen address")
	dataDir := flag.String("data", "data", "directory for config/scenes/cache")
	migrate := flag.String("migrate", "", "migrate a v1 config.json into the data dir, then exit")
	flag.Parse()

	if *migrate != "" {
		dst := filepath.Join(*dataDir, "config.json")
		if err := config.MigrateFile(*migrate, dst); err != nil {
			log.Fatalf("migrate: %v", err)
		}
		log.Printf("migrated %s -> %s", *migrate, dst)
		return
	}

	cfg := store.NewConfig(filepath.Join(*dataDir, "config.json"))
	scenes := store.NewScenes(filepath.Join(*dataDir, "scenes.json"))
	notable := store.NewNotable(func(ev msg.NotableEvent) { postWebhook(cfg.Get().NotableWebhook, ev) })
	h := hub.New(cfg, scenes, notable)

	// --- data sources (config ported from v1; env-overridable) ----------------- //
	opts := feed.DefaultOptions()
	opts.RadioURL = env("AIRCRAFT_JSON_URL", opts.RadioURL)
	opts.PollInterval = envMs("POLL_MS", opts.PollInterval)
	opts.APIURLTemplate = env("API_URL", opts.APIURLTemplate)
	opts.SupplementAPI = os.Getenv("SUPPLEMENT_API") != "0"
	opts.APIPollInterval = envMs("API_POLL_MS", opts.APIPollInterval)
	radio := feed.NewRadio(opts)

	var apiSrc *feed.APISource
	if opts.SupplementAPI {
		apiSrc = feed.NewAPI(opts.APIURLTemplate, func() feed.View {
			c := cfg.Get()
			return feed.View{Lat: c.CenterLat, Lon: c.CenterLon, RadiusMiles: c.RadiusMiles}
		})
	}
	enr := enrich.New(filepath.Join(*dataDir, "route-cache.json"), envFloat("ROUTE_CACHE_HOURS", 12))

	// Live highway congestion (WSDOT Traffic Flow). The AccessCode is free and not secret
	// (per WSDOT + George), so it's embedded as the default; env can still override. It stays
	// server-side regardless (the client only ever sees /api/traffic). Empty = disabled.
	traffic := feed.NewTraffic(env("WSDOT_ACCESS_CODE", "eab60899-d4ba-469c-9221-354c53b781bc"), filepath.Join(*dataDir, "traffic-cache.json"))

	// Live Link light-rail positions (Sound Transit OneBusAway). Per-app key, held
	// server-side (the client only ever sees /api/rail); env can override. Empty = disabled,
	// and the client falls back to the timetable simulation.
	rail := feed.NewRail(env("OBA_API_KEY", "884a2484-8efe-448e-99b2-05c5ed0ee360"), filepath.Join(*dataDir, "rail-cache.json"))

	// Live buses (same OBA key): Metro + Sound Transit vehicles within the home radius, rail
	// excluded. The view fn lets the radius/center follow config. Server-side + disk-cached.
	buses := feed.NewBuses(env("OBA_API_KEY", "884a2484-8efe-448e-99b2-05c5ed0ee360"), filepath.Join(*dataDir, "buses-cache.json"), func() feed.View {
		c := cfg.Get()
		return feed.View{Lat: c.CenterLat, Lon: c.CenterLon, RadiusMiles: c.RadiusMiles}
	})

	var lastMu sync.Mutex
	var lastNow float64
	var lastList []aircraft.Aircraft
	snapshot := func() (float64, []aircraft.Aircraft) {
		lastMu.Lock()
		defer lastMu.Unlock()
		return lastNow, lastList
	}
	h.SetPrime(func() msg.ServerMessage {
		n, ac := snapshot()
		return msg.ServerMessage{Type: "aircraft", Now: n, Aircraft: ac}
	})
	status := func() msg.SourceStatus {
		_, ac := snapshot()
		return msg.SourceStatus{OK: true, Source: "radio", Count: len(ac)}
	}

	srv := &http.Server{
		Addr: *addr,
		Handler: httpd.New(httpd.Deps{
			Hub: h, Cfg: cfg, Scenes: scenes, Notable: notable, Snapshot: snapshot, Status: status,
			Traffic: func() any { return traffic.Latest() },
			Rail:    func() any { return rail.Latest() },
			Buses:   func() any { return buses.Latest() },
		}),
		// Hardening. No blanket WriteTimeout — it would kill the long-lived /ws connection;
		// per-write deadlines live in the hub instead.
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go radio.Run(ctx)
	if apiSrc != nil {
		go apiSrc.Run(ctx, opts.APIPollInterval)
	}
	go enr.Run(ctx)
	go traffic.Run(ctx)
	go rail.Run(ctx)
	go buses.Run(ctx)
	log.Printf("feed: radio %s every %s (api supplement: %v, wsdot traffic: %v, oba rail: %v, oba buses: %v)", opts.RadioURL, opts.PollInterval, opts.SupplementAPI, traffic.Enabled(), rail.Enabled(), buses.Enabled())

	go func() {
		t := time.NewTicker(opts.PollInterval)
		defer t.Stop()
		var lastSrc float64
		lastBeat := time.Now()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				snap := radio.Latest()
				// Only enrich + broadcast when the decoder actually wrote a new snapshot
				// (its "now" advanced), or as a ~1 Hz heartbeat (late API merges + WS
				// keepalive). Lets us poll at 250 ms for low latency without 4× the CPU
				// and without re-sending duplicate frames.
				if snap.SourceNow == lastSrc && time.Since(lastBeat) < time.Second {
					continue
				}
				lastSrc = snap.SourceNow
				lastBeat = time.Now()
				now := float64(time.Now().UnixMilli())
				list := snap.Aircraft
				if apiSrc != nil {
					list = feed.MergeSources(list, apiSrc.Latest().Aircraft)
				}
				list = enr.Process(list, int64(now))
				notable.Observe(list, int64(now))
				lastMu.Lock()
				lastNow, lastList = now, list
				lastMu.Unlock()
				h.Broadcast(ctx, msg.ServerMessage{Type: "aircraft", Now: now, Aircraft: list})
			}
		}
	}()

	go func() {
		log.Printf("skyview listening on %s", *addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down…")
	if err := cfg.Flush(); err != nil {
		log.Printf("config flush: %v", err)
	}
	shutCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutCtx)
}

func postWebhook(url string, ev msg.NotableEvent) {
	if url == "" {
		return
	}
	b, err := json.Marshal(ev)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if resp, err := http.DefaultClient.Do(req); err == nil {
		_ = resp.Body.Close()
	}
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envMs(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return time.Duration(n) * time.Millisecond
		}
	}
	return def
}

func envFloat(key string, def float64) float64 {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.ParseFloat(v, 64); err == nil && n > 0 {
			return n
		}
	}
	return def
}
