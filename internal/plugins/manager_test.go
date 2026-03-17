package plugins

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/boringdata/boring-ui/internal/auth"
)

func TestPortAllocatorReusesReleasedPortsFirst(t *testing.T) {
	allocator := NewPortAllocator()
	listener, reservedPort := reservePluginTestPort(t)
	defer listener.Close()
	allocator.minPort = reservedPort
	allocator.nextPort = reservedPort

	first, err := allocator.Acquire("alpha")
	if err != nil {
		t.Fatalf("acquire alpha: %v", err)
	}
	if first != reservedPort+1 {
		t.Fatalf("expected allocator to skip busy %d and choose %d, got %d", reservedPort, reservedPort+1, first)
	}

	second, err := allocator.Acquire("beta")
	if err != nil {
		t.Fatalf("acquire beta: %v", err)
	}
	if second != reservedPort+2 {
		t.Fatalf("expected second port %d, got %d", reservedPort+2, second)
	}

	allocator.Release("alpha")
	reused, err := allocator.Acquire("gamma")
	if err != nil {
		t.Fatalf("acquire gamma: %v", err)
	}
	if reused != reservedPort+1 {
		t.Fatalf("expected released port %d to be reused first, got %d", reservedPort+1, reused)
	}
}

func TestPortAllocatorConcurrentAcquireIsThreadSafe(t *testing.T) {
	allocator := NewPortAllocator()

	const total = 24
	type result struct {
		port int
		err  error
	}

	results := make(chan result, total)
	var wg sync.WaitGroup
	for i := 0; i < total; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			port, err := allocator.Acquire(fmt.Sprintf("worker-%d", i))
			results <- result{port: port, err: err}
		}(i)
	}
	wg.Wait()
	close(results)

	seen := map[int]struct{}{}
	for result := range results {
		if result.err != nil {
			t.Fatalf("concurrent acquire failed: %v", result.err)
		}
		if result.port < 19000 || result.port > 19999 {
			t.Fatalf("expected port in plugin range, got %d", result.port)
		}
		if _, exists := seen[result.port]; exists {
			t.Fatalf("expected unique allocated port, got duplicate %d", result.port)
		}
		seen[result.port] = struct{}{}
	}
}

