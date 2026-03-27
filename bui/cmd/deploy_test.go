package cmd

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/boringdata/boring-ui/bui/config"
)

func TestBuildDockerImageRefUsesLatestForProd(t *testing.T) {
	got := buildDockerImageRef("ghcr.io/hachej", "boring-ui", "prod")
	if got != "ghcr.io/hachej/boring-ui:latest" {
		t.Fatalf("expected latest tag, got %q", got)
	}
}

func TestBuildDockerImageRefUsesEnvForNonProd(t *testing.T) {
	got := buildDockerImageRef("ghcr.io/hachej/", "boring-ui", "staging")
	if got != "ghcr.io/hachej/boring-ui:staging" {
		t.Fatalf("expected staging tag, got %q", got)
	}
}

func TestRenderEnvFileEscapesMultilineSecrets(t *testing.T) {
	rendered := renderEnvFile(map[string]string{
		"GITHUB_APP_PRIVATE_KEY": "line-1\nline-2",
		"DATABASE_URL":           "postgres://example",
	})

	if !strings.Contains(rendered, "GITHUB_APP_PRIVATE_KEY=line-1\\nline-2\n") {
		t.Fatalf("expected escaped multiline key, got %q", rendered)
	}
	if !strings.Contains(rendered, "DATABASE_URL=postgres://example\n") {
		t.Fatalf("expected database url line, got %q", rendered)
	}
}

func TestShellEnvPrefixSortsAndQuotesValues(t *testing.T) {
	got := shellEnvPrefix(map[string]string{
		"BUI_HOSTNAME": "example.com",
		"EMPTY":        "",
		"QUOTE":        "can't-break",
	})

	if strings.Contains(got, "EMPTY=") {
		t.Fatalf("expected empty values to be omitted, got %q", got)
	}
	if !strings.Contains(got, "BUI_HOSTNAME='example.com' ") {
		t.Fatalf("expected quoted hostname, got %q", got)
	}
	if !strings.Contains(got, "QUOTE='can'\"'\"'t-break' ") {
		t.Fatalf("expected shell-escaped quote, got %q", got)
	}
}

func TestEnsureFlyAppExistsSkipsCreateWhenStatusSucceeds(t *testing.T) {
	flyBin, logPath := writeFakeFlyScript(t)
	t.Setenv("FAKE_FLY_LOG", logPath)
	t.Setenv("FAKE_FLY_STATUS_EXIT", "0")
	t.Setenv("FAKE_FLY_CREATE_EXIT", "0")

	if err := ensureFlyAppExists(flyBin, "demo-app", ""); err != nil {
		t.Fatalf("ensureFlyAppExists returned error: %v", err)
	}

	calls := readFlyLog(t, logPath)
	if len(calls) != 1 {
		t.Fatalf("expected one fly command, got %v", calls)
	}
	if calls[0] != "status --app demo-app" {
		t.Fatalf("expected status check only, got %v", calls)
	}
}

func TestEnsureFlyAppExistsCreatesMissingApp(t *testing.T) {
	flyBin, logPath := writeFakeFlyScript(t)
	t.Setenv("FAKE_FLY_LOG", logPath)
	t.Setenv("FAKE_FLY_STATUS_EXIT", "1")
	t.Setenv("FAKE_FLY_CREATE_EXIT", "0")

	if err := ensureFlyAppExists(flyBin, "demo-app", "acme"); err != nil {
		t.Fatalf("ensureFlyAppExists returned error: %v", err)
	}

	calls := readFlyLog(t, logPath)
	if len(calls) != 2 {
		t.Fatalf("expected status + create calls, got %v", calls)
	}
	if calls[0] != "status --app demo-app" {
		t.Fatalf("expected status command first, got %v", calls)
	}
	if calls[1] != "apps create demo-app --org acme" {
		t.Fatalf("expected create command with org, got %v", calls)
	}
}

