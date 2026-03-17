package framework

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/boringdata/boring-ui/bui/config"
)

func TestResolveFindsAncestorFrameworkForNestedChildApp(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "boring.app.toml"), []byte("[app]\nname='framework'\nid='framework'\n"), 0o644); err != nil {
		t.Fatalf("write framework config: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(root, "src", "front"), 0o755); err != nil {
		t.Fatalf("mkdir framework marker: %v", err)
	}

	child := filepath.Join(root, "examples", "child-app-go")
	if err := os.MkdirAll(child, 0o755); err != nil {
		t.Fatalf("mkdir child: %v", err)
	}
	if err := os.WriteFile(filepath.Join(child, "boring.app.toml"), []byte("[app]\nname='child'\nid='child'\n"), 0o644); err != nil {
		t.Fatalf("write child config: %v", err)
	}

	cwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	if err := os.Chdir(child); err != nil {
		t.Fatalf("chdir child: %v", err)
	}
	defer os.Chdir(cwd)

	resolved, err := Resolve(&config.AppConfig{}, "dev")
	if err != nil {
		t.Fatalf("resolve framework: %v", err)
	}
	if resolved != root {
		t.Fatalf("expected ancestor framework %q, got %q", root, resolved)
	}
}
