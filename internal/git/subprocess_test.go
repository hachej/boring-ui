package git

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCreateAskpassScriptEscapesShellMetacharacters(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path, err := createAskpassScript(dir, &GitCredentials{
		Username: "x-access-token",
		Password: "$(echo INJECTED)",
	})
	if err != nil {
		t.Fatalf("create askpass script: %v", err)
	}
	defer cleanupAskpass(path)

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat askpass script: %v", err)
	}
	if perms := info.Mode().Perm(); perms != 0o700 {
		t.Fatalf("expected askpass mode 0700, got %o", perms)
	}

	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read askpass script: %v", err)
	}
	if !strings.Contains(string(content), "'$(echo INJECTED)'") {
		t.Fatalf("expected shell-quoted password in script, got %s", string(content))
	}

	out, err := exec.Command("sh", path, "Password for ...").CombinedOutput()
	if err != nil {
		t.Fatalf("execute askpass script: %v output=%s", err, string(out))
	}
	if got := strings.TrimSpace(string(out)); got != "$(echo INJECTED)" {
		t.Fatalf("expected literal password output, got %q", got)
	}
}

func TestCreateAskpassScriptEscapesDoubleQuotes(t *testing.T) {
	t.Parallel()

	path, err := createAskpassScript(t.TempDir(), &GitCredentials{
		Username: "user",
		Password: `pass"word`,
	})
	if err != nil {
		t.Fatalf("create askpass script: %v", err)
	}
	defer cleanupAskpass(path)

	out, err := exec.Command("sh", path, "Password for ...").CombinedOutput()
	if err != nil {
		t.Fatalf("execute askpass script: %v output=%s", err, string(out))
	}
	if got := strings.TrimSpace(string(out)); got != `pass"word` {
		t.Fatalf("expected literal password output, got %q", got)
	}
}

func TestSanitizeGitOutputStripsCredentialVectors(t *testing.T) {
	t.Parallel()

	cases := []string{
		"https://user:pass@github.com/org/repo.git",
		"https://x-access-token:ghs_secret123@github.com/org/repo.git",
		"fatal: token ghp_secret987 expired",
		"fatal: token ghs_secret654 expired",
		"Authorization: Bearer abc.def.ghi",
		"Bearer topsecret",
		"https://user@github.com/org/repo.git",
		"github_pat_1234567890abcdef",
		"multiple ghp_secret and ghs_secret values",
		"mix https://user:pass@github.com with Bearer secret",
	}

	for _, raw := range cases {
		sanitized := sanitizeGitOutput(raw)
		if strings.Contains(sanitized, "ghp_") || strings.Contains(sanitized, "ghs_") || strings.Contains(sanitized, "github_pat_") {
			t.Fatalf("expected token redaction for %q, got %q", raw, sanitized)
		}
		if strings.Contains(strings.ToLower(sanitized), "bearer abc") || strings.Contains(strings.ToLower(sanitized), "bearer topsecret") {
			t.Fatalf("expected bearer redaction for %q, got %q", raw, sanitized)
		}
		if strings.Contains(sanitized, "user:pass@") || strings.Contains(sanitized, "x-access-token:") {
			t.Fatalf("expected url credential redaction for %q, got %q", raw, sanitized)
		}
	}
}

func TestSanitizeGitOutputPreservesCleanMessages(t *testing.T) {
	t.Parallel()

	raw := "fatal: not a git repository"
	if got := sanitizeGitOutput(raw); got != raw {
		t.Fatalf("expected clean message to pass through, got %q", got)
	}
}

func TestNormalizeStatusHandlesRenameCopyAndFallbackCases(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"R ":   "M",
		"R100": "M",
		"C ":   "A",
		"C100": "A",
		" D":   "D",
		"MM":   "M",
		"??":   "U",
		"UU":   "C",
		" X":   "M",
	}

	for raw, want := range cases {
		if got := normalizeStatus(raw); got != want {
			t.Fatalf("normalizeStatus(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestSubprocessGitBackendCleansUpAskpassAfterCommand(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	script := filepath.Join(dir, "fake-git.sh")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nexit 1\n"), 0o755); err != nil {
		t.Fatalf("write fake git script: %v", err)
	}

	backend := NewSubprocessGitBackend(SubprocessGitBackendConfig{
		WorkspaceRoot:  dir,
		TempDir:        dir,
		CommandFactory: fakeCommandFactory{script: script},
	})

	err := backend.Push(context.Background(), "origin", "main", &GitCredentials{
		Username: "x-access-token",
		Password: "ghs_cleanup_test",
	})
	if err == nil {
		t.Fatal("expected push to fail with fake git script")
	}

	entries, readErr := os.ReadDir(dir)
	if readErr != nil {
		t.Fatalf("read temp dir: %v", readErr)
	}
	var names []string
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	if len(names) != 1 || names[0] != "fake-git.sh" {
		t.Fatalf("expected askpass temp file cleanup, found entries=%v", names)
	}
}

