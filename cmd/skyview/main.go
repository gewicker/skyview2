// Command skyview is the SkyView 2 server: it ingests the ADS-B feed, enriches and
// flags aircraft, serves the WebSocket hub + REST, and ships the embedded web app —
// all from a single binary.
package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/gewicker/skyview2/internal/feed"
	"github.com/gewicker/skyview2/internal/hub"
	"github.com/gewicker/skyview2/internal/httpd"
	"github.com/gewicker/skyview2/internal/msg"
	"github.com/gewicker/skyview2/internal/store"
)

func main() {
	addr := flag.String("addr", ":3000", "listen address")
	dataDir := flag.String("data", "data", "directory for config/scenes/notable")
	flag.Parse()

	cfg := store.NewConfig(filepath.Join(*dataDir, "config.json"))
	h := hub.New(cfg)
	src := feed.Source(feed.Stub{}) // TODO Phase 1: real radio/API ingest

	srv := &http.Server{Addr: *addr, Handler: httpd.New(h, cfg)}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Broadcast the latest snapshot on a fixed cadence.
	go func() {
		t := time.NewTicker(time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s := src.Latest()
				h.Broadcast(ctx, msg.ServerMessage{
					Type: "aircraft", Now: float64(time.Now().UnixMilli()), Aircraft: s.Aircraft,
				})
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
	// Flush the last config edit before exit (a v1 bug this fixes).
	if err := cfg.Flush(); err != nil {
		log.Printf("config flush: %v", err)
	}
	shutCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutCtx)
}
