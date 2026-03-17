package stream

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/boringdata/boring-ui/internal/config"
	bridgepkg "github.com/boringdata/boring-ui/internal/stream"
	"github.com/boringdata/boring-ui/internal/ws"
	"github.com/google/uuid"
	gorillaws "github.com/gorilla/websocket"
)

var ErrSessionNotFound = errors.New("stream session not found")

const (
	defaultHistoryLimit = 128
	defaultMaxSessions  = 5
)

type bridgeRuntime interface {
	Start(ctx context.Context, cfg bridgepkg.Config) error
	ForwardFrontend(payload []byte) error
	Wait() error
}

type bridgeFactory func(session *Session) bridgeRuntime

type ServiceOption func(*Service)

type SessionOptions struct {
	SessionID         string
	ForceNew          bool
	Mode              string
	Model             string
	AllowedTools      []string
	DisallowedTools   []string
	MaxThinkingTokens int
	MaxTurns          int
	MaxBudgetUSD      float64
	FileSpecs         []string
}

type Service struct {
	root         string
	command      string
	baseArgs     []string
	extraEnv     []string
	maxSessions  int
	historyLimit int
	registry     *ws.Registry
	newBridge    bridgeFactory

	mu       sync.RWMutex
	sessions map[string]*Session
}

type Session struct {
	id      string
	service *Service
	bridge  bridgeRuntime
	ctx     context.Context
	cancel  context.CancelFunc

	createdAt time.Time

	clientsMu sync.RWMutex
	clients   map[*ws.Conn]struct{}

	historyMu     sync.RWMutex
	history       []historyMessage
	nextMessageID atomic.Int64

	stopOnce sync.Once
}

type historyMessage struct {
	ID      int64
	Payload []byte
}

type SessionSummary struct {
	ID        string `json:"id"`
	Clients   int    `json:"clients"`
	MessageID int64  `json:"message_id"`
	CreatedAt string `json:"created_at"`
}

func NewService(cfg config.Config, options ...ServiceOption) (*Service, error) {
	root, err := workspaceRoot(cfg)
	if err != nil {
		return nil, err
	}

	command, baseArgs := streamCommand(cfg)
	service := &Service{
		root:         root,
		command:      command,
		baseArgs:     baseArgs,
		maxSessions:  configuredInt("STREAM_MAX_SESSIONS", "KURT_STREAM_MAX_SESSIONS", defaultMaxSessions),
		historyLimit: configuredInt("STREAM_HISTORY_LIMIT", "KURT_STREAM_HISTORY_LINES", defaultHistoryLimit),
		registry:     ws.NewRegistry(ws.DefaultMaxConnections),
		newBridge: func(session *Session) bridgeRuntime {
			return bridgepkg.NewBridge(session)
		},
		sessions: make(map[string]*Session),
	}
	for _, option := range options {
		if option != nil {
			option(service)
		}
	}
	if service.maxSessions <= 0 {
		service.maxSessions = defaultMaxSessions
	}
	if service.historyLimit <= 0 {
		service.historyLimit = defaultHistoryLimit
	}
	if service.registry == nil {
		service.registry = ws.NewRegistry(ws.DefaultMaxConnections)
	}
	if service.newBridge == nil {
		service.newBridge = func(session *Session) bridgeRuntime {
			return bridgepkg.NewBridge(session)
		}
	}
	return service, nil
}

func WithBridgeFactory(factory bridgeFactory) ServiceOption {
	return func(service *Service) {
		if factory != nil {
			service.newBridge = factory
		}
	}
}

func WithRegistry(registry *ws.Registry) ServiceOption {
	return func(service *Service) {
		if registry != nil {
			service.registry = registry
		}
	}
}

func WithMaxSessions(limit int) ServiceOption {
	return func(service *Service) {
		if limit > 0 {
			service.maxSessions = limit
		}
	}
}

func WithHistoryLimit(limit int) ServiceOption {
	return func(service *Service) {
		if limit > 0 {
			service.historyLimit = limit
		}
	}
}

func (s *Service) AtCapacity() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.sessions) >= s.maxSessions
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

func (s *Service) ListSessions() []SessionSummary {
	s.mu.RLock()
	sessions := make([]*Session, 0, len(s.sessions))
	for _, session := range s.sessions {
		sessions = append(sessions, session)
	}
	s.mu.RUnlock()

	summaries := make([]SessionSummary, 0, len(sessions))
	for _, session := range sessions {
		summaries = append(summaries, session.summary())
	}
	sort.Slice(summaries, func(i, j int) bool {
		return summaries[i].ID < summaries[j].ID
	})
	return summaries
}

