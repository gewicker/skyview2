// Package hub is the WebSocket fan-out: it primes each new client with the current
// config + snapshot + scenes + notable, broadcasts changes, applies inbound config
// patches and scene commands via the stores, and answers ping with pong.
package hub

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/gewicker/skyview2/internal/config"
	"github.com/gewicker/skyview2/internal/msg"
	"github.com/gewicker/skyview2/internal/store"
)

type client struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

// Hub tracks connected clients and bridges them to the stores.
type Hub struct {
	cfg     *store.Config
	scenes  *store.Scenes
	notable *store.Notable
	prime   func() msg.ServerMessage
	mu      sync.RWMutex
	clients map[*client]struct{}
}

// New wires a hub to the stores and broadcasts their changes to all clients.
func New(cfg *store.Config, scenes *store.Scenes, notable *store.Notable) *Hub {
	h := &Hub{cfg: cfg, scenes: scenes, notable: notable, clients: map[*client]struct{}{}}
	cfg.Subscribe(func(c config.Config) {
		h.Broadcast(context.Background(), msg.ServerMessage{Type: "config", Config: &c})
	})
	scenes.Subscribe(func(list []msg.SceneMeta) {
		h.Broadcast(context.Background(), msg.ServerMessage{Type: "scenes", Scenes: list})
	})
	notable.Subscribe(func(list []msg.NotableEvent) {
		h.Broadcast(context.Background(), msg.ServerMessage{Type: "notable", Notable: list})
	})
	return h
}

// SetPrime registers the latest-snapshot source for the connect-time prime.
// Guarded by h.mu so the set (startup) can't race a concurrent client read.
func (h *Hub) SetPrime(fn func() msg.ServerMessage) {
	h.mu.Lock()
	h.prime = fn
	h.mu.Unlock()
}

func (h *Hub) getPrime() func() msg.ServerMessage {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.prime
}

// Handle upgrades the request and serves the client until it closes.
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
	if p := h.getPrime(); p != nil {
		cl.write(ctx, p())
	}
	cl.write(ctx, msg.ServerMessage{Type: "scenes", Scenes: h.scenes.List()})
	cl.write(ctx, msg.ServerMessage{Type: "notable", Notable: h.notable.List()})

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
	case "saveScene":
		// A web client may send the config it wants saved (its own view); otherwise
		// snapshot the live server/kiosk config.
		if len(m.Config) > 0 {
			var c config.Config
			if err := json.Unmarshal(m.Config, &c); err == nil {
				h.scenes.Save(m.Name, c)
			}
		} else {
			h.scenes.Save(m.Name, h.cfg.Get())
		}
	case "applyScene":
		if c, ok := h.scenes.Apply(m.Name); ok {
			h.cfg.Set(c)
		}
	case "deleteScene":
		h.scenes.Delete(m.Name)
	case "hello":
	}
}

// Broadcast sends a message to every connected client. The frame is marshalled ONCE
// (not re-encoded per client — the dominant per-tick CPU cost on the Pi with a 100+
// aircraft list) and the prebuilt bytes are written to each client.
func (h *Hub) Broadcast(ctx context.Context, m msg.ServerMessage) {
	b, err := json.Marshal(m)
	if err != nil {
		return
	}
	h.mu.RLock()
	cls := make([]*client, 0, len(h.clients))
	for c := range h.clients {
		cls = append(cls, c)
	}
	h.mu.RUnlock()
	for _, c := range cls {
		c.writeRaw(ctx, b)
	}
}

// write marshals + sends a single message with a bounded deadline, closing the conn on
// failure so a stalled/half-open client can't block the broadcast loop forever.
func (c *client) write(ctx context.Context, m msg.ServerMessage) {
	c.mu.Lock()
	defer c.mu.Unlock()
	wctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := wsjson.Write(wctx, c.conn, m); err != nil {
		_ = c.conn.Close(websocket.StatusPolicyViolation, "write timeout")
	}
}

// writeRaw sends prebuilt JSON bytes (a pre-marshalled ServerMessage) as a text frame,
// with the same bounded deadline + close-on-error semantics as write.
func (c *client) writeRaw(ctx context.Context, b []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	wctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := c.conn.Write(wctx, websocket.MessageText, b); err != nil {
		_ = c.conn.Close(websocket.StatusPolicyViolation, "write timeout")
	}
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
	_ = c.conn.Close(websocket.StatusNormalClosure, "")
}
