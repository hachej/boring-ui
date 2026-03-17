package stream

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/boringdata/boring-ui/internal/app"
	"github.com/boringdata/boring-ui/internal/auth"
	"github.com/boringdata/boring-ui/internal/config"
	bridgepkg "github.com/boringdata/boring-ui/internal/stream"
	"github.com/boringdata/boring-ui/internal/ws"
	gorillaws "github.com/gorilla/websocket"
)

type fakeBridgeFactory struct {
	mu      sync.Mutex
	bridges []*fakeBridge
}

type fakeBridge struct {
	mu          sync.Mutex
	broadcaster *Session
	forwarded   [][]byte
	done        chan struct{}
	closeOnce   sync.Once
}

func (f *fakeBridgeFactory) newBridge(session *Session) bridgeRuntime {
	bridge := &fakeBridge{
		broadcaster: session,
		done:        make(chan struct{}),
	}
	f.mu.Lock()
	f.bridges = append(f.bridges, bridge)
	f.mu.Unlock()
	return bridge
}

func (b *fakeBridge) Start(ctx context.Context, _ bridgepkg.Config) error {
	go func() {
		<-ctx.Done()
		b.closeOnce.Do(func() {
			close(b.done)
		})
	}()
	return nil
}

func (b *fakeBridge) ForwardFrontend(payload []byte) error {
	b.mu.Lock()
	b.forwarded = append(b.forwarded, append([]byte(nil), payload...))
	b.mu.Unlock()

	var envelope map[string]any
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return err
	}
	return b.Emit(map[string]any{
		"type":      "ack",
		"echo_type": envelope["type"],
	})
}

func (b *fakeBridge) Wait() error {
	<-b.done
	return nil
}

func (b *fakeBridge) Emit(payload map[string]any) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return b.broadcaster.Broadcast(encoded)
}

func TestModuleMetadata(t *testing.T) {
	module := newStreamModule(t)
	if module.Name() != "chat_claude_code" {
		t.Fatalf("expected chat_claude_code, got %q", module.Name())
	}
}

func TestSessionLifecycleEndpoints(t *testing.T) {
	module := newStreamModule(t)
	handler := newStreamApp(t, module)

	createReq := authedHTTPRequest(t, http.MethodPost, "/api/v1/agent/normal/sessions", nil)
	createRec := httptest.NewRecorder()
	handler.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusOK {
		t.Fatalf("expected create 200, got %d body=%s", createRec.Code, createRec.Body.String())
	}

	var created struct {
		SessionID string `json:"session_id"`
	}
	if err := json.Unmarshal(createRec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if created.SessionID == "" {
		t.Fatalf("expected session_id, got %s", createRec.Body.String())
	}

	listReq := authedHTTPRequest(t, http.MethodGet, "/api/v1/agent/normal/sessions", nil)
	listRec := httptest.NewRecorder()
	handler.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK || !strings.Contains(listRec.Body.String(), created.SessionID) {
		t.Fatalf("expected list to include session, got status=%d body=%s", listRec.Code, listRec.Body.String())
	}

	deleteReq := authedHTTPRequest(t, http.MethodDelete, "/api/v1/agent/normal/sessions/"+created.SessionID, nil)
	deleteRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("expected delete 200, got %d body=%s", deleteRec.Code, deleteRec.Body.String())
	}

	listAgainReq := authedHTTPRequest(t, http.MethodGet, "/api/v1/agent/normal/sessions", nil)
	listAgainRec := httptest.NewRecorder()
	handler.ServeHTTP(listAgainRec, listAgainReq)
	if listAgainRec.Code != http.StatusOK || strings.Contains(listAgainRec.Body.String(), created.SessionID) {
		t.Fatalf("expected deleted session to disappear, got status=%d body=%s", listAgainRec.Code, listAgainRec.Body.String())
	}
}

