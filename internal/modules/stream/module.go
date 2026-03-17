package stream

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/boringdata/boring-ui/internal/app"
	"github.com/boringdata/boring-ui/internal/config"
	"github.com/boringdata/boring-ui/internal/ws"
	gorillaws "github.com/gorilla/websocket"
	"github.com/prometheus/client_golang/prometheus"
)

const modulePrefix = "/api/v1/agent/normal"

type Module struct {
	service        *Service
	allowedOrigins map[string]struct{}
	upgrader       gorillaws.Upgrader
}

func NewModule(cfg config.Config, options ...ServiceOption) (*Module, error) {
	service, err := NewService(cfg, options...)
	if err != nil {
		return nil, err
	}

	module := &Module{
		service:        service,
		allowedOrigins: allowedOrigins(cfg.CORSOrigins),
	}
	module.upgrader = gorillaws.Upgrader{CheckOrigin: module.checkOrigin}
	return module, nil
}

func (m *Module) Name() string {
	return "chat_claude_code"
}

func (m *Module) RegisterMetrics(registry *prometheus.Registry) {
	if m == nil || m.service == nil || registry == nil {
		return
	}
	collectors := []prometheus.Collector{
		prometheus.NewGaugeFunc(
			prometheus.GaugeOpts{
				Name: "boring_stream_sessions",
				Help: "Current agent-normal stream session count.",
			},
			func() float64 { return float64(m.service.SessionCount()) },
		),
		prometheus.NewGaugeFunc(
			prometheus.GaugeOpts{
				Name: "boring_stream_session_limit",
				Help: "Configured agent-normal stream session limit.",
			},
			func() float64 { return float64(m.service.MaxSessions()) },
		),
		prometheus.NewGaugeFunc(
			prometheus.GaugeOpts{
				Name: "boring_stream_ws_connections",
				Help: "Current agent-normal stream WebSocket connection count.",
			},
			func() float64 { return float64(m.service.ConnectionCount()) },
		),
	}
	for _, collector := range collectors {
		if err := registry.Register(collector); err != nil {
			if _, ok := err.(prometheus.AlreadyRegisteredError); !ok {
				panic(err)
			}
		}
	}
}

func (m *Module) RegisterRoutes(router app.Router) {
	router.Route(modulePrefix, func(r app.Router) {
		r.Method(http.MethodPost, "/sessions", http.HandlerFunc(m.handleCreateSession))
		r.Method(http.MethodGet, "/sessions", http.HandlerFunc(m.handleListSessions))
		r.Method(http.MethodDelete, "/sessions/{id}", http.HandlerFunc(m.handleDeleteSession))
	})
	router.HandleWebSocket("/ws/agent/normal/stream", http.HandlerFunc(m.handleStream))
}

func (m *Module) handleCreateSession(w http.ResponseWriter, _ *http.Request) {
	session, _, err := m.service.GetOrCreate(SessionOptions{})
	if errors.Is(err, ws.ErrAtCapacity) {
		ws.WriteCapacityError(w)
		return
	}
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"session_id": session.ID()})
}

func (m *Module) handleListSessions(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"sessions": m.service.ListSessions()})
}

func (m *Module) handleDeleteSession(w http.ResponseWriter, req *http.Request) {
	sessionID := app.URLParam(req, "id")
	if err := m.service.Delete(sessionID); err != nil {
		if errors.Is(err, ErrSessionNotFound) {
			panic(app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: "session not found"})
		}
		panic(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true, "session_id": sessionID})
}

