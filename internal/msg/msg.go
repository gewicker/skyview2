// Package msg defines the WebSocket wire protocol (generated to TS via tygo).
// One envelope per direction with a Type discriminator and omitempty payloads, so
// the client switches on Type. A ping/pong heartbeat lets either end detect a
// half-open socket and reconnect.
package msg

import (
	"encoding/json"

	"github.com/gewicker/skyview2/internal/aircraft"
	"github.com/gewicker/skyview2/internal/config"
)

// SourceStatus reports the health of the data feed.
type SourceStatus struct {
	OK      bool   `json:"ok"`
	Source  string `json:"source"`
	Count   int    `json:"count"`
	Message string `json:"message,omitempty"`
}

// SceneMeta is a saved named configuration (metadata only in lists).
type SceneMeta struct {
	Name    string  `json:"name"`
	SavedAt float64 `json:"savedAt"`
}

// NotableEvent is one flagged aircraft (emergency/military/rare).
type NotableEvent struct {
	Hex    string  `json:"hex"`
	Flight string  `json:"flight,omitempty"`
	Reason string  `json:"reason"`
	At     float64 `json:"at"`
}

// ServerMessage is server -> client. Type is one of:
// "config" | "aircraft" | "status" | "scenes" | "notable" | "pong".
type ServerMessage struct {
	Type     string               `json:"type"`
	Config   *config.Config       `json:"config,omitempty"`
	Now      float64              `json:"now,omitempty"`
	Aircraft []aircraft.Aircraft  `json:"aircraft,omitempty"`
	Status   *SourceStatus        `json:"status,omitempty"`
	Scenes   []SceneMeta          `json:"scenes,omitempty"`
	Notable  []NotableEvent       `json:"notable,omitempty"`
}

// ClientMessage is client -> server. Type is one of:
// "hello" | "patchConfig" | "resetConfig" | "saveScene" | "applyScene" |
// "deleteScene" | "ping".
type ClientMessage struct {
	Type   string          `json:"type"`
	Role   string          `json:"role,omitempty"`
	Patch  json.RawMessage `json:"patch,omitempty"`
	Name   string          `json:"name,omitempty"`
	Config json.RawMessage `json:"config,omitempty"` // optional full config for saveScene (web saves its own view)
}
