package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// MigrateFile reads a v1 config.json and writes a v2 config.json. Migration is
// nearly free: v2's field names match v1's, and unmarshalling onto Default() keeps
// every v2 default while overlaying the v1 values that still exist. Dropped v1 keys
// (projectorEnabled, recording, nightDim/nightRed, theme) are simply ignored.
func MigrateFile(src, dst string) error {
	b, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	cfg := Default()
	if err := json.Unmarshal(b, &cfg); err != nil {
		return err
	}
	out, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	return os.WriteFile(dst, out, 0o644)
}
