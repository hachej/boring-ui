package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadDefaultsBackendTypeToGo(t *testing.T) {
	root := t.TempDir()
	configPath := filepath.Join(root, ConfigFile)
	if err := os.WriteFile(configPath, []byte("[app]\nname='demo'\n"), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.Backend.Type != "go" {
		t.Fatalf("expected backend.type=go, got %q", cfg.Backend.Type)
	}
}
