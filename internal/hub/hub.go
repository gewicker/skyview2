// Package hub is the WebSocket fan-out: it primes each new client with the current
// config, broadcasts config/aircraft/status/notable changes, applies inbound config
// patches via the store, and answers ping with pong so clients can detect a
// half-open socket and reconnect.
package hub

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/gewicker/skyview2/internal/config"
	"github.com/gewicker/skyview2/internal/msg"
	"github.com/gewicker/skyview2/internal/store"
)

type client struct {
	conn *websocket.Conn
	mu   sync.Mutex // serialises writes to this conn
}

// Hub tracks connected clients and bridges them to the config store.
type Hub struct {
	cfg     *store.Config
	prime   func() msg.ServerMessage // optional: latest snapshot to prime new clients
	mu      sync.RWMutex
	clients map[*client]struct{}
}

// SetPrime registers a source for the snapshot pushed to each new client on
// connect (v1 primes config + the current aircraft list so the display isn't blank
// until the next broadcast).
func (h *Hub) SetPrime(fn func() msg.ServerMessage) { h.prime = fn }

// New wires a hub to the config store and broadcasts config changes to all clients.
func New(cfg *store.Config) *Hub {
	h := &Hub{cfg: cfg, clients: map[*client]struct{}{}}
	cfg.Subscribe(func(c config.Config) {
		h.Broadcast(context.Background(), msg.ServerMessage{Type: "config", Config: &c})
	})
	return h
}

// Handle upgrades the request to a WebSocket and serves the client until it closes.
func (h *Hub) Handle(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	cl := &client{conn: conn}
	h.add(cl)
	defer h.remove(cl)

	ctx := r.Context()
	cfg := h.cfg.Get()
	cl.write(ctx, msg.ServerMessage{Type: "config", Config: &cfg})
	if h.prime != nil {
		cl.write(ctx, h.prime())
	}

	for {
		var m msg.ClientMessage
		if err := wsjson.Read(ctx, conn, &m); err != nil {
			return
		}
		h.onMessage(ctx, cl, m)
	}
}

func (h *Hub) onMessage(ctx context.Context, cl *client, m msg.ClientMessage) {
	switch m.Type {
	case "ping":
		cl.write(ctx, msg.ServerMessage{Type: "pong"})
	case "patchConfig":
		if len(m.Patch) > 0 {
			h.cfg.Patch(json.RawMessage(m.Patch))
		}
	case "resetConfig":
		h.cfg.Reset()
	case "hello":
		// role noted; nothing to do yet
	}
}

// Broadcast sends a message to every connected client.
func (h *Hub) Broadcast(ctx context.Context, m msg.ServerMessage) {
	h.mu.RLock()
	cls := make([]*client, 0, len(h.clients))
	for c := range h.clients {
		cls = append(cls, c)
	}
	h.mu.RUnlock()
	for _, c := range cls {
		c.write(ctx, m)
	}
}

// BroadcastConfig pushes the current config to all clients.
func (h *Hub) BroadcastConfig(ctx context.Context) {
	cfg := h.cfg.Get()
	h.Broadcast(ctx, msg.ServerMessage{Type: "config", Config: &cfg})
}

func (c *client) write(ctx context.Context, m msg.ServerMessage) {
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = wsjson.Write(ctx, c.conn, m)
}

func (h *Hub) add(c *client) {
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
}

func (h *Hub) remove(c *client) {
	h.mu.Lock()
	delete(h.clients, c)
	h.mu.Unlock()
	_ = c.conn.CloseNow()
}
