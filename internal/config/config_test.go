package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadAppliesBORINGPORTOverride(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ConfigFile)
	if err := os.WriteFile(configPath, []byte(`
[app]
name = "boring-ui"
id = "boring-ui"

[backend]
type = "go"
entry = "cmd/server"
port = 8000
routers = ["alpha", "beta"]
`), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	t.Setenv("BORING_PORT", "18125")
	t.Setenv("BORING_HOST", "127.0.0.1")

	cfg, err := Load(configPath)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.Backend.Port != 18125 {
		t.Fatalf("expected env override port 18125, got %d", cfg.Backend.Port)
	}
	if cfg.Backend.Host != "127.0.0.1" {
		t.Fatalf("expected env override host 127.0.0.1, got %q", cfg.Backend.Host)
	}
	if cfg.Backend.Type != "go" {
		t.Fatalf("expected backend type go, got %q", cfg.Backend.Type)
	}
	if len(cfg.Backend.Routers) != 2 {
		t.Fatalf("expected 2 routers, got %d", len(cfg.Backend.Routers))
	}
	if len(cfg.CORSOrigins) == 0 {
		t.Fatal("expected default CORS origins to be populated")
	}
}

func TestLoadAppliesCORSOriginsEnvOverride(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ConfigFile)
	if err := os.WriteFile(configPath, []byte("[app]\nname = \"boring-ui\"\nid = \"boring-ui\"\n"), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	t.Setenv("CORS_ORIGINS", "http://localhost:9999, https://example.com")

	cfg, err := Load(configPath)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if len(cfg.CORSOrigins) != 2 {
		t.Fatalf("expected 2 CORS origins, got %d", len(cfg.CORSOrigins))
	}
	if cfg.CORSOrigins[0] != "http://localhost:9999" || cfg.CORSOrigins[1] != "https://example.com" {
		t.Fatalf("unexpected CORS origins: %#v", cfg.CORSOrigins)
	}
}

func TestLoadDefaultsBackendTypeToGo(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ConfigFile)
	if err := os.WriteFile(configPath, []byte("[app]\nname = \"boring-ui\"\nid = \"boring-ui\"\n"), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := Load(configPath)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.Backend.Type != "go" {
		t.Fatalf("expected backend type go, got %q", cfg.Backend.Type)
	}
}

func TestLoadAppliesDefaultPTYProviders(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ConfigFile)
	if err := os.WriteFile(configPath, []byte("[app]\nname = \"boring-ui\"\nid = \"boring-ui\"\n"), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := Load(configPath)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if got := cfg.PTYProviders["shell"]; len(got) != 1 || got[0] != "bash" {
		t.Fatalf("unexpected shell provider: %#v", got)
	}
	if got := cfg.PTYProviders["claude"]; len(got) != 2 || got[0] != "claude" {
		t.Fatalf("unexpected claude provider: %#v", got)
	}
}

func TestLoadAppliesPTYClaudeOverride(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, ConfigFile)
	if err := os.WriteFile(configPath, []byte("[app]\nname = \"boring-ui\"\nid = \"boring-ui\"\n"), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	t.Setenv("BORING_UI_PTY_CLAUDE_COMMAND", "bash --noprofile --norc")

	cfg, err := Load(configPath)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	want := []string{"bash", "--noprofile", "--norc"}
	got := cfg.PTYProviders["claude"]
	if len(got) != len(want) {
		t.Fatalf("unexpected claude override length: %#v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("unexpected claude override: got %#v want %#v", got, want)
		}
	}
}