func TestEnsureFlyAppExistsReturnsCreateFailure(t *testing.T) {
	flyBin, logPath := writeFakeFlyScript(t)
	t.Setenv("FAKE_FLY_LOG", logPath)
	t.Setenv("FAKE_FLY_STATUS_EXIT", "1")
	t.Setenv("FAKE_FLY_CREATE_EXIT", "2")

	err := ensureFlyAppExists(flyBin, "demo-app", "")
	if err == nil {
		t.Fatalf("expected create failure")
	}
	if !strings.Contains(err.Error(), "fly apps create") {
		t.Fatalf("expected fly apps create error, got %v", err)
	}
}

func TestFindFlyBinaryResolvesFlyctlBinCommandName(t *testing.T) {
	dir := t.TempDir()
	flyBin, _ := writeFakeFlyScript(t)
	commandPath := filepath.Join(dir, "fly")
	if err := os.WriteFile(commandPath, mustReadFile(t, flyBin), 0o755); err != nil {
		t.Fatalf("write fly command: %v", err)
	}

	t.Setenv("PATH", dir)
	t.Setenv("FLYCTL_BIN", "fly")

	got, err := findFlyBinary()
	if err != nil {
		t.Fatalf("findFlyBinary returned error: %v", err)
	}
	if got != commandPath {
		t.Fatalf("expected command from PATH, got %q", got)
	}
}

func TestFindFlyBinaryFallsBackToHomeInstall(t *testing.T) {
	home := t.TempDir()
	flyDir := filepath.Join(home, ".fly", "bin")
	if err := os.MkdirAll(flyDir, 0o755); err != nil {
		t.Fatalf("mkdir fly dir: %v", err)
	}
	flyPath := filepath.Join(flyDir, "fly")
	if err := os.WriteFile(flyPath, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatalf("write fly binary: %v", err)
	}

	t.Setenv("HOME", home)
	t.Setenv("PATH", "")
	t.Setenv("FLYCTL_BIN", "")

	got, err := findFlyBinary()
	if err != nil {
		t.Fatalf("findFlyBinary returned error: %v", err)
	}
	if got != flyPath {
		t.Fatalf("expected home-installed fly path, got %q", got)
	}
}

func TestShouldRetryFlyDeployWithoutDepotRecognizesDepotHandshakeFailure(t *testing.T) {
	output := `
Waiting for depot builder...
==> Building image with Depot
Error: failed to fetch an image or build from source: error building: failed to get status: rpc error: code = Unavailable desc = connection error: desc = "transport: authentication handshake failed: EOF"
`
	if !shouldRetryFlyDeployWithoutDepot(output) {
		t.Fatalf("expected depot handshake failure to trigger non-depot retry")
	}
}

func TestShouldRetryFlyDeployWithoutDepotIgnoresNonDepotFailures(t *testing.T) {
	output := `Error: app not found`
	if shouldRetryFlyDeployWithoutDepot(output) {
		t.Fatalf("expected generic fly failure not to trigger non-depot retry")
	}
}

func TestChildAppRuntimeEnvFallsBackToAppName(t *testing.T) {
	cfg := &config.AppConfig{}
	cfg.App.ID = "child-id"
	cfg.App.Name = "Child App"

	env := childAppRuntimeEnv(cfg)
	if env["AUTH_APP_NAME"] != "Child App" {
		t.Fatalf("expected AUTH_APP_NAME to fall back to app name, got %#v", env)
	}
	if env["CONTROL_PLANE_APP_ID"] != "child-id" {
		t.Fatalf("expected CONTROL_PLANE_APP_ID to equal app id, got %#v", env)
	}
}