func (s *Service) Session(sessionID string) (*Session, error) {
	normalized := strings.TrimSpace(sessionID)
	if normalized == "" {
		return nil, ErrSessionNotFound
	}

	s.mu.RLock()
	session := s.sessions[normalized]
	s.mu.RUnlock()
	if session == nil {
		return nil, ErrSessionNotFound
	}
	return session, nil
}

func (s *Service) GetOrCreate(options SessionOptions) (*Session, bool, error) {
	sessionID := strings.TrimSpace(options.SessionID)
	if sessionID == "" {
		sessionID = uuid.NewString()
	}

	if options.ForceNew {
		if existing, err := s.Session(sessionID); err == nil {
			existing.Stop()
		}
	}

	if existing, err := s.Session(sessionID); err == nil {
		return existing, false, nil
	}

	s.mu.Lock()
	if existing := s.sessions[sessionID]; existing != nil {
		s.mu.Unlock()
		return existing, false, nil
	}
	if len(s.sessions) >= s.maxSessions {
		s.mu.Unlock()
		return nil, false, ws.ErrAtCapacity
	}

	ctx, cancel := context.WithCancel(context.Background())
	session := &Session{
		id:        sessionID,
		service:   s,
		ctx:       ctx,
		cancel:    cancel,
		createdAt: time.Now().UTC(),
		clients:   make(map[*ws.Conn]struct{}),
	}
	session.bridge = s.newBridge(session)
	s.sessions[sessionID] = session
	s.mu.Unlock()

	if err := session.bridge.Start(ctx, s.bridgeConfig(options, sessionID)); err != nil {
		cancel()
		s.remove(sessionID, session)
		return nil, false, err
	}

	go s.monitor(session)
	return session, true, nil
}

func (s *Service) Delete(sessionID string) error {
	session, err := s.Session(sessionID)
	if err != nil {
		return err
	}
	session.Stop()
	return nil
}

func (s *Service) Attach(sessionID string, conn *ws.Conn) error {
	session, err := s.Session(sessionID)
	if err != nil {
		return err
	}
	if err := s.registry.Register(sessionID, conn); err != nil {
		return err
	}

	session.clientsMu.Lock()
	session.clients[conn] = struct{}{}
	session.clientsMu.Unlock()
	return nil
}

func (s *Service) Detach(sessionID string, conn *ws.Conn) {
	if conn == nil {
		return
	}
	session, err := s.Session(sessionID)
	if err == nil {
		session.clientsMu.Lock()
		delete(session.clients, conn)
		session.clientsMu.Unlock()
	}
	s.registry.Deregister(sessionID, conn)
	_ = conn.Close()
}

func (s *Service) monitor(session *Session) {
	_ = session.bridge.Wait()
	session.Stop()
}

func (s *Service) remove(sessionID string, session *Session) {
	s.mu.Lock()
	defer s.mu.Unlock()
	current := s.sessions[sessionID]
	if current == nil {
		return
	}
	if session != nil && current != session {
		return
	}
	delete(s.sessions, sessionID)
}

func (s *Service) bridgeConfig(options SessionOptions, sessionID string) bridgepkg.Config {
	args := buildStreamArgs(s.baseArgs, sessionID, options)
	return bridgepkg.Config{
		Command: s.command,
		Args:    args,
		Dir:     s.root,
		Env:     append([]string(nil), s.extraEnv...),
	}
}

func (s *Session) ID() string {
	if s == nil {
		return ""
	}
	return s.id
}

func (s *Session) Send(payload []byte) error {
	if s == nil {
		return ErrSessionNotFound
	}
	return s.bridge.ForwardFrontend(payload)
}

func (s *Session) Broadcast(payload []byte) error {
	if s == nil {
		return ErrSessionNotFound
	}

	msgID, encoded, err := s.withMessageID(payload)
	if err != nil {
		return err
	}

	s.historyMu.Lock()
	s.history = append(s.history, historyMessage{ID: msgID, Payload: encoded})
	if extra := len(s.history) - s.service.historyLimit; extra > 0 {
		s.history = append([]historyMessage(nil), s.history[extra:]...)
	}
	s.historyMu.Unlock()

	return s.service.registry.Broadcast(s.id, ws.TextMessage(encoded))
}

func (s *Session) ReplaySince(since int64, conn *ws.Conn) error {
	if s == nil || conn == nil {
		return nil
	}

	s.historyMu.RLock()
	history := make([]historyMessage, 0, len(s.history))
	for _, message := range s.history {
		if message.ID > since {
			history = append(history, historyMessage{
				ID:      message.ID,
				Payload: append([]byte(nil), message.Payload...),
			})
		}
	}
	s.historyMu.RUnlock()

	for _, message := range history {
		if err := conn.WriteMessage(gorillaws.TextMessage, message.Payload); err != nil {
			return err
		}
	}
	return nil
}