func TestSupervisorGivesUpAfterFiveConsecutiveFailures(t *testing.T) {
	supervisor := NewSupervisor(SupervisorConfig{
		Name:           "crashy",
		Command:        []string{"sh", "-c", "exit 1"},
		Dir:            t.TempDir(),
		Allocator:      NewPortAllocator(),
		BackoffBase:    20 * time.Millisecond,
		BackoffCap:     40 * time.Millisecond,
		StopTimeout:    200 * time.Millisecond,
		StartupTimeout: 20 * time.Millisecond,
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := supervisor.Start(ctx); err != nil {
		t.Fatalf("start supervisor: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if err := supervisor.LastError(); err != nil && strings.Contains(err.Error(), "too many times") {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("expected supervisor to give up after consecutive failures, last_err=%v", supervisor.LastError())
}

func TestSupervisorStopKillsHungProcessAfterTimeout(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatalf("resolve test executable: %v", err)
	}

	supervisor := NewSupervisor(SupervisorConfig{
		Name:           "hung-helper",
		Command:        []string{exe, "-test.run=TestPluginHelperProcess", "--"},
		Dir:            t.TempDir(),
		Allocator:      NewPortAllocator(),
		Env:            map[string]string{"GO_WANT_PLUGIN_HELPER": "1", "PLUGIN_HELPER_MODE": "listen-ignore-term"},
		BackoffBase:    20 * time.Millisecond,
		BackoffCap:     40 * time.Millisecond,
		StopTimeout:    50 * time.Millisecond,
		StartupTimeout: time.Second,
		HealthRetries:  -1,
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := supervisor.Start(ctx); err != nil {
		t.Fatalf("start supervisor: %v", err)
	}

	waitForSupervisorPort(t, supervisor, time.Second)

	start := time.Now()
	stopCtx, stopCancel := context.WithTimeout(context.Background(), time.Second)
	defer stopCancel()
	if err := supervisor.Stop(stopCtx); err != nil {
		t.Fatalf("stop supervisor: %v", err)
	}

	elapsed := time.Since(start)
	if elapsed < 40*time.Millisecond {
		t.Fatalf("expected stop to wait for SIGTERM timeout before kill, got %s", elapsed)
	}
	if elapsed > 750*time.Millisecond {
		t.Fatalf("expected hung process to be killed promptly, got %s", elapsed)
	}
	if supervisor.CurrentPort() != 0 {
		t.Fatalf("expected supervisor port to be cleared after stop, got %d", supervisor.CurrentPort())
	}
}

func TestWaitForHealthRetriesThreeTimes(t *testing.T) {
	var (
		mu       sync.Mutex
		attempts int
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		mu.Lock()
		attempts++
		current := attempts
		mu.Unlock()

		if req.URL.Path != "/health" {
			t.Fatalf("expected /health probe, got %s", req.URL.Path)
		}
		if current < 3 {
			http.Error(w, "warming up", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	port := server.Listener.Addr().(*net.TCPAddr).Port
	if ok := waitForHealth(port, "/health", 3, time.Second); !ok {
		t.Fatal("expected health probe to succeed on the third retry")
	}

	mu.Lock()
	defer mu.Unlock()
	if attempts != 3 {
		t.Fatalf("expected exactly three health probes, got %d", attempts)
	}
}

func TestProxyForwardsRequestsHeadersAndRestartsOnTouch(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not available")
	}

	root := t.TempDir()
	pluginDir := filepath.Join(root, "kurt", "plugins", "echo")
	if err := os.MkdirAll(pluginDir, 0o755); err != nil {
		t.Fatalf("mkdir plugin dir: %v", err)
	}

	counterFile := filepath.Join(pluginDir, "starts.txt")
	serverFile := filepath.Join(pluginDir, "server.py")
	manifestFile := filepath.Join(pluginDir, "plugin.toml")

	server := `import http.server, json, os, socketserver
PORT = int(os.environ["PORT"])
COUNT_FILE = os.environ["COUNT_FILE"]
with open(COUNT_FILE, "a", encoding="utf-8") as fh:
    fh.write("start\n")

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.end_headers()
            return
        payload = json.dumps({
            "path": self.path,
            "user": self.headers.get("X-Boring-User-ID"),
            "workspace": self.headers.get("X-Boring-Workspace-ID"),
            "auth": self.headers.get("X-Boring-Auth"),
            "upgrade": self.headers.get("Connection"),
        }).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):
        return

class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

with ReusableTCPServer(("127.0.0.1", PORT), Handler) as httpd:
    httpd.serve_forever()
`
	if err := os.WriteFile(serverFile, []byte(server), 0o755); err != nil {
		t.Fatalf("write server script: %v", err)
	}

	manifest := fmt.Sprintf(`name = "echo"
command = ["python3", "-u", "server.py"]
watch = ["server.py"]

[env]
COUNT_FILE = %q
`, counterFile)
	if err := os.WriteFile(manifestFile, []byte(manifest), 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

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
	managerAuth := auth.NewSessionManager(auth.SessionConfig{Secret: "test-secret"})
	token, err := managerAuth.Create(auth.User{
		ID:      "worker-1",
		Email:   "worker@example.com",
		IsOwner: true,
	})
	if err != nil {
		t.Fatalf("create session token: %v", err)
	}
	handler := auth.NewMiddleware(auth.MiddlewareConfig{SessionManager: managerAuth})(proxy)

	waitForStarts(t, counterFile, 1, 5*time.Second)
	waitForPluginPort(t, manager, "echo", 5*time.Second)

	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/x/echo/ping/%d", i), nil)
		req.AddCookie(&http.Cookie{Name: managerAuth.CookieName(), Value: token})
		req = req.WithContext(WithWorkspaceID(req.Context(), "ws-123"))
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected proxy success, got %d body=%s", rec.Code, rec.Body.String())
		}
		var payload map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode proxied response: %v", err)
		}
		if payload["user"] != "worker-1" || payload["workspace"] != "ws-123" {
			t.Fatalf("expected auth/workspace headers in proxied response, got %#v", payload)
		}
		authHeader, _ := payload["auth"].(string)
		claims, err := manager.Signer().Verify(authHeader, "echo")
		if err != nil {
			t.Fatalf("verify plugin auth header: %v", err)
		}
		if claims.UserID != "worker-1" || claims.WorkspaceID != "ws-123" || claims.Plugin != "echo" {
			t.Fatalf("unexpected plugin auth claims: %#v", claims)
		}
	}

	if err := os.WriteFile(serverFile, append([]byte(server), []byte("\n# touch\n")...), 0o755); err != nil {
		t.Fatalf("touch server file: %v", err)
	}
	waitForStarts(t, counterFile, 2, 2*time.Second)
	waitForPluginPort(t, manager, "echo", 2*time.Second)
}

func TestProxyForwardsUpgradeHeaders(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.Header.Get(HeaderAuth) == "" {
			t.Fatal("expected X-Boring-Auth header on upgrade request")
		}
		if !strings.Contains(strings.ToLower(req.Header.Get("Connection")), "upgrade") {
			t.Fatalf("expected Connection: upgrade to reach upstream, got %q", req.Header.Get("Connection"))
		}
		if req.Header.Get("Upgrade") != "websocket" {
			t.Fatalf("expected Upgrade websocket, got %q", req.Header.Get("Upgrade"))
		}
		_, _ = w.Write([]byte("upgrade-ok"))
	}))
	defer upstream.Close()

	port := upstream.Listener.Addr().(*net.TCPAddr).Port
	proxy := NewProxy(staticPorts{"demo": port}, WithRequestSigner(NewRequestSigner("test-plugin-secret")))
	server := httptest.NewServer(proxy)
	defer server.Close()

	req, err := http.NewRequest(http.MethodGet, server.URL+"/api/x/demo/ws", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("proxy request: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read response body: %v", err)
	}
	if resp.StatusCode != http.StatusOK || string(body) != "upgrade-ok" {
		t.Fatalf("expected forwarded upgrade headers with OK response, got status=%d body=%s", resp.StatusCode, string(body))
	}
}

func TestProxyPreservesHTTPMethodsBodyAndQuery(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		body, err := io.ReadAll(req.Body)
		if err != nil {
			t.Fatalf("read upstream body: %v", err)
		}
		_ = req.Body.Close()

		payload, err := json.Marshal(map[string]string{
			"method": req.Method,
			"path":   req.URL.Path,
			"query":  req.URL.RawQuery,
			"body":   string(body),
		})
		if err != nil {
			t.Fatalf("marshal response payload: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(payload)
	}))
	defer upstream.Close()

	port := upstream.Listener.Addr().(*net.TCPAddr).Port
	proxy := NewProxy(staticPorts{"demo": port}, WithRequestSigner(NewRequestSigner("test-plugin-secret")))
	server := httptest.NewServer(proxy)
	defer server.Close()

	cases := []struct {
		method string
		body   string
	}{
		{method: http.MethodGet},
		{method: http.MethodPost, body: `{"kind":"create"}`},
		{method: http.MethodPut, body: `{"kind":"replace"}`},
		{method: http.MethodPatch, body: `{"kind":"patch"}`},
		{method: http.MethodDelete},
	}

	for _, tc := range cases {
		t.Run(tc.method, func(t *testing.T) {
			var body io.Reader
			if tc.body != "" {
				body = strings.NewReader(tc.body)
			}
			req, err := http.NewRequest(tc.method, server.URL+"/api/x/demo/resource?id=123", body)
			if err != nil {
				t.Fatalf("new request: %v", err)
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("proxy request: %v", err)
			}
			defer resp.Body.Close()

			data, err := io.ReadAll(resp.Body)
			if err != nil {
				t.Fatalf("read response body: %v", err)
			}
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("expected HTTP 200, got %d body=%s", resp.StatusCode, string(data))
			}

			var payload map[string]string
			if err := json.Unmarshal(data, &payload); err != nil {
				t.Fatalf("decode response payload: %v", err)
			}
			if payload["method"] != tc.method {
				t.Fatalf("expected method %s, got %#v", tc.method, payload)
			}
			if payload["path"] != "/resource" || payload["query"] != "id=123" {
				t.Fatalf("expected path/query to survive proxying, got %#v", payload)
			}
			if payload["body"] != tc.body {
				t.Fatalf("expected body %q, got %#v", tc.body, payload)
			}
		})
	}
}

