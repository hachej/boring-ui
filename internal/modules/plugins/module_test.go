package plugins

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/boringdata/boring-ui/internal/app"
	"github.com/boringdata/boring-ui/internal/auth"
	"github.com/boringdata/boring-ui/internal/config"
	pluginpkg "github.com/boringdata/boring-ui/internal/plugins"
	"github.com/gorilla/websocket"
)

func TestModuleBroadcastsLifecycleEventsToThreeClients(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not available")
	}
	if err := requirePythonModules("fastapi", "uvicorn"); err != nil {
		t.Skipf("python plugin dependencies unavailable: %v", err)
	}

	root := t.TempDir()
	configPath := filepath.Join(root, "boring.app.toml")
	if err := os.WriteFile(configPath, []byte("[app]\nname = \"plugin-test\"\n"), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	firstPluginDir := filepath.Join(root, "kurt", "plugins", "echo")
	if err := os.MkdirAll(firstPluginDir, 0o755); err != nil {
		t.Fatalf("mkdir first plugin: %v", err)
	}
	writePluginFixture(t, firstPluginDir, "echo")

	module, err := NewModule(config.Config{ConfigPath: configPath})
	if err != nil {
		t.Fatalf("new plugin module: %v", err)
	}

	appInstance := app.New(config.Config{ConfigPath: configPath})
	appInstance.AddModule(module)
	if err := appInstance.Start(context.Background()); err != nil {
		t.Fatalf("start app: %v", err)
	}
	defer func() {
		stopCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = appInstance.Stop(stopCtx)
	}()

	token, err := appInstance.SessionManager().Create(auth.User{
		ID:      "plugin-user",
		Email:   "plugin@example.com",
		IsOwner: true,
	})
	if err != nil {
		t.Fatalf("create auth token: %v", err)
	}

	server := httptest.NewServer(appInstance.Handler())
	defer server.Close()

	var clients []*websocket.Conn
	for i := 0; i < 3; i++ {
		headers := http.Header{}
		headers.Set("Cookie", (&http.Cookie{
			Name:  appInstance.SessionManager().CookieName(),
			Value: token,
		}).String())
		conn, _, err := websocket.DefaultDialer.Dial("ws"+server.URL[len("http"):]+wsPath, headers)
		if err != nil {
			t.Fatalf("dial client %d: %v", i, err)
		}
		clients = append(clients, conn)
		defer conn.Close()
	}

	mainPath := filepath.Join(firstPluginDir, "main.py")
	data, err := os.ReadFile(mainPath)
	if err != nil {
		t.Fatalf("read first plugin main: %v", err)
	}
	start := time.Now()
	if err := os.WriteFile(mainPath, append(data, []byte("\n# restart\n")...), 0o644); err != nil {
		t.Fatalf("touch first plugin main: %v", err)
	}

	secondPluginDir := filepath.Join(root, "kurt", "plugins", "beta")
	if err := os.MkdirAll(secondPluginDir, 0o755); err != nil {
		t.Fatalf("mkdir second plugin: %v", err)
	}
	writePluginFixture(t, secondPluginDir, "beta")

	for idx, conn := range clients {
		got := readPluginEvents(t, conn, 2)
		if got[0].Type != pluginpkg.MessageTypePluginChanged || got[1].Type != pluginpkg.MessageTypePluginChanged {
			t.Fatalf("client %d expected plugin_changed envelopes, got %#v", idx, got)
		}
		if got[0].Event != pluginpkg.LifecycleEventRestart || got[0].Plugin != "echo" {
			t.Fatalf("client %d expected first event restart for echo, got %#v", idx, got)
		}
		if got[1].Event != pluginpkg.LifecycleEventAdd || got[1].Plugin != "beta" {
			t.Fatalf("client %d expected second event add for beta, got %#v", idx, got)
		}
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("expected restart+add lifecycle events within 1s, got %s", elapsed)
	}
}

func writePluginFixture(t *testing.T, dir string, name string) {
	t.Helper()

	server := `import os
from fastapi import FastAPI
import uvicorn

app = FastAPI()


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/ping")
async def ping():
    return {"plugin": os.environ.get("BORING_PLUGIN_NAME")}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ["PORT"]), log_level="warning")
`
	if err := os.WriteFile(filepath.Join(dir, "main.py"), []byte(server), 0o755); err != nil {
		t.Fatalf("write plugin server: %v", err)
	}
	manifest := "name = \"" + name + "\"\ncommand = [\"python3\", \"-u\", \"main.py\"]\nwatch = [\"main.py\"]\n"
	if err := os.WriteFile(filepath.Join(dir, "plugin.toml"), []byte(manifest), 0o644); err != nil {
		t.Fatalf("write plugin manifest: %v", err)
	}
}

func readPluginEvents(t *testing.T, conn *websocket.Conn, total int) []pluginpkg.LifecycleEvent {
	t.Helper()

	events := make([]pluginpkg.LifecycleEvent, 0, total)
	if err := conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	for len(events) < total {
		_, payload, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("read plugin event: %v", err)
		}
		var event pluginpkg.LifecycleEvent
		if err := json.Unmarshal(payload, &event); err != nil {
			t.Fatalf("decode plugin event: %v", err)
		}
		events = append(events, event)
	}
	return events
}

func requirePythonModules(modules ...string) error {
	args := []string{"-c", "import " + strings.Join(modules, ", ")}
	cmd := exec.Command("python3", args...)
	return cmd.Run()
}