func (s *Session) Stop() {
	if s == nil {
		return
	}

	s.stopOnce.Do(func() {
		s.cancel()
		s.service.remove(s.id, s)

		s.clientsMu.Lock()
		clients := make([]*ws.Conn, 0, len(s.clients))
		for conn := range s.clients {
			clients = append(clients, conn)
			delete(s.clients, conn)
		}
		s.clientsMu.Unlock()

		for _, conn := range clients {
			s.service.registry.Deregister(s.id, conn)
			_ = conn.Close()
		}
	})
}

func (s *Session) summary() SessionSummary {
	s.clientsMu.RLock()
	clientCount := len(s.clients)
	s.clientsMu.RUnlock()

	return SessionSummary{
		ID:        s.id,
		Clients:   clientCount,
		MessageID: s.nextMessageID.Load(),
		CreatedAt: s.createdAt.Format(time.RFC3339),
	}
}

func (s *Session) withMessageID(payload []byte) (int64, []byte, error) {
	var envelope map[string]any
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return 0, nil, err
	}

	msgID := s.nextMessageID.Add(1)
	envelope["msg_id"] = msgID

	encoded, err := json.Marshal(envelope)
	if err != nil {
		return 0, nil, err
	}
	return msgID, encoded, nil
}

func workspaceRoot(cfg config.Config) (string, error) {
	if cfg.ConfigPath != "" {
		return filepath.Dir(cfg.ConfigPath), nil
	}
	root, err := config.FindProjectRoot()
	if err == nil {
		return root, nil
	}
	return os.Getwd()
}

func streamCommand(cfg config.Config) (string, []string) {
	command := cfg.PTYProviders["claude"]
	if len(command) == 0 {
		command = []string{"claude"}
	}
	return command[0], append([]string(nil), command[1:]...)
}

func configuredInt(primary string, secondary string, fallback int) int {
	for _, key := range []string{primary, secondary} {
		raw := strings.TrimSpace(os.Getenv(key))
		if raw == "" {
			continue
		}
		value, err := strconv.Atoi(raw)
		if err == nil && value > 0 {
			return value
		}
	}
	return fallback
}

func buildStreamArgs(baseArgs []string, sessionID string, options SessionOptions) []string {
	args := append([]string(nil), baseArgs...)

	if !containsArg(args, "--output-format") {
		args = append(args, "--output-format", "stream-json")
	}
	if !containsArg(args, "--input-format") {
		args = append(args, "--input-format", "stream-json")
	}
	if !containsArg(args, "--verbose") {
		args = append(args, "--verbose")
	}
	if !containsArg(args, "--permission-prompt-tool") {
		args = append(args, "--permission-prompt-tool", "stdio")
	}
	if !containsArg(args, "--setting-sources") {
		args = append(args, "--setting-sources", "user,project,local")
	}

	if sessionID != "" {
		args = append(args, "--session-id", sessionID)
	}

	modeMap := map[string]string{
		"ask":  "default",
		"act":  "acceptEdits",
		"plan": "plan",
	}
	if value := modeMap[strings.TrimSpace(options.Mode)]; value != "" && !containsArg(args, "--permission-mode") {
		args = append(args, "--permission-mode", value)
	}
	if strings.TrimSpace(options.Model) != "" {
		args = append(args, "--model", strings.TrimSpace(options.Model))
	}
	if options.MaxThinkingTokens > 0 {
		args = append(args, "--max-thinking-tokens", strconv.Itoa(options.MaxThinkingTokens))
	}
	if options.MaxTurns > 0 {
		args = append(args, "--max-turns", strconv.Itoa(options.MaxTurns))
	}
	if options.MaxBudgetUSD > 0 {
		args = append(args, "--max-budget-usd", strconv.FormatFloat(options.MaxBudgetUSD, 'f', -1, 64))
	}
	if len(options.AllowedTools) > 0 {
		args = append(args, "--allowedTools", strings.Join(options.AllowedTools, ","))
	}
	if len(options.DisallowedTools) > 0 {
		args = append(args, "--disallowedTools", strings.Join(options.DisallowedTools, ","))
	}
	for _, fileSpec := range options.FileSpecs {
		trimmed := strings.TrimSpace(fileSpec)
		if trimmed == "" {
			continue
		}
		args = append(args, "--file", trimmed)
	}

	return args
}

func containsArg(args []string, flag string) bool {
	for _, arg := range args {
		if arg == flag {
			return true
		}
	}
	return false
}