func TestDiscoverSkipsInvalidManifest(t *testing.T) {
	root := t.TempDir()
	goodDir := filepath.Join(root, "kurt", "plugins", "good")
	badDir := filepath.Join(root, "kurt", "plugins", "bad")
	for _, dir := range []string{goodDir, badDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", dir, err)
		}
	}

	if err := os.WriteFile(filepath.Join(goodDir, "plugin.toml"), []byte("name = \"good\"\ncommand = [\"sh\", \"-c\", \"exit 0\"]\n"), 0o644); err != nil {
		t.Fatalf("write good manifest: %v", err)
	}
	if err := os.WriteFile(filepath.Join(badDir, "plugin.toml"), []byte("name = ["), 0o644); err != nil {
		t.Fatalf("write bad manifest: %v", err)
	}

	specs, err := Discover(root)
	if err != nil {
		t.Fatalf("discover plugins: %v", err)
	}
	if len(specs) != 1 || specs[0].Name != "good" {
		t.Fatalf("expected only valid plugin to be discovered, got %#v", specs)
	}
}

func TestWatcherRestartsOnNestedFileChange(t *testing.T) {
	root := t.TempDir()
	nestedDir := filepath.Join(root, "nested")
	if err := os.MkdirAll(nestedDir, 0o755); err != nil {
		t.Fatalf("mkdir nested dir: %v", err)
	}
	nestedFile := filepath.Join(nestedDir, "watch.txt")
	if err := os.WriteFile(nestedFile, []byte("v1"), 0o644); err != nil {
		t.Fatalf("write nested file: %v", err)
	}

	changes := make(chan string, 1)
	watcher, err := NewWatcher(50*time.Millisecond, func(name string) {
		select {
		case changes <- name:
		default:
		}
	})
	if err != nil {
		t.Fatalf("new watcher: %v", err)
	}

	if err := watcher.Add("demo", []string{root}); err != nil {
		t.Fatalf("add watcher target: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_ = watcher.Run(ctx)
	}()
	defer func() {
		_ = watcher.Close()
	}()

	if err := os.WriteFile(nestedFile, []byte("v2"), 0o644); err != nil {
		t.Fatalf("update nested file: %v", err)
	}

	select {
	case name := <-changes:
		if name != "demo" {
			t.Fatalf("expected demo restart callback, got %q", name)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("expected nested file change to trigger watcher callback")
	}
}

func TestPluginHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_PLUGIN_HELPER") != "1" {
		return
	}

	switch os.Getenv("PLUGIN_HELPER_MODE") {
	case "listen-ignore-term":
		runListenIgnoreTermHelper()
	default:
		os.Exit(2)
	}
}

