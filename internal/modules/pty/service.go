package pty

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/boringdata/boring-ui/internal/config"
	"github.com/boringdata/boring-ui/internal/ws"
	"github.com/creack/pty"
	"github.com/google/uuid"
)

var (
	ErrSessionNotFound = errors.New("pty session not found")
	ErrUnknownProvider = errors.New("unknown pty provider")
)

const (
	defaultMaxSessions     = 10
	defaultIdleTTL         = 5 * time.Minute
	defaultCleanupInterval = time.Second
)

type Service struct {
	root            string
	providers       map[string][]string
	registry        *ws.Registry
	maxSessions     int
	idleTTL         time.Duration
	cleanupInterval time.Duration
	stopCleanup     chan struct{}
	cleanupDone     chan struct{}
	shutdownOnce    sync.Once

	mu       sync.RWMutex
	sessions map[string]*Session
}

type Session struct {
	id       string
	provider string
	command  []string
	registry *ws.Registry
	service  *Service

	mu           sync.Mutex
	clients      map[*ws.Conn]struct{}
	createdAt    time.Time
	lastActivity time.Time

	cmd       *exec.Cmd
	terminal  *os.File
	closeOnce sync.Once
	done      chan struct{}
}

type SessionSummary struct {
	ID          string  `json:"id"`
	Provider    string  `json:"provider"`
	Alive       bool    `json:"alive"`
	Clients     int     `json:"clients"`
	IdleSeconds float64 `json:"idle_seconds"`
}

type envelope struct {
	Type      string         `json:"type"`
	SessionID string         `json:"session_id,omitempty"`
	Data      string         `json:"data,omitempty"`
	Code      int            `json:"code,omitempty"`
	Error     map[string]any `json:"error,omitempty"`
}

func NewService(cfg config.Config, registry *ws.Registry) (*Service, error) {
	root, err := workspaceRoot(cfg)
	if err != nil {
		return nil, err
	}
	if registry == nil {
		registry = ws.NewRegistry(ws.DefaultMaxConnections)
	}
	service := &Service{
		root:            root,
		providers:       config.ClonePTYProviders(cfg.PTYProviders),
		registry:        registry,
		maxSessions:     configuredMaxSessions(),
		idleTTL:         configuredIdleTTL(),
		cleanupInterval: configuredCleanupInterval(),
		stopCleanup:     make(chan struct{}),
		cleanupDone:     make(chan struct{}),
		sessions:        make(map[string]*Session),
	}
	go service.cleanupLoop()
	return service, nil
}

func (s *Service) Create(provider string) (*Session, error) {
	command, err := s.providerCommand(provider)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	name := strings.TrimSpace(provider)
	if name == "" {
		name = "shell"
	}

	session := &Session{
		id:           uuid.NewString(),
		provider:     name,
		command:      command,
		registry:     s.registry,
		service:      s,
		clients:      make(map[*ws.Conn]struct{}),
		createdAt:    now,
		lastActivity: now,
		done:         make(chan struct{}),
	}

	s.mu.Lock()
	if len(s.sessions) >= s.maxSessions {
		s.mu.Unlock()
		return nil, ws.ErrAtCapacity
	}
	s.sessions[session.id] = session
	s.mu.Unlock()

	if err := session.start(s.root); err != nil {
		s.remove(session.id)
		return nil, err
	}
	return session, nil
}

func (s *Service) Session(sessionID string) (*Session, error) {
	normalized, err := normalizeSessionID(sessionID)
	if err != nil {
		return nil, err
	}

	s.mu.RLock()
	session := s.sessions[normalized]
	s.mu.RUnlock()
	if session == nil {
		return nil, ErrSessionNotFound
	}
	return session, nil
}

func (s *Service) Attach(sessionID string, conn *ws.Conn) error {
	session, err := s.Session(sessionID)
	if err != nil {
		return err
	}
	if err := s.registry.Register(session.id, conn); err != nil {
		return err
	}

	session.mu.Lock()
	session.clients[conn] = struct{}{}
	session.mu.Unlock()
	return nil
}