func TestStreamWebSocketCreateSendReconnectAndReplay(t *testing.T) {
	module := newStreamModule(t)
	server := httptest.NewServer(newStreamApp(t, module))
	defer server.Close()

	createReq := authedHTTPRequest(t, http.MethodPost, "/api/v1/agent/normal/sessions", nil)
	createRec := httptest.NewRecorder()
	newStreamApp(t, module).ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusOK {
		t.Fatalf("create session: status=%d body=%s", createRec.Code, createRec.Body.String())
	}

	var created struct {
		SessionID string `json:"session_id"`
	}
	if err := json.Unmarshal(createRec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}

	first := connectStream(t, server.URL, "/ws/agent/normal/stream?session_id="+created.SessionID)
	defer first.Close()

	connected := mustReadWSMessage(t, first)
	if connected["type"] != "system" || connected["subtype"] != "connected" {
		t.Fatalf("expected connected envelope, got %#v", connected)
	}

	writeWSJSONMap(t, first, map[string]any{
		"type":    "user",
		"message": "hello",
	})
	ack := mustReadWSMessage(t, first)
	ackID, ok := ack["msg_id"].(float64)
	if !ok || ack["type"] != "ack" {
		t.Fatalf("expected ack with msg_id, got %#v", ack)
	}

	session, err := module.service.Session(created.SessionID)
	if err != nil {
		t.Fatalf("lookup session: %v", err)
	}
	bridge, ok := session.bridge.(*fakeBridge)
	if !ok {
		t.Fatalf("expected fake bridge, got %T", session.bridge)
	}

	first.Close()
	waitForStreamConnections(t, module, created.SessionID, 0)
	if err := bridge.Emit(map[string]any{"type": "assistant", "message": "missed"}); err != nil {
		t.Fatalf("emit replay payload: %v", err)
	}

	second := connectStream(t, server.URL, "/ws/agent/normal/stream?session_id="+created.SessionID+"&since="+strconv.Itoa(int(ackID)))
	defer second.Close()

	reconnected := mustReadWSMessage(t, second)
	if reconnected["type"] != "system" || reconnected["subtype"] != "connected" {
		t.Fatalf("expected connected message on reconnect, got %#v", reconnected)
	}

	replayed := mustReadWSMessage(t, second)
	if replayed["message"] != "missed" {
		t.Fatalf("expected replayed message, got %#v", replayed)
	}
	if replayed["msg_id"] == ack["msg_id"] {
		t.Fatalf("expected replayed message to advance msg_id, got %#v", replayed)
	}

	if err := bridge.Emit(map[string]any{"type": "assistant", "message": "live"}); err != nil {
		t.Fatalf("emit live payload: %v", err)
	}
	live := mustReadWSMessage(t, second)
	if live["message"] != "live" {
		t.Fatalf("expected live message after replay, got %#v", live)
	}
}

func TestSessionCreateAtCapacityReturns503(t *testing.T) {
	module := newStreamModule(t, WithMaxSessions(1))
	handler := newStreamApp(t, module)

	firstReq := authedHTTPRequest(t, http.MethodPost, "/api/v1/agent/normal/sessions", nil)
	firstRec := httptest.NewRecorder()
	handler.ServeHTTP(firstRec, firstReq)
	if firstRec.Code != http.StatusOK {
		t.Fatalf("expected first create 200, got %d body=%s", firstRec.Code, firstRec.Body.String())
	}

	secondReq := authedHTTPRequest(t, http.MethodPost, "/api/v1/agent/normal/sessions", nil)
	secondRec := httptest.NewRecorder()
	handler.ServeHTTP(secondRec, secondReq)
	if secondRec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected second create 503, got %d body=%s", secondRec.Code, secondRec.Body.String())
	}
}

func TestStreamMetricsExposeSessionAndConnectionGauges(t *testing.T) {
	module := newStreamModule(t, WithMaxSessions(1))
	handler := newStreamApp(t, module)
	server := httptest.NewServer(handler)
	defer server.Close()

	createReq := authedHTTPRequest(t, http.MethodPost, "/api/v1/agent/normal/sessions", nil)
	createRec := httptest.NewRecorder()
	handler.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusOK {
		t.Fatalf("expected create 200, got %d body=%s", createRec.Code, createRec.Body.String())
	}

	var created struct {
		SessionID string `json:"session_id"`
	}
	if err := json.Unmarshal(createRec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}

	conn := connectStream(t, server.URL, "/ws/agent/normal/stream?session_id="+created.SessionID)
	defer conn.Close()
	_ = mustReadWSMessage(t, conn)

	metricsReq := authedHTTPRequest(t, http.MethodGet, "/metrics", nil)
	metricsRec := httptest.NewRecorder()
	handler.ServeHTTP(metricsRec, metricsReq)
	body := metricsRec.Body.String()
	if metricsRec.Code != http.StatusOK {
		t.Fatalf("expected metrics 200, got %d body=%s", metricsRec.Code, body)
	}
	for _, want := range []string{
		"boring_stream_sessions 1",
		"boring_stream_session_limit 1",
		"boring_stream_ws_connections 1",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("expected metrics to contain %q, got %s", want, body)
		}
	}
}

