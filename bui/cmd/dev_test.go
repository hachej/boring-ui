package cmd

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/boringdata/boring-ui/bui/config"
	vaultpkg "github.com/boringdata/boring-ui/bui/vault"
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
	if filepath.Base(cmd.Path) != "air" {
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

func TestBuildBackendCommandPythonFactoryEntryUsesUvicornFactory(t *testing.T) {
	root := t.TempDir()
	cfg := &config.AppConfig{}
	cfg.Backend.Entry = "childapp.app:create_app"

	cmd, err := buildBackendCommand(root, cfg, nil, 8011, "/tmp/project/.venv/bin/python")
	if err != nil {
		t.Fatalf("buildBackendCommand returned error: %v", err)
	}
	got := strings.Join(cmd.Args, " ")
	if !strings.Contains(got, "uvicorn childapp.app:create_app --factory --reload --host 0.0.0.0 --port 8011") {
		t.Fatalf("expected python factory backend args, got %s", got)
	}
}

func TestBuildBackendCommandTypescriptUsesTsx(t *testing.T) {
	root := t.TempDir()
	cfg := &config.AppConfig{}
	cfg.Backend.Type = "typescript"

	cmd, err := buildBackendCommand(root, cfg, []string{"A=B"}, 8002, "")
	if err != nil {
		t.Fatalf("buildBackendCommand returned error: %v", err)
	}
	args := strings.Join(cmd.Args, " ")
	if !strings.Contains(args, "tsx watch src/server/index.ts") {
		t.Fatalf("expected tsx watch command, got %s", args)
	}
	if cmd.Dir != root {
		t.Fatalf("expected command dir %q, got %q", root, cmd.Dir)
	}
	env := strings.Join(cmd.Env, "\n")
	if !strings.Contains(env, "PORT=8002") {
		t.Fatalf("expected PORT in env, got %s", env)
	}
}

func TestBuildBackendCommandTypescriptTsAlias(t *testing.T) {
	root := t.TempDir()
	cfg := &config.AppConfig{}
	cfg.Backend.Type = "ts"

	cmd, err := buildBackendCommand(root, cfg, nil, 8003, "")
	if err != nil {
		t.Fatalf("buildBackendCommand returned error: %v", err)
	}
	args := strings.Join(cmd.Args, " ")
	if !strings.Contains(args, "tsx watch") {
		t.Fatalf("expected tsx watch for ts alias, got %s", args)
	}
}

func TestBuildBackendCommandTypescriptCustomEntry(t *testing.T) {
	root := t.TempDir()
	cfg := &config.AppConfig{}
	cfg.Backend.Type = "typescript"
	cfg.Backend.Entry = "server/main.ts"

	cmd, err := buildBackendCommand(root, cfg, nil, 8004, "")
	if err != nil {
		t.Fatalf("buildBackendCommand returned error: %v", err)
	}
	args := strings.Join(cmd.Args, " ")
	if !strings.Contains(args, "tsx watch server/main.ts") {
		t.Fatalf("expected custom entry, got %s", args)
	}
}

var execLookPath = lookPath

func TestBuildProcessEnvInjectsNeonDeployConfigForLocalParity(t *testing.T) {
	t.Cleanup(func() { resolveVaultSecrets = vaultpkg.ResolveSecrets })

	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("EXTRA_FLAG=1\n"), 0o644); err != nil {
		t.Fatalf("write .env: %v", err)
	}

	cfg := &config.AppConfig{}
	cfg.App.ID = "demo-app"
	cfg.App.Name = "Demo App"
	cfg.Auth.Provider = "neon"
	cfg.Deploy.Secrets = map[string]config.SecretRef{
		"DATABASE_URL":             {Vault: "secret/agent/app/demo/prod", Field: "database_url"},
		"BORING_UI_SESSION_SECRET": {Vault: "secret/agent/app/demo/prod", Field: "session_secret"},
	}
	cfg.Deploy.Neon.AuthURL = "https://example.neonauth.test/neondb/auth"
	cfg.Deploy.Neon.JWKSURL = "https://example.neonauth.test/neondb/auth/.well-known/jwks.json"

	resolveVaultSecrets = func(map[string]config.SecretRef) (map[string]string, []string) {
		return map[string]string{
			"DATABASE_URL":             "postgres://pooler",
			"BORING_UI_SESSION_SECRET": "session-secret",
		}, nil
	}

	env, err := buildProcessEnv(root, cfg, 5176)
	if err != nil {
		t.Fatalf("buildProcessEnv returned error: %v", err)
	}
	joined := strings.Join(env, "\n")
	for _, expected := range []string{
		"DATABASE_URL=postgres://pooler",
		"BORING_UI_SESSION_SECRET=session-secret",
		"NEON_AUTH_BASE_URL=https://example.neonauth.test/neondb/auth",
		"NEON_AUTH_JWKS_URL=https://example.neonauth.test/neondb/auth/.well-known/jwks.json",
		"BORING_UI_PUBLIC_ORIGIN=http://127.0.0.1:5176",
		"AUTH_SESSION_SECURE_COOKIE=false",
		"AUTH_APP_NAME=Demo App",
		"CONTROL_PLANE_APP_ID=demo-app",
		"EXTRA_FLAG=1",
	} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("expected env to contain %q, got %s", expected, joined)
		}
	}
}

func TestChildAppRuntimeEnvPrefersFrontendBrandingName(t *testing.T) {
	cfg := &config.AppConfig{}
	cfg.App.ID = "child-id"
	cfg.App.Name = "App Name"
	cfg.Frontend.Branding.Name = "Branded Name"

	env := childAppRuntimeEnv(cfg)
	if env["AUTH_APP_NAME"] != "Branded Name" {
		t.Fatalf("expected AUTH_APP_NAME to use frontend branding, got %#v", env)
	}
	if env["CONTROL_PLANE_APP_ID"] != "child-id" {
		t.Fatalf("expected CONTROL_PLANE_APP_ID to use app id, got %#v", env)
	}
}

func TestPreferredLocalBackendPortUsesTrustedLoopbackForNeon(t *testing.T) {
	t.Cleanup(func() { portAvailable = isLoopbackPortAvailable })
	portAvailable = func(port int) bool { return port == 5176 }

	cfg := &config.AppConfig{}
	cfg.Auth.Provider = "neon"

	port, reason := preferredLocalBackendPort(cfg, 8000)
	if port != 5176 {
		t.Fatalf("expected trusted loopback port 5176, got %d", port)
	}
	if !strings.Contains(reason, "trusted local auth port 5176") {
		t.Fatalf("expected reason to mention trusted loopback selection, got %q", reason)
	}
}

func TestPreferredLocalBackendPortRespectsExplicitNonDefaultPort(t *testing.T) {
	t.Cleanup(func() { portAvailable = isLoopbackPortAvailable })
	portAvailable = func(port int) bool { return true }

	cfg := &config.AppConfig{}
	cfg.Auth.Provider = "neon"

	port, reason := preferredLocalBackendPort(cfg, 9010)
	if port != 0 || reason != "" {
		t.Fatalf("expected explicit configured port to be preserved, got port=%d reason=%q", port, reason)
	}
}