func TestSubprocessGitBackendIntegrationInitAndStatus(t *testing.T) {
	t.Parallel()

	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}

	dir := t.TempDir()
	backend := NewSubprocessGitBackend(SubprocessGitBackendConfig{
		WorkspaceRoot: dir,
	})

	isRepo, err := backend.IsRepo(context.Background())
	if err != nil {
		t.Fatalf("is repo before init: %v", err)
	}
	if isRepo {
		t.Fatal("expected temp dir to not be a repo before init")
	}

	if err := backend.Init(context.Background()); err != nil {
		t.Fatalf("init repo: %v", err)
	}

	isRepo, err = backend.IsRepo(context.Background())
	if err != nil {
		t.Fatalf("is repo after init: %v", err)
	}
	if !isRepo {
		t.Fatal("expected temp dir to become a repo after init")
	}

	status, err := backend.Status(context.Background())
	if err != nil {
		t.Fatalf("status after init: %v", err)
	}
	if len(status) != 0 {
		t.Fatalf("expected empty status after init, got %#v", status)
	}
}

func TestSubprocessGitBackendStatusReturnsSortedPaths(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	script := filepath.Join(dir, "fake-git.sh")
	content := `#!/bin/sh
if [ "$1" = "rev-parse" ]; then
  printf '.git\n'
  exit 0
fi
if [ "$1" = "status" ]; then
  printf ' M z.txt\n'
  printf ' M a.txt\n'
  exit 0
fi
exit 1
`
	if err := os.WriteFile(script, []byte(content), 0o755); err != nil {
		t.Fatalf("write fake git script: %v", err)
	}

	backend := NewSubprocessGitBackend(SubprocessGitBackendConfig{
		WorkspaceRoot:  dir,
		CommandFactory: fakeCommandFactory{script: script},
	})

	status, err := backend.Status(context.Background())
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if len(status) != 2 {
		t.Fatalf("expected 2 status entries, got %#v", status)
	}
	if status[0].Path != "a.txt" || status[1].Path != "z.txt" {
		t.Fatalf("expected status paths to be sorted, got %#v", status)
	}
}

func TestSubprocessGitBackendRemoteListSanitizesURLs(t *testing.T) {
	t.Parallel()

	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}

	dir := t.TempDir()
	backend := NewSubprocessGitBackend(SubprocessGitBackendConfig{
		WorkspaceRoot: dir,
	})
	if err := backend.Init(context.Background()); err != nil {
		t.Fatalf("init repo: %v", err)
	}
	addRemote := func(name string, url string) {
		cmd := exec.Command("git", "-C", dir, "remote", "add", name, url)
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("add remote %s: %v output=%s", name, err, string(output))
		}
	}
	addRemote("origin", "https://user:pass@github.com/org/repo.git")
	addRemote("backup", "https://x-access-token:ghs_secret@github.com/org/backup.git")

	remotes, err := backend.RemoteList(context.Background())
	if err != nil {
		t.Fatalf("remote list: %v", err)
	}
	if len(remotes) != 2 {
		t.Fatalf("expected 2 remotes, got %#v", remotes)
	}
	gotByName := map[string]string{}
	for _, remote := range remotes {
		gotByName[remote.Remote] = remote.URL
	}
	if gotByName["origin"] != "https://***@github.com/org/repo.git" {
		t.Fatalf("expected origin URL to be sanitized, got %q", gotByName["origin"])
	}
	if gotByName["backup"] != "https://***@github.com/org/backup.git" {
		t.Fatalf("expected backup URL to be sanitized, got %q", gotByName["backup"])
	}
}

func TestSubprocessGitBackendTimeoutReturnsGitCommandError(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	script := filepath.Join(dir, "sleep-git.sh")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nsleep 2\n"), 0o755); err != nil {
		t.Fatalf("write sleep git script: %v", err)
	}

	backend := NewSubprocessGitBackend(SubprocessGitBackendConfig{
		WorkspaceRoot:  dir,
		Timeout:        50 * time.Millisecond,
		CommandFactory: fakeCommandFactory{script: script},
	})

	err := backend.Init(context.Background())
	if err == nil {
		t.Fatal("expected init to time out")
	}
	var commandErr *GitCommandError
	if !errors.As(err, &commandErr) {
		t.Fatalf("expected GitCommandError, got %T", err)
	}
	if !strings.Contains(commandErr.Error(), "timed out") {
		t.Fatalf("expected timeout error message, got %q", commandErr.Error())
	}
}

type fakeCommandFactory struct {
	script string
}

func (f fakeCommandFactory) CommandContext(ctx context.Context, _ string, args ...string) *exec.Cmd {
	cmdArgs := append([]string{f.script}, args...)
	return exec.CommandContext(ctx, cmdArgs[0], cmdArgs[1:]...)
}
