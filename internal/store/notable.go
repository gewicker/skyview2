// Notable store: an in-memory, newest-first feed of flagged aircraft (emergency /
// military / rare), deduped per hex with a 30-min re-alert window, capped at 50, and
// pruned after 2 h. Not persisted (rebuilt from the live feed). Fires a callback on
// each NEW notable (for the webhook). Ported from v1.
package store

import (
	"sync"

	"github.com/gewicker/skyview2/internal/aircraft"
	"github.com/gewicker/skyview2/internal/msg"
	"github.com/gewicker/skyview2/internal/notable"
)

const (
	notableCap       = 50
	reAlertMs  int64 = 30 * 60 * 1000
	pruneMs    int64 = 2 * 60 * 60 * 1000
)

type notableListener func([]msg.NotableEvent)

// Notable holds the live notable feed.
type Notable struct {
	mu       sync.RWMutex
	events   []msg.NotableEvent
	lastSeen map[string]int64
	subs     []notableListener
	onNew    func(msg.NotableEvent)
}

// NewNotable returns a store; onNew (may be nil) fires once per newly-flagged hex.
func NewNotable(onNew func(msg.NotableEvent)) *Notable {
	return &Notable{lastSeen: map[string]int64{}, onNew: onNew}
}

// Observe classifies a snapshot and updates the feed.
func (n *Notable) Observe(list []aircraft.Aircraft, now int64) {
	n.mu.Lock()
	changed := false
	var fired []msg.NotableEvent
	for i := range list {
		a := list[i]
		_, reason, ok := notable.Classify(a)
		if !ok {
			continue
		}
		last, seen := n.lastSeen[a.Hex]
		n.lastSeen[a.Hex] = now
		if seen && now-last < reAlertMs {
			continue // still within the re-alert window
		}
		ev := msg.NotableEvent{Hex: a.Hex, Flight: a.Flight, Reason: reason, At: float64(now)}
		n.events = append([]msg.NotableEvent{ev}, n.events...)
		if len(n.events) > notableCap {
			n.events = n.events[:notableCap]
		}
		fired = append(fired, ev)
		changed = true
	}
	for hex, t := range n.lastSeen {
		if now-t > pruneMs {
			delete(n.lastSeen, hex)
		}
	}
	subs := append([]notableListener(nil), n.subs...)
	list2 := append([]msg.NotableEvent(nil), n.events...)
	onNew := n.onNew
	n.mu.Unlock()

	if changed {
		for _, fn := range subs {
			fn(list2)
		}
	}
	if onNew != nil {
		for _, ev := range fired {
			go onNew(ev)
		}
	}
}

// List returns the current feed (newest first).
func (n *Notable) List() []msg.NotableEvent {
	n.mu.RLock()
	defer n.mu.RUnlock()
	return append([]msg.NotableEvent(nil), n.events...)
}

// Subscribe registers fn for feed changes.
func (n *Notable) Subscribe(fn notableListener) {
	n.mu.Lock()
	n.subs = append(n.subs, fn)
	n.mu.Unlock()
}
