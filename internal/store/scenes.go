// Scene store: named saved configurations, persisted as a JSON array, atomic
// writes, newest-first listing. Ported from v1. Clients receive only lightweight
// SceneMeta; the full config stays server-side and is applied via the config store.
package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gewicker/skyview2/internal/config"
	"github.com/gewicker/skyview2/internal/msg"
)

type sceneEntry struct {
	Name    string        `json:"name"`
	SavedAt float64       `json:"savedAt"`
	Config  config.Config `json:"config"`
}

type sceneListener func([]msg.SceneMeta)

// Scenes is the persisted scene store.
type Scenes struct {
	mu     sync.RWMutex
	path   string
	scenes map[string]sceneEntry
	subs   []sceneListener
}

// NewScenes loads scenes.json (if present) and returns a store.
func NewScenes(path string) *Scenes {
	s := &Scenes{path: path, scenes: map[string]sceneEntry{}}
	if b, err := os.ReadFile(path); err == nil {
		var arr []sceneEntry
		if json.Unmarshal(b, &arr) == nil {
			for _, e := range arr {
				if e.Name != "" {
					s.scenes[e.Name] = e
				}
			}
		}
	}
	return s
}

func normName(name string) string {
	name = strings.Join(strings.Fields(strings.TrimSpace(name)), " ")
	if len(name) > 40 {
		name = name[:40]
	}
	return name
}

// List returns scene metadata, newest first.
func (s *Scenes) List() []msg.SceneMeta {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]msg.SceneMeta, 0, len(s.scenes))
	for _, e := range s.scenes {
		out = append(out, msg.SceneMeta{Name: e.Name, SavedAt: e.SavedAt})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].SavedAt > out[j].SavedAt })
	return out
}

// Save stores cfg under name (overwriting), persists, and notifies.
func (s *Scenes) Save(name string, cfg config.Config) {
	name = normName(name)
	if name == "" {
		return
	}
	s.mu.Lock()
	s.scenes[name] = sceneEntry{Name: name, SavedAt: float64(time.Now().UnixMilli()), Config: cfg}
	s.mu.Unlock()
	s.emit()
	go s.flush()
}

// Apply returns the named scene's config.
func (s *Scenes) Apply(name string) (config.Config, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	e, ok := s.scenes[normName(name)]
	return e.Config, ok
}

// Delete removes a scene.
func (s *Scenes) Delete(name string) {
	s.mu.Lock()
	delete(s.scenes, normName(name))
	s.mu.Unlock()
	s.emit()
	go s.flush()
}

// Subscribe registers fn for scene-list changes.
func (s *Scenes) Subscribe(fn sceneListener) {
	s.mu.Lock()
	s.subs = append(s.subs, fn)
	s.mu.Unlock()
}

func (s *Scenes) emit() {
	list := s.List()
	s.mu.RLock()
	subs := append([]sceneListener(nil), s.subs...)
	s.mu.RUnlock()
	for _, fn := range subs {
		fn(list)
	}
}

func (s *Scenes) flush() {
	s.mu.RLock()
	arr := make([]sceneEntry, 0, len(s.scenes))
	for _, e := range s.scenes {
		arr = append(arr, e)
	}
	path := s.path
	s.mu.RUnlock()
	b, err := json.MarshalIndent(arr, "", "  ")
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	tmp := path + ".tmp"
	if os.WriteFile(tmp, b, 0o644) == nil {
		_ = os.Rename(tmp, path)
	}
}