func TestApplyNeonFallbackSecretsUsesEnvFile(t *testing.T) {
	root := t.TempDir()
	boringDir := filepath.Join(root, ".boring")
	if err := os.MkdirAll(boringDir, 0o700); err != nil {
		t.Fatalf("mkdir .boring: %v", err)
	}
	envFile := filepath.Join(boringDir, "neon-config.env")
	envContent := strings.Join([]string{
		"DATABASE_POOLER_URL=postgres://pooler",
		"BORING_UI_SESSION_SECRET=session-from-file",
		"BORING_SETTINGS_KEY=settings-from-file",
		"NEON_PROJECT_ID=project-123",
		"",
	}, "\n")
	if err := os.WriteFile(envFile, []byte(envContent), 0o600); err != nil {
		t.Fatalf("write neon-config.env: %v", err)
	}

	resolved := map[string]string{}
	refs := map[string]config.SecretRef{
		"DATABASE_URL":             {Field: "database_url"},
		"BORING_UI_SESSION_SECRET": {Field: "session_secret"},
		"BORING_SETTINGS_KEY":      {Field: "settings_key"},
		"NEON_PROJECT_ID":          {Field: "neon_project_id"},
	}

	fallbackSources, failed, err := applyNeonFallbackSecrets(
		root,
		refs,
		resolved,
		[]string{"DATABASE_URL", "BORING_UI_SESSION_SECRET", "BORING_SETTINGS_KEY", "NEON_PROJECT_ID"},
	)
	if err != nil {
		t.Fatalf("applyNeonFallbackSecrets returned error: %v", err)
	}
	if len(failed) != 0 {
		t.Fatalf("expected no failed secrets, got %v", failed)
	}
	if got := resolved["DATABASE_URL"]; got != "postgres://pooler" {
		t.Fatalf("expected pooler URL fallback, got %q", got)
	}
	if got := resolved["BORING_UI_SESSION_SECRET"]; got != "session-from-file" {
		t.Fatalf("expected session secret fallback, got %q", got)
	}
	if got := resolved["BORING_SETTINGS_KEY"]; got != "settings-from-file" {
		t.Fatalf("expected settings key fallback, got %q", got)
	}
	if got := fallbackSources["DATABASE_URL"]; got != ".boring/neon-config.env:DATABASE_POOLER_URL" {
		t.Fatalf("expected DATABASE_URL fallback source, got %q", got)
	}
}

func TestApplyNeonFallbackSecretsCreatesSettingsKeyFile(t *testing.T) {
	root := t.TempDir()
	resolved := map[string]string{}
	refs := map[string]config.SecretRef{
		"BORING_SETTINGS_KEY": {Field: "settings_key"},
	}

	fallbackSources, failed, err := applyNeonFallbackSecrets(root, refs, resolved, []string{"BORING_SETTINGS_KEY"})
	if err != nil {
		t.Fatalf("applyNeonFallbackSecrets returned error: %v", err)
	}
	if len(failed) != 0 {
		t.Fatalf("expected no failed secrets, got %v", failed)
	}
	if got := fallbackSources["BORING_SETTINGS_KEY"]; got != ".boring/settings-key" {
		t.Fatalf("expected settings key file fallback, got %q", got)
	}
	if resolved["BORING_SETTINGS_KEY"] == "" {
		t.Fatalf("expected settings key fallback value")
	}
	keyFile := filepath.Join(root, ".boring", "settings-key")
	data, err := os.ReadFile(keyFile)
	if err != nil {
		t.Fatalf("read settings-key: %v", err)
	}
	if strings.TrimSpace(string(data)) != resolved["BORING_SETTINGS_KEY"] {
		t.Fatalf("expected persisted settings key to match resolved value")
	}
}

func writeFakeFlyScript(t *testing.T) (string, string) {
	t.Helper()

	dir := t.TempDir()
	logPath := filepath.Join(dir, "fly.log")
	scriptPath := filepath.Join(dir, "fake-fly.sh")
	script := `#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_FLY_LOG"
case "$1" in
  status)
    exit "${FAKE_FLY_STATUS_EXIT:-0}"
    ;;
  apps)
    if [ "$2" = "create" ]; then
      exit "${FAKE_FLY_CREATE_EXIT:-0}"
    fi
    ;;
esac
exit 0
`
	if err := os.WriteFile(scriptPath, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake fly script: %v", err)
	}

	return scriptPath, logPath
}

func mustReadFile(t *testing.T, path string) []byte {
	t.Helper()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read file %s: %v", path, err)
	}
	return data
}

func readFlyLog(t *testing.T, path string) []string {
	t.Helper()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fly log: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) == 1 && lines[0] == "" {
		return nil
	}
	return lines
}