func (s *Service) Detach(sessionID string, conn *ws.Conn) {
	session, err := s.Session(sessionID)
	if err != nil {
		if conn != nil {
			_ = conn.Close()
		}
		return
	}

	session.mu.Lock()
	delete(session.clients, conn)
	session.mu.Unlock()

	s.registry.Deregister(session.id, conn)
	if conn != nil {
		_ = conn.Close()
	}
	if s.registry.Connections(session.id) == 0 {
		session.Close()
	}
}

func (s *Service) SessionCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.sessions)
}

func (s *Service) MaxSessions() int {
	if s == nil {
		return 0
	}
	return s.maxSessions
}

func (s *Service) ConnectionCount() int {
	if s == nil || s.registry == nil {
		return 0
	}
	return s.registry.InUse()
}

func (s *Service) AtCapacity() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.sessions) >= s.maxSessions
}

func (s *Service) ListSessions() []SessionSummary {
	s.mu.RLock()
	defer s.mu.RUnlock()

	summaries := make([]SessionSummary, 0, len(s.sessions))
	for _, session := range s.sessions {
		summaries = append(summaries, session.summary())
	}
	sort.Slice(summaries, func(i, j int) bool {
		return summaries[i].ID < summaries[j].ID
	})
	return summaries
}

func (s *Service) Delete(sessionID string) error {
	session, err := s.Session(sessionID)
	if err != nil {
		return err
	}
	session.Close()
	return nil
}

func (s *Service) Shutdown() {
	s.shutdownOnce.Do(func() {
		close(s.stopCleanup)
		<-s.cleanupDone

		s.mu.RLock()
		sessions := make([]*Session, 0, len(s.sessions))
		for _, session := range s.sessions {
			sessions = append(sessions, session)
		}
		s.mu.RUnlock()
		for _, session := range sessions {
			session.Close()
		}
	})
}

func (s *Service) providerCommand(provider string) ([]string, error) {
	name := strings.TrimSpace(provider)
	if name == "" {
		name = "shell"
	}
	command, ok := s.providers[name]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrUnknownProvider, name)
	}
	if len(command) == 0 {
		return nil, fmt.Errorf("%w: %s", ErrUnknownProvider, name)
	}
	copied := make([]string, len(command))
	copy(copied, command)
	return copied, nil
}

func (s *Service) remove(sessionID string) {
	s.mu.Lock()
	delete(s.sessions, sessionID)
	s.mu.Unlock()
}

func (s *Session) ID() string {
	return s.id
}

func (s *Session) Write(data string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.terminal == nil {
		return netClosed()
	}
	s.lastActivity = time.Now().UTC()
	_, err := io.WriteString(s.terminal, data)
	return err
}

func (s *Session) Resize(rows int, cols int) error {
	if rows <= 0 {
		rows = 24
	}
	if cols <= 0 {
		cols = 80
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.terminal == nil {
		return netClosed()
	}
	s.lastActivity = time.Now().UTC()
	return pty.Setsize(s.terminal, &pty.Winsize{Rows: uint16(rows), Cols: uint16(cols)})
}

func (s *Session) Close() {
	s.closeOnce.Do(func() {
		close(s.done)
		s.service.remove(s.id)

		s.mu.Lock()
		clients := make([]*ws.Conn, 0, len(s.clients))
		for conn := range s.clients {
			clients = append(clients, conn)
		}
		s.clients = make(map[*ws.Conn]struct{})
		terminal := s.terminal
		cmd := s.cmd
		s.terminal = nil
		s.cmd = nil
		s.mu.Unlock()

		for _, conn := range clients {
			s.registry.Deregister(s.id, conn)
			_ = conn.Close()
		}
		if terminal != nil {
			_ = terminal.Close()
		}
		if cmd != nil && cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
	})
}

func (s *Session) start(root string) error {
	cmd := exec.Command(s.command[0], s.command[1:]...)
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	terminal, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: 24, Cols: 80})
	if err != nil {
		return err
	}

	s.mu.Lock()
	s.cmd = cmd
	s.terminal = terminal
	s.mu.Unlock()

	go s.readLoop(terminal)
	go s.waitLoop(cmd)
	return nil
}

