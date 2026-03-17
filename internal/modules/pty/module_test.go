package pty

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/boringdata/boring-ui/internal/app"
	"github.com/boringdata/boring-ui/internal/auth"
	"github.com/boringdata/boring-ui/internal/config"
	gorillaws "github.com/gorilla/websocket"
)

func TestModuleMetadata(t *testing.T) {
	module := newPTYModule(t, t.TempDir(), map[string][]string{"shell": {"sh"}})
	if module.Name() != "pty" {
		t.Fatalf("expected module name pty, got %q", module.Name())
	}
}

func TestPTYModuleCreatesSessionAndBroadcastsToAttachedClients(t *testing.T) {
	module := newPTYModule(t, t.TempDir(), map[string][]string{
		"shell": {"sh"},
	})
	server := newPTYServer(t, module)
	defer server.Close()

	first := connectPTY(t, server.URL, "/ws/pty")
	defer first.Close()

	firstSession := waitForSessionEnvelope(t, first)
	if firstSession.Type != "session" || firstSession.SessionID == "" {
		t.Fatalf("expected first session envelope, got %#v", firstSession)
	}

	second := connectPTY(t, server.URL, "/ws/pty/"+firstSession.SessionID)
	defer second.Close()

	secondSession := waitForSessionEnvelope(t, second)
	if secondSession.Type != "session" || secondSession.SessionID != firstSession.SessionID {
		t.Fatalf("expected attached client to join same session, got %#v", secondSession)
	}

	writeWSJSON(t, first, map[string]any{
		"type": "input",
		"data": "echo hello\n",
	})

	waitForOutputContaining(t, first, "hello")
	waitForOutputContaining(t, second, "hello")

	first.Close()
	second.Close()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if module.service.SessionCount() == 0 {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("expected PTY session cleanup after disconnects, still have %d sessions", module.service.SessionCount())
}

func TestPTYModuleMissingProviderCommandSendsErrorEnvelope(t *testing.T) {
	module := newPTYModule(t, t.TempDir(), map[string][]string{
		"shell":  {"sh"},
		"claude": {"definitely-not-a-real-command-binary"},
	})
	server := newPTYServer(t, module)
	defer server.Close()

	conn := connectPTY(t, server.URL, "/ws/pty?provider=claude")
	defer conn.Close()

	payload := mustReadEnvelope(t, conn)
	if payload.Type != "error" {
		t.Fatalf("expected error payload, got %#v", payload)
	}
	reason, _ := payload.Error["reason"].(string)
	if !strings.Contains(strings.ToLower(reason), "not found") && !strings.Contains(strings.ToLower(reason), "executable") {
		t.Fatalf("expected spawn failure reason, got %#v", payload.Error)
	}
}

func TestPTYModuleRejectsDisallowedOrigin(t *testing.T) {
	module := newPTYModule(t, t.TempDir(), map[string][]string{
		"shell": {"sh"},
	})
	server := newPTYServer(t, module)
	defer server.Close()

	headers := http.Header{}
	headers.Set("Origin", "https://evil.example")

	_, _, err := connectPTYWithHeaders(t, server.URL, "/ws/pty", headers)
	if err == nil || !strings.Contains(strings.ToLower(err.Error()), "bad handshake") {
		t.Fatalf("expected origin rejection handshake failure, got %v", err)
	}
}

func TestPTYLifecycleCRUDEndpoints(t *testing.T) {
	module := newPTYModule(t, t.TempDir(), map[string][]string{
		"shell": {"sh"},
	})
	handler := newPTYApp(t, module)

	createReq := authedHTTPRequest(t, http.MethodPost, "/api/v1/pty/sessions", bytes.NewBufferString(`{"provider":"shell"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRec := httptest.NewRecorder()
	handler.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusOK {
		t.Fatalf("expected create 200, got %d body=%s", createRec.Code, createRec.Body.String())
	}

	var created struct {
		SessionID string `json:"session_id"`
	}
	if err := json.Unmarshal(createRec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create payload: %v", err)
	}
	if created.SessionID == "" {
		t.Fatalf("expected session id, got %s", createRec.Body.String())
	}

	listReq := authedHTTPRequest(t, http.MethodGet, "/api/v1/pty/sessions", nil)
	listRec := httptest.NewRecorder()
	handler.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK || !strings.Contains(listRec.Body.String(), created.SessionID) {
		t.Fatalf("expected list to include session, got status=%d body=%s", listRec.Code, listRec.Body.String())
	}

	deleteReq := authedHTTPRequest(t, http.MethodDelete, "/api/v1/pty/sessions/"+created.SessionID, nil)
	deleteRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("expected delete 200, got %d body=%s", deleteRec.Code, deleteRec.Body.String())
	}

	listAgainReq := authedHTTPRequest(t, http.MethodGet, "/api/v1/pty/sessions", nil)
	listAgainRec := httptest.NewRecorder()
	handler.ServeHTTP(listAgainRec, listAgainReq)
	if listAgainRec.Code != http.StatusOK || strings.Contains(listAgainRec.Body.String(), created.SessionID) {
		t.Fatalf("expected session removal, got status=%d body=%s", listAgainRec.Code, listAgainRec.Body.String())
	}
}

func TestPTYLifecycleCreateAtCapacityReturns503(t *testing.T) {
	t.Setenv("PTY_MAX_SESSIONS", "1")

	module := newPTYModule(t, t.TempDir(), map[string][]string{
		"shell": {"sh"},
	})
	handler := newPTYApp(t, module)

	firstReq := authedHTTPRequest(t, http.MethodPost, "/api/v1/pty/sessions", bytes.NewBufferString(`{"provider":"shell"}`))
	firstReq.Header.Set("Content-Type", "application/json")
	firstRec := httptest.NewRecorder()
	handler.ServeHTTP(firstRec, firstReq)
	if firstRec.Code != http.StatusOK {
		t.Fatalf("expected first create 200, got %d body=%s", firstRec.Code, firstRec.Body.String())
	}

	secondReq := authedHTTPRequest(t, http.MethodPost, "/api/v1/pty/sessions", bytes.NewBufferString(`{"provider":"shell"}`))
	secondReq.Header.Set("Content-Type", "application/json")
	secondRec := httptest.NewRecorder()
	handler.ServeHTTP(secondRec, secondReq)
	if secondRec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected second create 503, got %d body=%s", secondRec.Code, secondRec.Body.String())
	}
}

func TestPTYLifecycleIdleTimeoutTriggersCleanup(t *testing.T) {
	t.Setenv("PTY_IDLE_TTL_MS", "50")
	t.Setenv("PTY_CLEANUP_INTERVAL_MS", "10")

	module := newPTYModule(t, t.TempDir(), map[string][]string{
		"shell": {"sh"},
	})
	handler := newPTYApp(t, module)

	createReq := authedHTTPRequest(t, http.MethodPost, "/api/v1/pty/sessions", bytes.NewBufferString(`{"provider":"shell"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRec := httptest.NewRecorder()
	handler.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusOK {
		t.Fatalf("expected create 200, got %d body=%s", createRec.Code, createRec.Body.String())
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if module.service.SessionCount() == 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("expected idle timeout cleanup, still have %d sessions", module.service.SessionCount())
}

func TestPTYWebSocketCreateAtCapacityReturns503(t *testing.T) {
	t.Setenv("PTY_MAX_SESSIONS", "1")

	module := newPTYModule(t, t.TempDir(), map[string][]string{
		"shell": {"sh"},
	})
	server := newPTYServer(t, module)
	defer server.Close()

	first := connectPTY(t, server.URL, "/ws/pty")
	defer first.Close()
	_ = mustReadEnvelope(t, first)

	_, resp, err := connectPTYWithHeaders(t, server.URL, "/ws/pty", nil)
	if err == nil {
		t.Fatal("expected second websocket create to fail at capacity")
	}
	if resp == nil || resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 handshake response, got resp=%v err=%v", resp, err)
	}
}

func TestPTYMetricsExposeSessionAndConnectionGauges(t *testing.T) {
	t.Setenv("PTY_MAX_SESSIONS", "1")

	module := newPTYModule(t, t.TempDir(), map[string][]string{
		"shell": {"sh"},
	})
	server := newPTYServer(t, module)
	defer server.Close()

	createReq := authedHTTPRequest(t, http.MethodPost, "/api/v1/pty/sessions", bytes.NewBufferString(`{"provider":"shell"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRec := httptest.NewRecorder()
	newPTYApp(t, module).ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusOK {
		t.Fatalf("expected create 200, got %d body=%s", createRec.Code, createRec.Body.String())
	}

	var created struct {
		SessionID string `json:"session_id"`
	}
	if err := json.Unmarshal(createRec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create payload: %v", err)
	}

	conn := connectPTY(t, server.URL, "/ws/pty/"+created.SessionID)
	defer conn.Close()
	_ = mustReadEnvelope(t, conn)

	metricsReq := authedHTTPRequest(t, http.MethodGet, "/metrics", nil)
	metricsRec := httptest.NewRecorder()
	newPTYApp(t, module).ServeHTTP(metricsRec, metricsReq)
	body := metricsRec.Body.String()
	if metricsRec.Code != http.StatusOK {
		t.Fatalf("expected metrics 200, got %d body=%s", metricsRec.Code, body)
	}
	for _, want := range []string{
		"boring_pty_sessions 1",
		"boring_pty_session_limit 1",
		"boring_pty_ws_connections 1",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("expected metrics to contain %q, got %s", want, body)
		}
	}
}

func newPTYModule(t *testing.T, root string, providers map[string][]string) *Module {
	t.Helper()

	cfg := config.Config{
		ConfigPath:   filepath.Join(root, config.ConfigFile),
		PTYProviders: providers,
	}
	module, err := NewModule(cfg)
	if err != nil {
		t.Fatalf("new pty module: %v", err)
	}
	t.Cleanup(module.service.Shutdown)
	return module
}

func newPTYApp(t *testing.T, module *Module) http.Handler {
	t.Helper()

	t.Setenv("BORING_UI_SESSION_SECRET", "test-secret")
	t.Setenv("BORING_SESSION_SECRET", "test-secret")

	cfg := config.Config{
		ConfigPath:   filepath.Join(t.TempDir(), config.ConfigFile),
		PTYProviders: config.ClonePTYProviders(module.service.providers),
	}
	instance := app.New(cfg)
	instance.AddModule(module)
	return instance.Handler()
}

func newPTYServer(t *testing.T, module *Module) *httptest.Server {
	t.Helper()

	return httptest.NewServer(newPTYApp(t, module))
}

func connectPTY(t *testing.T, baseURL string, path string) *gorillaws.Conn {
	t.Helper()

	conn, _, err := connectPTYWithHeaders(t, baseURL, path, nil)
	if err != nil {
		t.Fatalf("dial websocket %s: %v", path, err)
	}
	return conn
}

func connectPTYWithHeaders(t *testing.T, baseURL string, path string, headers http.Header) (*gorillaws.Conn, *http.Response, error) {
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

	wsURL := "ws" + strings.TrimPrefix(baseURL, "http") + path
	if headers == nil {
		headers = http.Header{}
	}
	headers.Set("Cookie", (&http.Cookie{Name: manager.CookieName(), Value: token}).String())

	return gorillaws.DefaultDialer.Dial(wsURL, headers)
}

func mustReadEnvelope(t *testing.T, conn *gorillaws.Conn) envelope {
	t.Helper()

	if err := conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	_, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read websocket message: %v", err)
	}
	var message envelope
	if err := json.Unmarshal(payload, &message); err != nil {
		t.Fatalf("decode envelope %q: %v", string(payload), err)
	}
	return message
}

func writeWSJSON(t *testing.T, conn *gorillaws.Conn, payload map[string]any) {
	t.Helper()
	if err := conn.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set write deadline: %v", err)
	}
	if err := conn.WriteJSON(payload); err != nil {
		t.Fatalf("write websocket json: %v", err)
	}
}

func waitForSessionEnvelope(t *testing.T, conn *gorillaws.Conn) envelope {
	t.Helper()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		message := mustReadEnvelope(t, conn)
		if message.Type == "session" && message.SessionID != "" {
			return message
		}
	}
	t.Fatal("timed out waiting for session envelope")
	return envelope{}
}

func waitForOutputContaining(t *testing.T, conn *gorillaws.Conn, want string) {
	t.Helper()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		message := mustReadEnvelope(t, conn)
		if message.Type == "output" && strings.Contains(message.Data, want) {
			return
		}
	}
	t.Fatalf("timed out waiting for output containing %q", want)
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