type staticPorts map[string]int

func (s staticPorts) Port(name string) (int, bool) {
	port, ok := s[name]
	return port, ok
}

func waitForStarts(t *testing.T, path string, want int, timeout time.Duration) {
	t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(path)
		if err == nil && strings.Count(string(data), "start") >= want {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	data, _ := os.ReadFile(path)
	t.Fatalf("expected %d starts in %s, got %q", want, path, string(data))
}

func waitForPluginPort(t *testing.T, manager *Manager, name string, timeout time.Duration) {
	t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if port, ok := manager.Port(name); ok && port != 0 {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	port, ok := manager.Port(name)
	t.Fatalf("expected plugin %s port to become ready, got port=%d ok=%v", name, port, ok)
}

func waitForSupervisorPort(t *testing.T, supervisor *Supervisor, timeout time.Duration) {
	t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if supervisor.CurrentPort() != 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for supervisor port")
}

func runListenIgnoreTermHelper() {
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		os.Exit(2)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		os.Exit(3)
	}
	defer listener.Close()

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGTERM)
	defer signal.Stop(signals)

	go func() {
		for range signals {
		}
	}()

	for {
		conn, err := listener.Accept()
		if err != nil {
			os.Exit(0)
		}
		go func(conn net.Conn) {
			defer conn.Close()
			_, _ = bufio.NewReader(conn).Peek(1)
		}(conn)
	}
}

func reservePluginTestPort(t *testing.T) (net.Listener, int) {
	t.Helper()

	for port := defaultMinPort; port < defaultMaxPort; port++ {
		listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err == nil {
			return listener, port
		}
	}

	t.Fatal("no free port available in plugin allocator range")
	return nil, 0
}
