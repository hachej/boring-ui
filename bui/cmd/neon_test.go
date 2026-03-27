package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestDefaultNeonTrustedOrigins(t *testing.T) {
	origins := defaultNeonTrustedOrigins("boring-ui")

	want := []string{
		"https://boring-ui.fly.dev",
		"http://127.0.0.1:3000",
		"http://127.0.0.1:5173",
		"http://127.0.0.1:5174",
		"http://127.0.0.1:5175",
		"http://127.0.0.1:5176",
	}

	if len(origins) != len(want) {
		t.Fatalf("expected %d trusted origins, got %d: %#v", len(want), len(origins), origins)
	}
	for idx, expected := range want {
		if origins[idx] != expected {
			t.Fatalf("origin[%d]: expected %q, got %q", idx, expected, origins[idx])
		}
	}
}

func TestNeonAuthCreatePayloadIncludesTrustedOrigins(t *testing.T) {
	origins := []string{"https://boring-ui.fly.dev", "http://127.0.0.1:5176"}
	payload := neonAuthCreatePayload(origins)

	if got := payload["auth_provider"]; got != "better_auth" {
		t.Fatalf("expected auth_provider=better_auth, got %#v", got)
	}
	gotOrigins, ok := payload["trusted_origins"].([]string)
	if !ok {
		t.Fatalf("expected []string trusted_origins, got %#v", payload["trusted_origins"])
	}
	if !slices.Equal(gotOrigins, origins) {
		t.Fatalf("expected trusted_origins %#v, got %#v", origins, gotOrigins)
	}
}

func TestNeonAuthCreatePayloadOmitsTrustedOriginsWhenEmpty(t *testing.T) {
	payload := neonAuthCreatePayload(nil)
	if got := payload["auth_provider"]; got != "better_auth" {
		t.Fatalf("expected auth_provider=better_auth, got %#v", got)
	}
	if _, exists := payload["trusted_origins"]; exists {
		t.Fatalf("expected trusted_origins to be omitted for empty input, got %#v", payload["trusted_origins"])
	}
}

func TestNeonAuthTrustedDomainPayload(t *testing.T) {
	payload := neonAuthTrustedDomainPayload("https://boring-ui.fly.dev")
	if got := payload["auth_provider"]; got != "better_auth" {
		t.Fatalf("expected auth_provider=better_auth, got %#v", got)
	}
	if got := payload["domain"]; got != "https://boring-ui.fly.dev" {
		t.Fatalf("expected full-URI domain payload, got %#v", got)
	}
}

func TestNeonIsDomainAlreadyExistsError(t *testing.T) {
	err := &neonAPIHTTPError{
		StatusCode: 400,
		Body:       `{"message":"request failed; reason:\"Domain already exists\", code:\"DOMAIN_ALREADY_EXISTS\""}`,
	}
	if !neonIsDomainAlreadyExistsError(err) {
		t.Fatalf("expected duplicate-domain error to be detected")
	}
}

func TestNeonIsDomainAlreadyExistsErrorRejectsOtherFailures(t *testing.T) {
	cases := []error{
		&neonAPIHTTPError{StatusCode: 400, Body: `{"message":"different failure"}`},
		&neonAPIHTTPError{StatusCode: 409, Body: `{"message":"DOMAIN_ALREADY_EXISTS"}`},
		fmt.Errorf("plain error"),
	}
	for _, err := range cases {
		if neonIsDomainAlreadyExistsError(err) {
			t.Fatalf("expected %v not to be treated as duplicate-domain success", err)
		}
	}
}

