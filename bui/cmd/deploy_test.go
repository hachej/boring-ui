package cmd

import (
	"strings"
	"testing"
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
