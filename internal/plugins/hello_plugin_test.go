package plugins

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/boringdata/boring-ui/internal/auth"
	"github.com/gorilla/websocket"
)

func TestHelloPluginProxyHeadersWebSocketAndRestart(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not available")
	}
	if err := requirePythonModules("fastapi", "uvicorn"); err != nil {
		t.Skipf("python plugin dependencies unavailable: %v", err)
	}

	root := t.TempDir()
	pluginDir := filepath.Join(root, "kurt", "plugins", "hello")
	copyDir(t, helloPluginFixtureDir(t), pluginDir)

	manager, err := NewManager(root)
	if err != nil {
		t.Fatalf("new manager: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := manager.Start(ctx); err != nil {
		t.Fatalf("start manager: %v", err)
	}
	defer func() {
		stopCtx, stopCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer stopCancel()
		_ = manager.Stop(stopCtx)
	}()

	proxy := NewProxy(manager, WithRequestSigner(manager.Signer()))
	authManager := auth.NewSessionManager(auth.SessionConfig{Secret: "test-secret"})
	token, err := authManager.Create(auth.User{
		ID:      "worker-hello",
		Email:   "worker@example.com",
		IsOwner: true,
	})
	if err != nil {
		t.Fatalf("create session token: %v", err)
	}

	handler := auth.NewMiddleware(auth.MiddlewareConfig{SessionManager: authManager})(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		req = req.WithContext(WithWorkspaceID(req.Context(), "ws-hello"))
		proxy.ServeHTTP(w, req)
	}))

	server := httptest.NewServer(handler)
	defer server.Close()

	waitForPluginPort(t, manager, "hello", 5*time.Second)

	first := waitForHelloPing(t, server.URL, authManager.CookieName(), token, 5*time.Second)
	if first.Greeting != "hello" {
		t.Fatalf("expected greeting hello, got %#v", first)
	}
	if first.User != "worker-hello" {
		t.Fatalf("expected auth header to be forwarded, got %#v", first)
	}
	if first.Workspace != "ws-hello" {
		t.Fatalf("expected workspace header to be forwarded, got %#v", first)
	}
	if first.Auth == "" {
		t.Fatalf("expected plugin auth header to be forwarded, got %#v", first)
	}
	claims, err := manager.Signer().Verify(first.Auth, "hello")
	if err != nil {
		t.Fatalf("verify plugin auth header: %v", err)
	}
	if claims.UserID != "worker-hello" || claims.WorkspaceID != "ws-hello" {
		t.Fatalf("unexpected plugin auth claims: %#v", claims)
	}
	if first.Instance == "" {
		t.Fatalf("expected plugin instance marker, got %#v", first)
	}

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/api/x/hello/ws"
	headers := http.Header{}
	headers.Set("Cookie", (&http.Cookie{Name: authManager.CookieName(), Value: token}).String())
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, headers)
	if err != nil {
		t.Fatalf("dial hello websocket: %v", err)
	}
	defer conn.Close()

	if err := conn.WriteMessage(websocket.TextMessage, []byte("hello-ws")); err != nil {
		t.Fatalf("write websocket message: %v", err)
	}
	_, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read websocket message: %v", err)
	}
	if string(payload) != "hello-ws" {
		t.Fatalf("expected websocket echo, got %q", string(payload))
	}

	req, err := http.NewRequest(http.MethodGet, server.URL+"/api/x/hello/events", nil)
	if err != nil {
		t.Fatalf("new sse request: %v", err)
	}
	req.AddCookie(&http.Cookie{Name: authManager.CookieName(), Value: token})
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request SSE endpoint: %v", err)
	}
	defer resp.Body.Close()

	if contentType := resp.Header.Get("Content-Type"); !strings.Contains(contentType, "text/event-stream") {
		t.Fatalf("expected text/event-stream content type, got %q", contentType)
	}
	sseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read sse body: %v", err)
	}
	if string(sseBody) != "event: ping\ndata: hello\n\n" {
		t.Fatalf("unexpected sse payload %q", string(sseBody))
	}

	mainPath := filepath.Join(pluginDir, "main.py")
	data, err := os.ReadFile(mainPath)
	if err != nil {
		t.Fatalf("read hello plugin: %v", err)
	}
	if err := os.WriteFile(mainPath, append(data, []byte("\n# touch\n")...), 0o644); err != nil {
		t.Fatalf("touch hello plugin: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		_, status, body, err := fetchHelloPing(server.URL, authManager.CookieName(), token)
		if err == nil && status == http.StatusOK {
			var payload helloPingResponse
			if err := json.Unmarshal(body, &payload); err == nil && payload.Instance != first.Instance {
				return
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("expected hello plugin restart within 2s after file touch; instance stayed %q", first.Instance)
}

type helloPingResponse struct {
	Greeting  string `json:"greeting"`
	User      string `json:"user"`
	Workspace string `json:"workspace"`
	Auth      string `json:"auth"`
	Instance  string `json:"instance"`
}

func waitForHelloPing(t *testing.T, baseURL string, cookieName string, token string, timeout time.Duration) helloPingResponse {
	t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		_, status, body, err := fetchHelloPing(baseURL, cookieName, token)
		if err == nil && status == http.StatusOK {
			var response helloPingResponse
			if err := json.Unmarshal(body, &response); err == nil {
				return response
			}
		}
		time.Sleep(50 * time.Millisecond)
	}

	_, status, body, err := fetchHelloPing(baseURL, cookieName, token)
	if err != nil {
		t.Fatalf("hello request: %v", err)
	}
	t.Fatalf("expected hello proxy success, got %d body=%s", status, string(body))
	return helloPingResponse{}
}

func fetchHelloPing(baseURL string, cookieName string, token string) (helloPingResponse, int, []byte, error) {
	req, err := http.NewRequest(http.MethodGet, baseURL+"/api/x/hello/ping", nil)
	if err != nil {
		return helloPingResponse{}, 0, nil, err
	}
	req.AddCookie(&http.Cookie{Name: cookieName, Value: token})

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return helloPingResponse{}, 0, nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return helloPingResponse{}, resp.StatusCode, nil, err
	}

	var payload helloPingResponse
	if resp.StatusCode == http.StatusOK {
		if err := json.Unmarshal(body, &payload); err != nil {
			return helloPingResponse{}, resp.StatusCode, body, err
		}
	}
	return payload, resp.StatusCode, body, nil
}

func requirePythonModules(modules ...string) error {
	args := []string{"-c", "import " + strings.Join(modules, ", ")}
	cmd := exec.Command("python3", args...)
	return cmd.Run()
}

func helloPluginFixtureDir(t *testing.T) string {
	t.Helper()

	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve hello plugin test file")
	}

	return filepath.Join(filepath.Dir(file), "..", "..", "tests", "plugins", "hello")
}

func copyDir(t *testing.T, src string, dst string) {
	t.Helper()

	entries, err := os.ReadDir(src)
	if err != nil {
		t.Fatalf("read source dir %s: %v", src, err)
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", dst, err)
	}

	for _, entry := range entries {
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())
		if entry.IsDir() {
			copyDir(t, srcPath, dstPath)
			continue
		}
		data, err := os.ReadFile(srcPath)
		if err != nil {
			t.Fatalf("read %s: %v", srcPath, err)
		}
		if err := os.WriteFile(dstPath, data, 0o644); err != nil {
			t.Fatalf("write %s: %v", dstPath, err)
		}
	}
}