func (s *Session) readLoop(terminal *os.File) {
	buffer := make([]byte, 4096)
	for {
		n, err := terminal.Read(buffer)
		if n > 0 {
			s.touch()
			payload, marshalErr := json.Marshal(envelope{
				Type:      "output",
				SessionID: s.id,
				Data:      string(buffer[:n]),
			})
			if marshalErr == nil {
				_ = s.registry.Broadcast(s.id, ws.TextMessage(payload))
			}
		}
		if err != nil {
			select {
			case <-s.done:
			default:
			}
			return
		}
	}
}

func (s *Session) waitLoop(cmd *exec.Cmd) {
	err := cmd.Wait()
	exitCode := exitCodeFromErr(err)

	payload, marshalErr := json.Marshal(envelope{
		Type:      "exit",
		SessionID: s.id,
		Code:      exitCode,
	})
	if marshalErr == nil {
		_ = s.registry.Broadcast(s.id, ws.TextMessage(payload))
	}
	s.Close()
}

func (s *Session) errorEnvelope(err error) []byte {
	reason := strings.TrimSpace(err.Error())
	if reason == "" {
		reason = "PTY spawn failed"
	}
	payload, _ := json.Marshal(envelope{
		Type:      "error",
		SessionID: s.id,
		Error: map[string]any{
			"type":   "spawn_failed",
			"reason": reason,
		},
	})
	return payload
}

func (s *Session) touch() {
	s.mu.Lock()
	s.lastActivity = time.Now().UTC()
	s.mu.Unlock()
}

func (s *Session) summary() SessionSummary {
	s.mu.Lock()
	defer s.mu.Unlock()

	clients := len(s.clients)
	return SessionSummary{
		ID:          s.id,
		Provider:    s.provider,
		Alive:       s.terminal != nil,
		Clients:     clients,
		IdleSeconds: time.Since(s.lastActivity).Seconds(),
	}
}

func (s *Service) cleanupLoop() {
	ticker := time.NewTicker(s.cleanupInterval)
	defer ticker.Stop()
	defer close(s.cleanupDone)

	for {
		select {
		case <-s.stopCleanup:
			return
		case <-ticker.C:
			s.cleanupIdleSessions()
		}
	}
}

func (s *Service) cleanupIdleSessions() {
	s.mu.RLock()
	sessions := make([]*Session, 0, len(s.sessions))
	for _, session := range s.sessions {
		sessions = append(sessions, session)
	}
	s.mu.RUnlock()

	now := time.Now().UTC()
	for _, session := range sessions {
		session.mu.Lock()
		idleFor := now.Sub(session.lastActivity)
		session.mu.Unlock()
		if idleFor > s.idleTTL {
			session.Close()
		}
	}
}

func configuredMaxSessions() int {
	if raw := strings.TrimSpace(os.Getenv("PTY_MAX_SESSIONS")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			return parsed
		}
	}
	return defaultMaxSessions
}

func configuredIdleTTL() time.Duration {
	if raw := strings.TrimSpace(os.Getenv("PTY_IDLE_TTL_MS")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			return time.Duration(parsed) * time.Millisecond
		}
	}
	if raw := strings.TrimSpace(os.Getenv("PTY_IDLE_TTL_SECONDS")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			return time.Duration(parsed) * time.Second
		}
	}
	return defaultIdleTTL
}

func configuredCleanupInterval() time.Duration {
	if raw := strings.TrimSpace(os.Getenv("PTY_CLEANUP_INTERVAL_MS")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			return time.Duration(parsed) * time.Millisecond
		}
	}
	return defaultCleanupInterval
}

func normalizeSessionID(sessionID string) (string, error) {
	parsed, err := uuid.Parse(strings.TrimSpace(sessionID))
	if err != nil {
		return "", ErrSessionNotFound
	}
	return parsed.String(), nil
}

func exitCodeFromErr(err error) int {
	if err == nil {
		return 0
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode()
	}
	return -1
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

func netClosed() error {
	return io.ErrClosedPipe
}
