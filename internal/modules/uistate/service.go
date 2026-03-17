package uistate

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/boringdata/boring-ui/internal/config"
	"github.com/boringdata/boring-ui/internal/storage"
)

const stateFilePath = ".boring/ui_state.json"

type persistedState struct {
	States     map[string]map[string]any   `json:"states"`
	Commands   map[string][]map[string]any `json:"commands"`
	CommandSeq int                         `json:"command_seq"`
}

type Service struct {
	storage storage.Storage

	mu         sync.Mutex
	states     map[string]map[string]any
	commands   map[string][]map[string]any
	commandSeq int
}

func NewService(cfg config.Config, store storage.Storage) (*Service, error) {
	if store == nil {
		root, err := workspaceRoot(cfg)
		if err != nil {
			return nil, err
		}
		store, err = storage.NewLocal(root)
		if err != nil {
			return nil, err
		}
	}

	s := &Service{
		storage:  store,
		states:   map[string]map[string]any{},
		commands: map[string][]map[string]any{},
	}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Service) Upsert(payload map[string]any) (map[string]any, error) {
	clientID := strings.TrimSpace(asString(payload["client_id"]))
	if clientID == "" {
		return nil, errors.New("client_id is required")
	}

	stored := cloneMap(payload)
	stored["client_id"] = clientID
	if _, ok := stored["open_panels"]; !ok {
		stored["open_panels"] = []any{}
	}
	if _, ok := stored["meta"]; !ok {
		stored["meta"] = map[string]any{}
	}
	if _, ok := stored["captured_at_ms"]; !ok {
		stored["captured_at_ms"] = nil
	}
	stored["updated_at"] = nowISO()

	s.mu.Lock()
	defer s.mu.Unlock()

	s.states[clientID] = stored
	if err := s.saveLocked(); err != nil {
		return nil, err
	}
	return cloneMap(stored), nil
}

func (s *Service) ResolveClientID(clientID string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.resolveClientIDLocked(clientID)
}

func (s *Service) List() []map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()

	items := make([]map[string]any, 0, len(s.states))
	for _, state := range s.states {
		items = append(items, cloneMap(state))
	}
	sort.Slice(items, func(i, j int) bool {
		return asString(items[i]["updated_at"]) > asString(items[j]["updated_at"])
	})
	return items
}

func (s *Service) Get(clientID string) map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, ok := s.states[strings.TrimSpace(clientID)]
	if !ok {
		return nil
	}
	return cloneMap(state)
}

func (s *Service) GetLatest() map[string]any {
	states := s.List()
	if len(states) == 0 {
		return nil
	}
	return states[0]
}

func (s *Service) ListOpenPanels(clientID string) map[string]any {
	resolved := s.ResolveClientID(clientID)
	if resolved == "" {
		return nil
	}
	state := s.Get(resolved)
	if state == nil {
		return nil
	}
	openPanels, _ := state["open_panels"].([]any)
	if openPanels == nil {
		openPanels = []any{}
	}
	return map[string]any{
		"client_id":       resolved,
		"active_panel_id": state["active_panel_id"],
		"open_panels":     openPanels,
		"count":           len(openPanels),
		"updated_at":      state["updated_at"],
	}
}

func (s *Service) EnqueueCommand(command map[string]any, clientID string) (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	resolved := s.resolveClientIDLocked(clientID)
	if resolved == "" {
		return nil, nil
	}

	s.commandSeq++
	stored := map[string]any{
		"id":        fmt.Sprintf("cmd-%d", s.commandSeq),
		"client_id": resolved,
		"command":   cloneMap(command),
		"queued_at": nowISO(),
	}
	s.commands[resolved] = append(s.commands[resolved], stored)
	if err := s.saveLocked(); err != nil {
		return nil, err
	}
	return cloneMap(stored), nil
}

func (s *Service) PopNextCommand(clientID string) (map[string]any, error) {
	normalized := strings.TrimSpace(clientID)
	if normalized == "" {
		return nil, nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	queue := s.commands[normalized]
	if len(queue) == 0 {
		return nil, nil
	}
	item := queue[0]
	if len(queue) == 1 {
		delete(s.commands, normalized)
	} else {
		s.commands[normalized] = queue[1:]
	}
	if err := s.saveLocked(); err != nil {
		return nil, err
	}
	return cloneMap(item), nil
}

func (s *Service) Delete(clientID string) (bool, error) {
	normalized := strings.TrimSpace(clientID)
	if normalized == "" {
		return false, nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	_, existed := s.states[normalized]
	delete(s.states, normalized)
	delete(s.commands, normalized)
	if !existed {
		return false, nil
	}
	if err := s.saveLocked(); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Service) Clear() (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	count := len(s.states)
	s.states = map[string]map[string]any{}
	s.commands = map[string][]map[string]any{}
	s.commandSeq = 0
	if err := s.saveLocked(); err != nil {
		return 0, err
	}
	return count, nil
}

func (s *Service) load() error {
	data, err := s.storage.ReadFile(stateFilePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if len(data) == 0 {
		return nil
	}

	var persisted persistedState
	if err := json.Unmarshal(data, &persisted); err != nil {
		return err
	}
	if persisted.States != nil {
		s.states = persisted.States
	}
	if persisted.Commands != nil {
		s.commands = persisted.Commands
	}
	s.commandSeq = persisted.CommandSeq
	return nil
}

func (s *Service) saveLocked() error {
	payload := persistedState{
		States:     s.states,
		Commands:   s.commands,
		CommandSeq: s.commandSeq,
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	return s.storage.WriteFile(stateFilePath, data)
}

func (s *Service) resolveClientIDLocked(clientID string) string {
	normalized := strings.TrimSpace(clientID)
	if normalized != "" {
		if _, ok := s.states[normalized]; ok {
			return normalized
		}
		return ""
	}
	if len(s.states) == 0 {
		return ""
	}
	var latestID string
	var latestTS string
	for id, state := range s.states {
		ts := asString(state["updated_at"])
		if ts > latestTS {
			latestID = id
			latestTS = ts
		}
	}
	return latestID
}

func workspaceRoot(cfg config.Config) (string, error) {
	if cfg.ConfigPath != "" {
		root := filepath.Dir(cfg.ConfigPath)
		if resolved, err := filepath.EvalSymlinks(root); err == nil {
			return resolved, nil
		}
		return root, nil
	}
	root, err := config.FindProjectRoot()
	if err == nil {
		if resolved, resolveErr := filepath.EvalSymlinks(root); resolveErr == nil {
			return resolved, nil
		}
		return root, nil
	}
	return os.Getwd()
}

func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

func asString(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	default:
		return fmt.Sprintf("%v", typed)
	}
}

func cloneMap(input map[string]any) map[string]any {
	if input == nil {
		return nil
	}
	data, err := json.Marshal(input)
	if err != nil {
		out := make(map[string]any, len(input))
		for key, value := range input {
			out[key] = value
		}
		return out
	}
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		out = make(map[string]any, len(input))
		for key, value := range input {
			out[key] = value
		}
	}
	return out
}