func newStreamModule(t *testing.T, options ...ServiceOption) *Module {
	t.Helper()

	root := t.TempDir()
	factory := &fakeBridgeFactory{}
	allOptions := append([]ServiceOption{WithBridgeFactory(factory.newBridge), WithRegistry(ws.NewRegistry(32))}, options...)
	module, err := NewModule(config.Config{
		ConfigPath: filepath.Join(root, config.ConfigFile),
		PTYProviders: map[string][]string{
			"claude": {"fake-claude"},
		},
	}, allOptions...)
	if err != nil {
		t.Fatalf("new stream module: %v", err)
	}
	t.Cleanup(func() {
		module.service.mu.RLock()
		sessions := make([]*Session, 0, len(module.service.sessions))
		for _, session := range module.service.sessions {
			sessions = append(sessions, session)
		}
		module.service.mu.RUnlock()
		for _, session := range sessions {
			session.Stop()
		}
	})
	return module
}

func newStreamApp(t *testing.T, module *Module) http.Handler {
	t.Helper()

	t.Setenv("BORING_UI_SESSION_SECRET", "test-secret")
	t.Setenv("BORING_SESSION_SECRET", "test-secret")

	instance := app.New(config.Config{
		ConfigPath: filepath.Join(t.TempDir(), config.ConfigFile),
	})
	instance.AddModule(module)
	return instance.Handler()
}

func connectStream(t *testing.T, baseURL string, path string) *gorillaws.Conn {
	t.Helper()

	manager := auth.NewSessionManager(auth.SessionConfig{Secret: "test-secret"})
	token, err := manager.Create(auth.User{
		ID:      "worker",
		Email:   "worker@example.com",
		IsOwner: true,
	})
	if err != nil {
		t.Fatalf("create auth token: %v", err)
	}

	headers := http.Header{}
	headers.Set("Cookie", (&http.Cookie{Name: manager.CookieName(), Value: token}).String())

	wsURL := "ws" + strings.TrimPrefix(baseURL, "http") + path
	conn, _, err := gorillaws.DefaultDialer.Dial(wsURL, headers)
	if err != nil {
		t.Fatalf("dial websocket %s: %v", path, err)
	}
	return conn
}

func mustReadWSMessage(t *testing.T, conn *gorillaws.Conn) map[string]any {
	t.Helper()

	if err := conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	_, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read websocket message: %v", err)
	}

	var envelope map[string]any
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatalf("decode websocket payload %q: %v", string(payload), err)
	}
	return envelope
}

func writeWSJSONMap(t *testing.T, conn *gorillaws.Conn, payload map[string]any) {
	t.Helper()
	if err := conn.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set write deadline: %v", err)
	}
	if err := conn.WriteJSON(payload); err != nil {
		t.Fatalf("write websocket payload: %v", err)
	}
}

func waitForStreamConnections(t *testing.T, module *Module, sessionID string, want int) {
	t.Helper()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		session, err := module.service.Session(sessionID)
		if err == nil {
			session.clientsMu.RLock()
			got := len(session.clients)
			session.clientsMu.RUnlock()
			if got == want {
				return
			}
		} else if want == 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %d stream connections", want)
}

func authedHTTPRequest(t *testing.T, method string, target string, body *bytes.Buffer) *http.Request {
	t.Helper()

	var reader *bytes.Buffer
	if body == nil {
		reader = bytes.NewBuffer(nil)
	} else {
		reader = body
	}
	req := httptest.NewRequest(method, target, reader)

	manager := auth.NewSessionManager(auth.SessionConfig{Secret: "test-secret"})
	token, err := manager.Create(auth.User{
		ID:      "worker",
		Email:   "worker@example.com",
		IsOwner: true,
	})
	if err != nil {
		t.Fatalf("create auth token: %v", err)
	}
	req.AddCookie(&http.Cookie{Name: manager.CookieName(), Value: token})
	return req
}
