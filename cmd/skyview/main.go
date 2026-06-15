// Command skyview is the SkyView 2 server: it ingests the ADS-B feed (radio +
// optional API supplement), merges + enriches + flags aircraft, serves the WebSocket
// hub + REST, and ships the embedded web app — all from a single binary.
package main

import (
	"context"
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
	h := hub.New(cfg)

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

	// Latest enriched snapshot, for the on-connect prime.
	var lastMu sync.Mutex
	var lastNow float64
	var lastList []aircraft.Aircraft
	h.SetPrime(func() msg.ServerMessage {
		lastMu.Lock()
		defer lastMu.Unlock()
		return msg.ServerMessage{Type: "aircraft", Now: lastNow, Aircraft: lastList}
	})

	srv := &http.Server{Addr: *addr, Handler: httpd.New(h, cfg)}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go radio.Run(ctx)
	if apiSrc != nil {
		go apiSrc.Run(ctx, opts.APIPollInterval)
	}
	go enr.Run(ctx)
	log.Printf("feed: radio %s every %s (api supplement: %v)", opts.RadioURL, opts.PollInterval, opts.SupplementAPI)

	// Pipeline: every tick, merge radio+API, enrich, broadcast.
	go func() {
		t := time.NewTicker(opts.PollInterval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				now := float64(time.Now().UnixMilli())
				list := radio.Latest().Aircraft
				if apiSrc != nil {
					list = feed.MergeSources(list, apiSrc.Latest().Aircraft)
				}
				list = enr.Process(list, int64(now))
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
	if err := cfg.Flush(); err != nil { // flush the last config edit (a v1 bug this fixes)
		log.Printf("config flush: %v", err)
	}
	shutCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutCtx)
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