func TestCollectNeonSchemaFilesUsesFrameworkSchemaForChildApps(t *testing.T) {
	parent := t.TempDir()
	frameworkRoot := filepath.Join(parent, "boring-ui")
	childRoot := filepath.Join(parent, "child-app")

	mustMkdirAll := func(path string) {
		t.Helper()
		if err := os.MkdirAll(path, 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", path, err)
		}
	}
	mustWrite := func(path string) {
		t.Helper()
		if err := os.WriteFile(path, []byte("-- test\n"), 0o644); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
	}

	mustMkdirAll(filepath.Join(frameworkRoot, "internal", "db", "testdata"))
	mustMkdirAll(filepath.Join(frameworkRoot, "deploy", "sql"))
	mustMkdirAll(filepath.Join(childRoot, "deploy", "sql"))

	frameworkBase := filepath.Join(frameworkRoot, "internal", "db", "testdata", "control_plane_schema.sql")
	frameworkBootstrap := filepath.Join(frameworkRoot, "deploy", "sql", "001_hosted_control_plane_schema.sql")
	frameworkMigration := filepath.Join(frameworkRoot, "deploy", "sql", "003_user_settings.sql")
	childMigration := filepath.Join(childRoot, "deploy", "sql", "900_child.sql")
	mustWrite(frameworkBase)
	mustWrite(frameworkBootstrap)
	mustWrite(frameworkMigration)
	mustWrite(childMigration)

	got := collectNeonSchemaFiles(childRoot, frameworkRoot)
	want := []string{frameworkBootstrap, frameworkMigration, childMigration}
	if !slices.Equal(got, want) {
		t.Fatalf("expected schema files %#v, got %#v", want, got)
	}
}

func TestCollectNeonSchemaFilesUsesRepoSchemaWhenFrameworkUnavailable(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "deploy", "sql"), 0o755); err != nil {
		t.Fatalf("mkdir sql dir: %v", err)
	}
	base := filepath.Join(root, "deploy", "sql", "001_hosted_control_plane_schema.sql")
	if err := os.WriteFile(base, []byte("-- schema\n"), 0o644); err != nil {
		t.Fatalf("write schema: %v", err)
	}

	got := collectNeonSchemaFiles(root, "")
	want := []string{base}
	if !slices.Equal(got, want) {
		t.Fatalf("expected schema files %#v, got %#v", want, got)
	}
}

func TestCollectNeonSchemaFilesFallsBackToLegacySchemaWhenNoDeploySQLExists(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "internal", "db", "testdata"), 0o755); err != nil {
		t.Fatalf("mkdir schema dir: %v", err)
	}
	base := filepath.Join(root, "internal", "db", "testdata", "control_plane_schema.sql")
	if err := os.WriteFile(base, []byte("-- legacy schema\n"), 0o644); err != nil {
		t.Fatalf("write schema: %v", err)
	}

	got := collectNeonSchemaFiles(root, "")
	want := []string{base}
	if !slices.Equal(got, want) {
		t.Fatalf("expected fallback schema files %#v, got %#v", want, got)
	}
}

func TestNeonSetupNextStepsWhenEmailConfigured(t *testing.T) {
	lines := neonSetupNextSteps(true)
	if len(lines) != 3 {
		t.Fatalf("expected 3 next-step lines, got %d: %#v", len(lines), lines)
	}
	if slices.Contains(lines, "  1. Configure a custom SMTP provider in Neon Console if you need verification emails") {
		t.Fatalf("unexpected SMTP setup prompt when email is already configured: %#v", lines)
	}
}

func TestNeonSetupNextStepsWhenEmailMissing(t *testing.T) {
	lines := neonSetupNextSteps(false)
	if len(lines) != 5 {
		t.Fatalf("expected 5 next-step lines, got %d: %#v", len(lines), lines)
	}
	if !slices.Contains(lines, "     Neon Console → Settings → Auth → Custom SMTP provider") {
		t.Fatalf("expected Neon Console guidance when email is missing: %#v", lines)
	}
}

