package cmd

import (
	"strings"
	"testing"
)

func TestDevDocsCoverAllSupportedBackendRunners(t *testing.T) {
	text := docTopics["dev"]

	for _, needle := range []string{
		"Backend runner by [backend].type:",
		"python      → uvicorn <entry> --reload",
		"typescript  → tsx watch <entry>",
		"go          → air",
		"Only backend process",
	} {
		if !strings.Contains(text, needle) {
			t.Fatalf("expected dev docs to contain %q, got:\n%s", needle, text)
		}
	}
}

func TestConfigDocsDescribeBackendTypeSpecificEntrySemantics(t *testing.T) {
	text := docTopics["config"]

	for _, needle := range []string{
		`type       "python" | "typescript" | "go"`,
		`- python: dotted ASGI target`,
		`- typescript: server entry file`,
		`- go: build target for air`,
	} {
		if !strings.Contains(text, needle) {
			t.Fatalf("expected config docs to contain %q, got:\n%s", needle, text)
		}
	}
}

func TestDevCommandHelpUsesGenericBackendOnlyLanguage(t *testing.T) {
	flag := devCmd.Flags().Lookup("backend-only")
	if flag == nil {
		t.Fatal("expected backend-only flag to exist")
	}
	if got := flag.Usage; got != "Only start backend process" {
		t.Fatalf("unexpected backend-only usage: %q", got)
	}
	if !strings.Contains(devCmd.Long, "configured backend + vite") {
		t.Fatalf("unexpected dev command long help: %q", devCmd.Long)
	}
}

func TestGitHubDocsReferenceCurrentTsRouteSurface(t *testing.T) {
	text := docTopics["github"]

	for _, needle := range []string{
		"/api/v1/github/status",
		"/api/v1/github/oauth/initiate",
		"/api/v1/github/oauth/callback",
		"/api/v1/github/installations",
		"/api/v1/github/connect",
		"/api/v1/github/repos",
		"/api/v1/github/git-credentials",
		"/api/v1/github/disconnect",
	} {
		if !strings.Contains(text, needle) {
			t.Fatalf("expected github docs to contain %q, got:\n%s", needle, text)
		}
	}

	if strings.Contains(text, "/api/v1/auth/github") {
		t.Fatalf("github docs should not reference legacy /api/v1/auth/github routes:\n%s", text)
	}
}
