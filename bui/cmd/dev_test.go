package cmd

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/boringdata/boring-ui/bui/config"
)

func TestBuildBackendCommandGoUsesAirAndWritesConfig(t *testing.T) {
	t.Cleanup(func() { lookPath = execLookPath })
	lookPath = func(file string) (string, error) { return "/usr/bin/air", nil }

	root := t.TempDir()
	cfg := &config.AppConfig{}
	cfg.Backend.Type = "go"

	cmd, err := buildBackendCommand(root, cfg, []string{"A=B"}, 18080, "")
	if err != nil {
		t.Fatalf("buildBackendCommand returned error: %v", err)
	}
	if cmd.Path != "air" {
		t.Fatalf("expected air command, got %q", cmd.Path)
	}
	if len(cmd.Args) != 3 || cmd.Args[1] != "-c" || filepath.Base(cmd.Args[2]) != ".air.toml" {
		t.Fatalf("unexpected air args: %#v", cmd.Args)
	}
	if cmd.Dir != root {
		t.Fatalf("expected command dir %q, got %q", root, cmd.Dir)
	}

	airConfig, err := os.ReadFile(filepath.Join(root, ".air.toml"))
	if err != nil {
		t.Fatalf("read .air.toml: %v", err)
	}
	text := string(airConfig)
	if !strings.Contains(text, `cmd = "go build -o .air/server ./cmd/server"`) {
		t.Fatalf("unexpected .air.toml contents: %s", text)
	}
	if !strings.Contains(text, `entrypoint = ".air/server"`) {
		t.Fatalf("expected .air.toml entrypoint, got: %s", text)
	}
	if !strings.Contains(strings.Join(cmd.Env, "\n"), "BORING_PORT=18080") {
		t.Fatalf("expected BORING_PORT in env, got %#v", cmd.Env)
	}
}

func TestBuildBackendCommandGoUsesConfiguredEntry(t *testing.T) {
	t.Cleanup(func() { lookPath = execLookPath })
	lookPath = func(file string) (string, error) { return "/usr/bin/air", nil }

	root := t.TempDir()
	cfg := &config.AppConfig{}
	cfg.Backend.Type = "go"
	cfg.Backend.Entry = "."

	if _, err := buildBackendCommand(root, cfg, nil, 18081, ""); err != nil {
		t.Fatalf("buildBackendCommand returned error: %v", err)
	}

	airConfig, err := os.ReadFile(filepath.Join(root, ".air.toml"))
	if err != nil {
		t.Fatalf("read .air.toml: %v", err)
	}
	if !strings.Contains(string(airConfig), `cmd = "go build -o .air/server ."`) {
		t.Fatalf("expected custom go entry in .air.toml, got %s", string(airConfig))
	}
}

func TestBuildBackendCommandPythonMatchesExistingFlow(t *testing.T) {
	root := t.TempDir()
	cfg := &config.AppConfig{}

	cmd, err := buildBackendCommand(root, cfg, []string{"A=B"}, 8001, "/tmp/project/.venv/bin/python")
	if err != nil {
		t.Fatalf("buildBackendCommand returned error: %v", err)
	}
	if got := strings.Join(cmd.Args, " "); !strings.Contains(got, "uvicorn boring_ui.app_config_loader:app --reload --host 0.0.0.0 --port 8001") {
		t.Fatalf("unexpected python backend args: %s", got)
	}
	if cmd.Dir != root {
		t.Fatalf("expected command dir %q, got %q", root, cmd.Dir)
	}
}

var execLookPath = lookPath
