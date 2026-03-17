package pty

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/boringdata/boring-ui/internal/app"
	"github.com/boringdata/boring-ui/internal/config"
	"github.com/boringdata/boring-ui/internal/ws"
	gorillaws "github.com/gorilla/websocket"
	"github.com/prometheus/client_golang/prometheus"
)

type Module struct {
	service        *Service
	allowedOrigins map[string]struct{}
	upgrader       gorillaws.Upgrader
}

func NewModule(cfg config.Config) (*Module, error) {
	service, err := NewService(cfg, nil)
	if err != nil {
		return nil, err
	}
	module := &Module{
		service:        service,
		allowedOrigins: allowedOrigins(cfg.CORSOrigins),
	}
	module.upgrader = gorillaws.Upgrader{
		CheckOrigin: module.checkOrigin,
	}
	return module, nil
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

func (m *Module) Name() string {
	return "pty"
}

func (m *Module) RegisterMetrics(registry *prometheus.Registry) {
	if m == nil || m.service == nil || registry == nil {
		return
	}
	collectors := []prometheus.Collector{
		prometheus.NewGaugeFunc(
			prometheus.GaugeOpts{
				Name: "boring_pty_sessions",
				Help: "Current PTY session count.",
			},
			func() float64 { return float64(m.service.SessionCount()) },
		),
		prometheus.NewGaugeFunc(
			prometheus.GaugeOpts{
				Name: "boring_pty_session_limit",
				Help: "Configured PTY session limit.",
			},
			func() float64 { return float64(m.service.MaxSessions()) },
		),
		prometheus.NewGaugeFunc(
			prometheus.GaugeOpts{
				Name: "boring_pty_ws_connections",
				Help: "Current PTY WebSocket connection count.",
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
	router.HandleWebSocket("/ws/pty", http.HandlerFunc(m.handleNewSession))
	router.HandleWebSocket("/ws/pty/{id}", http.HandlerFunc(m.handleAttachSession))
	m.registerLifecycleRoutes(router)
}

func (m *Module) Stop(_ context.Context) error {
	m.service.Shutdown()
	return nil
}

func (m *Module) handleNewSession(w http.ResponseWriter, req *http.Request) {
	if m.service.AtCapacity() {
		ws.WriteCapacityError(w)
		return
	}
	conn, err := m.upgrade(w, req)
	if err != nil {
		return
	}

	session, err := m.service.Create(req.URL.Query().Get("provider"))
	if err != nil {
		m.writeError(conn, "", err)
		_ = conn.Close()
		return
	}
	_ = m.serveSession(conn, session)
}

func (m *Module) handleAttachSession(w http.ResponseWriter, req *http.Request) {
	session, err := m.service.Session(app.URLParam(req, "id"))
	if err != nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}

	conn, upgradeErr := m.upgrade(w, req)
	if upgradeErr != nil {
		return
	}
	_ = m.serveSession(conn, session)
}

func (m *Module) serveSession(conn *ws.Conn, session *Session) error {
	if err := m.service.Attach(session.ID(), conn); err != nil {
		m.writeError(conn, session.ID(), err)
		return err
	}
	defer m.service.Detach(session.ID(), conn)
	if err := writeEnvelope(conn, envelope{Type: "session", SessionID: session.ID()}); err != nil {
		return err
	}

	for {
		_, payload, err := conn.ReadMessage()
		if err != nil {
			break
		}
		if err := m.handleClientMessage(session, conn, payload); err != nil {
			m.writeError(conn, session.ID(), err)
		}
	}
	return nil
}

func (m *Module) handleClientMessage(session *Session, conn *ws.Conn, payload []byte) error {
	var message struct {
		Type string `json:"type"`
		Data string `json:"data"`
		Rows int    `json:"rows"`
		Cols int    `json:"cols"`
	}
	if err := json.Unmarshal(payload, &message); err != nil {
		return session.Write(string(payload))
	}

	switch strings.TrimSpace(message.Type) {
	case "", "input":
		return session.Write(message.Data)
	case "resize":
		return session.Resize(message.Rows, message.Cols)
	case "ping":
		return writeEnvelope(conn, envelope{Type: "pong", SessionID: session.ID()})
	default:
		return nil
	}
}

func (m *Module) upgrade(w http.ResponseWriter, req *http.Request) (*ws.Conn, error) {
	raw, err := m.upgrader.Upgrade(w, req, nil)
	if err != nil {
		return nil, err
	}
	return ws.NewConn(raw), nil
}

func (m *Module) writeError(conn *ws.Conn, sessionID string, err error) {
	if conn == nil || err == nil {
		return
	}
	if errors.Is(err, ws.ErrAtCapacity) {
		_ = conn.WriteMessage(gorillaws.TextMessage, []byte(`{"type":"error","error":{"type":"capacity","reason":"at capacity"}}`))
		return
	}
	_ = writeEnvelope(conn, envelope{
		Type:      "error",
		SessionID: sessionID,
		Error: map[string]any{
			"type":   "spawn_failed",
			"reason": err.Error(),
		},
	})
}

func writeEnvelope(conn *ws.Conn, payload envelope) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return conn.WriteMessage(gorillaws.TextMessage, encoded)
}

func allowedOrigins(origins []string) map[string]struct{} {
	allowed := make(map[string]struct{}, len(origins))
	for _, origin := range origins {
		normalized := strings.TrimSpace(origin)
		if normalized == "" {
			continue
		}
		allowed[normalized] = struct{}{}
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