func (m *Module) handleStream(w http.ResponseWriter, req *http.Request) {
	options := parseSessionOptions(req)
	session, created, err := m.service.GetOrCreate(options)
	if errors.Is(err, ws.ErrAtCapacity) {
		ws.WriteCapacityError(w)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	conn, err := m.upgrade(w, req)
	if err != nil {
		if created {
			session.Stop()
		}
		return
	}

	if err := m.service.Attach(session.ID(), conn); err != nil {
		_ = writeWSJSON(conn, map[string]any{
			"type":    "system",
			"subtype": "error",
			"message": err.Error(),
		})
		_ = conn.Close()
		return
	}
	defer m.service.Detach(session.ID(), conn)

	if err := writeWSJSON(conn, map[string]any{
		"type":       "system",
		"subtype":    "connected",
		"session_id": session.ID(),
		"resumed":    !created,
	}); err != nil {
		return
	}

	if err := session.ReplaySince(parseSince(req), conn); err != nil {
		return
	}

	for {
		_, payload, err := conn.ReadMessage()
		if err != nil {
			return
		}

		normalized := payload
		if !json.Valid(payload) {
			normalized, _ = json.Marshal(map[string]any{
				"type":    "user",
				"message": string(payload),
			})
		}

		var envelope struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(normalized, &envelope); err == nil && strings.TrimSpace(envelope.Type) == "ping" {
			if err := writeWSJSON(conn, map[string]any{"type": "pong"}); err != nil {
				return
			}
			continue
		}

		if err := session.Send(normalized); err != nil {
			_ = writeWSJSON(conn, map[string]any{
				"type":    "system",
				"subtype": "error",
				"message": err.Error(),
			})
			return
		}
	}
}

func (m *Module) upgrade(w http.ResponseWriter, req *http.Request) (*ws.Conn, error) {
	raw, err := m.upgrader.Upgrade(w, req, nil)
	if err != nil {
		return nil, err
	}
	return ws.NewConn(raw), nil
}

func (m *Module) checkOrigin(req *http.Request) bool {
	origin := strings.TrimSpace(req.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" {
		return false
	}
	if sameOrigin(req, parsed) {
		return true
	}
	_, ok := m.allowedOrigins[origin]
	return ok
}

func parseSessionOptions(req *http.Request) SessionOptions {
	query := req.URL.Query()
	return SessionOptions{
		SessionID:         strings.TrimSpace(query.Get("session_id")),
		ForceNew:          truthy(query.Get("force_new")),
		Mode:              strings.TrimSpace(query.Get("mode")),
		Model:             strings.TrimSpace(query.Get("model")),
		AllowedTools:      parseCSV(query.Get("allowed_tools")),
		DisallowedTools:   parseCSV(query.Get("disallowed_tools")),
		MaxThinkingTokens: parseInt(query.Get("max_thinking_tokens")),
		MaxTurns:          parseInt(query.Get("max_turns")),
		MaxBudgetUSD:      parseFloat(query.Get("max_budget_usd")),
		FileSpecs:         append([]string(nil), query["file"]...),
	}
}

func parseSince(req *http.Request) int64 {
	value := strings.TrimSpace(req.URL.Query().Get("since"))
	if value == "" {
		return 0
	}
	since, err := strconv.ParseInt(value, 10, 64)
	if err != nil || since < 0 {
		return 0
	}
	return since
}

func parseCSV(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func parseInt(value string) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed <= 0 {
		return 0
	}
	return parsed
}

func parseFloat(value string) float64 {
	parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || parsed <= 0 {
		return 0
	}
	return parsed
}

func truthy(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes":
		return true
	default:
		return false
	}
}

func allowedOrigins(origins []string) map[string]struct{} {
	allowed := make(map[string]struct{}, len(origins))
	for _, origin := range origins {
		normalized := strings.TrimSpace(origin)
		if normalized != "" {
			allowed[normalized] = struct{}{}
		}
	}
	return allowed
}

func sameOrigin(req *http.Request, origin *url.URL) bool {
	reqHost := strings.TrimSpace(req.Host)
	if reqHost == "" {
		return false
	}
	return strings.EqualFold(origin.Host, reqHost)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeWSJSON(conn *ws.Conn, payload any) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return conn.WriteMessage(gorillaws.TextMessage, encoded)
}