func TestUpdateTomlNeonConfigPreservesSharedDeploySecrets(t *testing.T) {
	root := t.TempDir()
	writeNeonTestConfig(t, root, `# boring.app.toml

[app]
name = "demo"
id = "demo"

[backend]
entry = "demo.app:app"

[auth]
provider = "local"

[deploy]
platform = "fly"
env = "prod"

[deploy.secrets]
ANTHROPIC_API_KEY = { vault = "secret/agent/anthropic", field = "api_key" }
RESEND_API_KEY = { vault = "secret/agent/services/resend", field = "api_key" }
`)

	auth := &neonAuthResponse{
		BaseURL: "https://auth.example",
		JWKSURL: "https://auth.example/.well-known/jwks.json",
	}
	appVaultPath := "secret/agent/app/demo/prod"
	if err := updateTomlNeonConfig(root, "project-123", appVaultPath, auth); err != nil {
		t.Fatalf("updateTomlNeonConfig returned error: %v", err)
	}

	content := readNeonTestConfig(t, root)
	if !strings.Contains(content, `provider = "neon"`) {
		t.Fatalf("expected auth provider to switch to neon:\n%s", content)
	}
	for _, expected := range []string{
		fmt.Sprintf(`%s = { vault = %q, field = %q }`, padDeploySecretName("DATABASE_URL"), "secret/agent/app/demo/prod", "database_url"),
		fmt.Sprintf(`%s = { vault = %q, field = %q }`, padDeploySecretName("BORING_UI_SESSION_SECRET"), "secret/agent/app/demo/prod", "session_secret"),
		fmt.Sprintf(`%s = { vault = %q, field = %q }`, padDeploySecretName("BORING_SETTINGS_KEY"), "secret/agent/app/demo/prod", "settings_key"),
		fmt.Sprintf(`%s = { vault = %q, field = %q }`, padDeploySecretName("ANTHROPIC_API_KEY"), "secret/agent/anthropic", "api_key"),
		fmt.Sprintf(`%s = { vault = %q, field = %q }`, padDeploySecretName("RESEND_API_KEY"), "secret/agent/services/resend", "api_key"),
	} {
		if !strings.Contains(content, expected) {
			t.Fatalf("expected config to contain %q:\n%s", expected, content)
		}
	}
	for _, unexpected := range []string{
		`field = "anthropic_api_key"`,
		`field = "resend_api_key"`,
		`GITHUB_APP_ID`,
		`GITHUB_APP_PRIVATE_KEY`,
	} {
		if strings.Contains(content, unexpected) {
			t.Fatalf("did not expect config to contain %q:\n%s", unexpected, content)
		}
	}
}

func TestResetTomlNeonConfigDropsOnlyNeonManagedSecrets(t *testing.T) {
	root := t.TempDir()
	writeNeonTestConfig(t, root, `# boring.app.toml

[app]
name = "demo"
id = "demo"

[backend]
entry = "demo.app:app"

[auth]
provider = "neon"

[deploy]
platform = "fly"
env = "prod"

[deploy.secrets]
DATABASE_URL = { vault = "secret/agent/app/demo/prod", field = "database_url" }
BORING_UI_SESSION_SECRET = { vault = "secret/agent/app/demo/prod", field = "session_secret" }
BORING_SETTINGS_KEY = { vault = "secret/agent/app/demo/prod", field = "settings_key" }
ANTHROPIC_API_KEY = { vault = "secret/agent/anthropic", field = "api_key" }
RESEND_API_KEY = { vault = "secret/agent/services/resend", field = "api_key" }

[deploy.neon]
project = "project-123"
database = "neondb"
auth_url = "https://auth.example"
jwks_url = "https://auth.example/.well-known/jwks.json"
`)

	if err := resetTomlNeonConfig(root); err != nil {
		t.Fatalf("resetTomlNeonConfig returned error: %v", err)
	}

	content := readNeonTestConfig(t, root)
	if !strings.Contains(content, `provider = "local"`) {
		t.Fatalf("expected auth provider to switch back to local:\n%s", content)
	}
	for _, expected := range []string{
		fmt.Sprintf(`%s = { vault = %q, field = %q }`, padDeploySecretName("ANTHROPIC_API_KEY"), "secret/agent/anthropic", "api_key"),
		fmt.Sprintf(`%s = { vault = %q, field = %q }`, padDeploySecretName("RESEND_API_KEY"), "secret/agent/services/resend", "api_key"),
	} {
		if !strings.Contains(content, expected) {
			t.Fatalf("expected config to preserve %q:\n%s", expected, content)
		}
	}
	for _, unexpected := range []string{
		`DATABASE_URL`,
		`BORING_UI_SESSION_SECRET`,
		`BORING_SETTINGS_KEY`,
		`project = "project-123"`,
		`auth_url = "https://auth.example"`,
	} {
		if strings.Contains(content, unexpected) {
			t.Fatalf("did not expect config to contain %q after reset:\n%s", unexpected, content)
		}
	}
}

func writeNeonTestConfig(t *testing.T, root, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, "boring.app.toml"), []byte(content), 0o644); err != nil {
		t.Fatalf("write boring.app.toml: %v", err)
	}
}

func readNeonTestConfig(t *testing.T, root string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(root, "boring.app.toml"))
	if err != nil {
		t.Fatalf("read boring.app.toml: %v", err)
	}
	return string(data)
}
