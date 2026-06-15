// Package store persists the live config as atomic JSON and notifies subscribers
// (the WS hub) on every change. Patches are a partial JSON object unmarshalled onto
// a copy of the current config, so absent keys — including nested ones — are left
// untouched. Flush() writes synchronously; call it on shutdown so the last edit is
// never lost (a v1 bug this fixes).
package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	"github.com/gewicker/skyview2/internal/config"
)

type listener func(config.Config)

// Config is the persisted config store.
type Config struct {
	mu   sync.RWMutex
	cfg  config.Config
	path string
	subs []listener
}

// NewConfig loads the config at path (falling back to defaults) and returns a store.
func NewConfig(path string) *Config {
	c := &Config{cfg: config.Default(), path: path}
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, &c.cfg) // partial/older files merge onto defaults
	}
	return c
}

// Get returns a copy of the current config.
func (c *Config) Get() config.Config {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.cfg
}

// Subscribe registers fn for change notifications and returns an unsubscribe func.
func (c *Config) Subscribe(fn listener) func() {
	c.mu.Lock()
	c.subs = append(c.subs, fn)
	i := len(c.subs) - 1
	c.mu.Unlock()
	return func() { c.mu.Lock(); c.subs[i] = nil; c.mu.Unlock() }
}

// Patch applies a partial JSON object onto the current config.
func (c *Config) Patch(raw json.RawMessage) config.Config {
	c.mu.Lock()
	next := c.cfg
	_ = json.Unmarshal(raw, &next) // only present keys overwrite
	c.cfg = next
	c.mu.Unlock()
	c.emit()
	go c.persist()
	return next
}

// Set replaces the whole config (used by scene apply).
func (c *Config) Set(cfg config.Config) {
	c.mu.Lock()
	c.cfg = cfg
	c.mu.Unlock()
	c.emit()
	go c.persist()
}

// Reset restores defaults.
func (c *Config) Reset() { c.Set(config.Default()) }

func (c *Config) emit() {
	c.mu.RLock()
	cfg, subs := c.cfg, append([]listener(nil), c.subs...)
	c.mu.RUnlock()
	for _, fn := range subs {
		if fn != nil {
			fn(cfg)
		}
	}
}

func (c *Config) persist() { _ = c.Flush() }

// Flush writes the config to disk atomically (temp file + rename).
func (c *Config) Flush() error {
	c.mu.RLock()
	b, err := json.MarshalIndent(c.cfg, "", "  ")
	path := c.path
	c.mu.RUnlock()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
