package git

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/boringdata/boring-ui/internal/app"
	"github.com/boringdata/boring-ui/internal/auth"
	"github.com/boringdata/boring-ui/internal/config"
	gitbackend "github.com/boringdata/boring-ui/internal/git"
)

func TestModuleMetadata(t *testing.T) {
	module := newGitModule(t, t.TempDir(), nil)
	if module.Name() != "git" {
		t.Fatalf("expected module name git, got %q", module.Name())
	}
	if module.Prefix() != "/api/v1/git" {
		t.Fatalf("expected canonical prefix, got %q", module.Prefix())
	}
}

func TestGitModuleStatusParsesStagedUnstagedAndUntracked(t *testing.T) {
	repo := newGitRepo(t)
	writeFile(t, filepath.Join(repo, "staged.txt"), "staged change\n")
	writeFile(t, filepath.Join(repo, "modified.txt"), "modified change\n")
	writeFile(t, filepath.Join(repo, "untracked.txt"), "new file\n")
	runGit(t, repo, "add", "staged.txt")

	handler := newGitApp(t, repo, nil)
	req := authedRequest(t, http.MethodGet, "/api/v1/git/status", nil, true)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	var payload struct {
		IsRepo bool `json:"is_repo"`
		Files  []struct {
			Path   string `json:"path"`
			Status string `json:"status"`
		} `json:"files"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode status payload: %v", err)
	}
	if !payload.IsRepo {
		t.Fatal("expected repository to be detected")
	}

	filesByPath := map[string]string{}
	for _, entry := range payload.Files {
		filesByPath[entry.Path] = entry.Status
	}
	if filesByPath["staged.txt"] != "M" {
		t.Fatalf("expected staged.txt=M, got %#v", filesByPath)
	}
	if filesByPath["modified.txt"] != "M" {
		t.Fatalf("expected modified.txt=M, got %#v", filesByPath)
	}
	if filesByPath["untracked.txt"] != "U" {
		t.Fatalf("expected untracked.txt=U, got %#v", filesByPath)
	}
}

func TestGitModuleDiffRejectsTraversal(t *testing.T) {
	handler := newGitApp(t, newGitRepo(t), nil)
	req := authedRequest(t, http.MethodGet, "/api/v1/git/diff?path=../../etc/passwd", nil, true)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestGitModuleDiffReturnsPatch(t *testing.T) {
	repo := newGitRepo(t)
	writeFile(t, filepath.Join(repo, "modified.txt"), "updated\n")

	handler := newGitApp(t, repo, nil)
	req := authedRequest(t, http.MethodGet, "/api/v1/git/diff?path=modified.txt", nil, true)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"path":"modified.txt"`) || !strings.Contains(body, "updated") {
		t.Fatalf("expected diff payload, got %s", body)
	}
}

func TestGitModuleCommitAndLogEndpoints(t *testing.T) {
	repo := newGitRepo(t)
	writeFile(t, filepath.Join(repo, "modified.txt"), "committed change\n")
	runGit(t, repo, "add", "modified.txt")

	handler := newGitApp(t, repo, nil)

	commitReq := authedRequest(t, http.MethodPost, "/api/v1/git/commit", bytes.NewBufferString(`{"message":"test commit"}`), true)
	commitReq.Header.Set("Content-Type", "application/json")
	commitRec := httptest.NewRecorder()
	handler.ServeHTTP(commitRec, commitReq)
	if commitRec.Code != http.StatusOK {
		t.Fatalf("expected commit 200, got %d body=%s", commitRec.Code, commitRec.Body.String())
	}
	if !strings.Contains(commitRec.Body.String(), `"oid":"`) {
		t.Fatalf("expected commit oid, got %s", commitRec.Body.String())
	}

	logReq := authedRequest(t, http.MethodGet, "/api/v1/git/log?limit=1", nil, true)
	logRec := httptest.NewRecorder()
	handler.ServeHTTP(logRec, logReq)
	if logRec.Code != http.StatusOK {
		t.Fatalf("expected log 200, got %d body=%s", logRec.Code, logRec.Body.String())
	}
	if !strings.Contains(logRec.Body.String(), `"subject":"test commit"`) {
		t.Fatalf("expected commit in log, got %s", logRec.Body.String())
	}
}

func TestGitModuleCommitNothingToCommitIncludesDetail(t *testing.T) {
	handler := newGitApp(t, newGitRepo(t), nil)

	req := authedRequest(t, http.MethodPost, "/api/v1/git/commit", bytes.NewBufferString(`{"message":"empty"}`), true)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected commit 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(strings.ToLower(rec.Body.String()), `"detail":"git error: `) {
		t.Fatalf("expected detail in error payload, got %s", rec.Body.String())
	}
	if !strings.Contains(strings.ToLower(rec.Body.String()), "nothing to commit") {
		t.Fatalf("expected nothing to commit detail, got %s", rec.Body.String())
	}
}

func TestGitModuleAddTreatsNilPathsAsNoOp(t *testing.T) {
	handler := newGitApp(t, newGitRepo(t), nil)

	req := authedRequest(t, http.MethodPost, "/api/v1/git/add", bytes.NewBufferString(`{}`), true)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected add 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"staged":false`) {
		t.Fatalf("expected staged=false for nil paths, got %s", rec.Body.String())
	}
}

func TestGitModuleBranchesAndCheckoutEndpoints(t *testing.T) {
	repo := newGitRepo(t)
	runGit(t, repo, "branch", "feature")

	handler := newGitApp(t, repo, nil)

	branchesReq := authedRequest(t, http.MethodGet, "/api/v1/git/branches", nil, true)
	branchesRec := httptest.NewRecorder()
	handler.ServeHTTP(branchesRec, branchesReq)
	if branchesRec.Code != http.StatusOK {
		t.Fatalf("expected branches 200, got %d body=%s", branchesRec.Code, branchesRec.Body.String())
	}
	if !strings.Contains(branchesRec.Body.String(), `"feature"`) {
		t.Fatalf("expected feature branch in list, got %s", branchesRec.Body.String())
	}

	checkoutReq := authedRequest(t, http.MethodPost, "/api/v1/git/checkout", bytes.NewBufferString(`{"name":"feature"}`), true)
	checkoutReq.Header.Set("Content-Type", "application/json")
	checkoutRec := httptest.NewRecorder()
	handler.ServeHTTP(checkoutRec, checkoutReq)
	if checkoutRec.Code != http.StatusOK {
		t.Fatalf("expected checkout 200, got %d body=%s", checkoutRec.Code, checkoutRec.Body.String())
	}

	current := strings.TrimSpace(runGitOutput(t, repo, "rev-parse", "--abbrev-ref", "HEAD"))
	if current != "feature" {
		t.Fatalf("expected current branch feature, got %q", current)
	}
}

func TestGitModuleCurrentBranchEndpoint(t *testing.T) {
	repo := newGitRepo(t)
	runGit(t, repo, "checkout", "-b", "feature/current")

	handler := newGitApp(t, repo, nil)

	req := authedRequest(t, http.MethodGet, "/api/v1/git/branch", nil, true)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected current branch 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"branch":"feature/current"`) {
		t.Fatalf("expected current branch payload, got %s", rec.Body.String())
	}
}

func TestGitModuleBranchesAndRemotesUseEmptyArrays(t *testing.T) {
	repo := newGitRepo(t)
	handler := newGitApp(t, repo, nil)

	branchesReq := authedRequest(t, http.MethodGet, "/api/v1/git/branches", nil, true)
	branchesRec := httptest.NewRecorder()
	handler.ServeHTTP(branchesRec, branchesReq)
	if branchesRec.Code != http.StatusOK {
		t.Fatalf("expected branches 200, got %d body=%s", branchesRec.Code, branchesRec.Body.String())
	}
	if !strings.Contains(branchesRec.Body.String(), `"branches":[`) {
		t.Fatalf("expected branches array, got %s", branchesRec.Body.String())
	}

	remotesReq := authedRequest(t, http.MethodGet, "/api/v1/git/remotes", nil, true)
	remotesRec := httptest.NewRecorder()
	handler.ServeHTTP(remotesRec, remotesReq)
	if remotesRec.Code != http.StatusOK {
		t.Fatalf("expected remotes 200, got %d body=%s", remotesRec.Code, remotesRec.Body.String())
	}
	if !strings.Contains(remotesRec.Body.String(), `"remotes":[`) {
		t.Fatalf("expected remotes array, got %s", remotesRec.Body.String())
	}
}

func TestGitModuleCreateBranchAndMergeEndpoints(t *testing.T) {
	backend := &stubBackend{}
	handler := newGitApp(t, t.TempDir(), backend)

	createReq := authedRequest(t, http.MethodPost, "/api/v1/git/branch", bytes.NewBufferString(`{"name":"feature/demo","checkout":false}`), true)
	createReq.Header.Set("Content-Type", "application/json")
	createRec := httptest.NewRecorder()
	handler.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusOK {
		t.Fatalf("expected create branch 200, got %d body=%s", createRec.Code, createRec.Body.String())
	}
	if backend.branchCreateName != "feature/demo" || backend.branchCreateCheckout {
		t.Fatalf("unexpected branch create call: %+v", backend)
	}
	if !strings.Contains(createRec.Body.String(), `"created":true`) {
		t.Fatalf("expected created payload, got %s", createRec.Body.String())
	}

	mergeReq := authedRequest(t, http.MethodPost, "/api/v1/git/merge", bytes.NewBufferString(`{"source":"feature/demo","message":"merge it"}`), true)
	mergeReq.Header.Set("Content-Type", "application/json")
	mergeRec := httptest.NewRecorder()
	handler.ServeHTTP(mergeRec, mergeReq)
	if mergeRec.Code != http.StatusOK {
		t.Fatalf("expected merge 200, got %d body=%s", mergeRec.Code, mergeRec.Body.String())
	}
	if backend.mergeSource != "feature/demo" || backend.mergeMessage != "merge it" {
		t.Fatalf("unexpected merge call: %+v", backend)
	}
	if !strings.Contains(mergeRec.Body.String(), `"merged":true`) {
		t.Fatalf("expected merged payload, got %s", mergeRec.Body.String())
	}
}

func TestGitModuleLogRejectsNonPositiveLimit(t *testing.T) {
	handler := newGitApp(t, newGitRepo(t), nil)

	req := authedRequest(t, http.MethodGet, "/api/v1/git/log?limit=0", nil, true)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestGitModulePushRequiresOwner(t *testing.T) {
	backend := &stubBackend{}
	handler := newGitApp(t, t.TempDir(), backend)

	req := authedRequest(t, http.MethodPost, "/api/v1/git/push", bytes.NewBufferString(`{"remote":"origin"}`), false)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	if backend.pushCalled {
		t.Fatal("expected push backend call to be blocked for non-owner")
	}
}

func TestGitModulePullRequiresOwner(t *testing.T) {
	backend := &stubBackend{}
	handler := newGitApp(t, t.TempDir(), backend)

	req := authedRequest(t, http.MethodPost, "/api/v1/git/pull", bytes.NewBufferString(`{"remote":"origin"}`), false)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d body=%s", rec.Code, rec.Body.String())
	}
	if backend.pullCalled {
		t.Fatal("expected pull backend call to be blocked for non-owner")
	}
}

func TestGitModuleErrorResponsesRedactCredentials(t *testing.T) {
	backend := &stubBackend{
		pushErr: gitbackend.NewGitCommandError(
			"git push",
			"push failed",
			1,
			"fatal: https://user:pass@github.com/org/repo.git ghp_secret123 Bearer topsecret",
			nil,
		),
	}
	handler := newGitApp(t, t.TempDir(), backend)

	req := authedRequest(t, http.MethodPost, "/api/v1/git/push", bytes.NewBufferString(`{
		"remote":"origin",
		"credentials":{"username":"x-access-token","password":"ghp_secret123"}
	}`), true)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d body=%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	for _, secret := range []string{"user:pass@", "ghp_secret123", "Bearer topsecret"} {
		if strings.Contains(body, secret) {
			t.Fatalf("expected secret %q to be redacted, got %s", secret, body)
		}
	}
	if !strings.Contains(body, "***") {
		t.Fatalf("expected redacted marker in body, got %s", body)
	}
}

func newGitModule(t *testing.T, root string, backend gitbackend.GitBackend) *Module {
	t.Helper()

	module, err := NewModule(config.Config{ConfigPath: filepath.Join(root, config.ConfigFile)}, backend)
	if err != nil {
		t.Fatalf("new git module: %v", err)
	}
	return module
}

func newGitApp(t *testing.T, root string, backend gitbackend.GitBackend) http.Handler {
	t.Helper()

	t.Setenv("BORING_UI_SESSION_SECRET", "test-secret")
	t.Setenv("BORING_SESSION_SECRET", "test-secret")

	appInstance := app.New(config.Config{ConfigPath: filepath.Join(root, config.ConfigFile)})
	appInstance.AddModule(newGitModule(t, root, backend))
	return appInstance.Handler()
}

func newGitRepo(t *testing.T) string {
	t.Helper()

	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}

	root := t.TempDir()
	runGit(t, root, "init")
	runGit(t, root, "config", "user.email", "test@example.com")
	runGit(t, root, "config", "user.name", "Test User")
	writeFile(t, filepath.Join(root, "staged.txt"), "staged base\n")
	writeFile(t, filepath.Join(root, "modified.txt"), "modified base\n")
	runGit(t, root, "add", ".")
	runGit(t, root, "commit", "-m", "Initial commit")
	return root
}

func writeFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}
}

func runGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %s failed: %v output=%s", strings.Join(args, " "), err, string(output))
	}
}

func runGitOutput(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v output=%s", strings.Join(args, " "), err, string(output))
	}
	return string(output)
}

func authedRequest(t *testing.T, method string, target string, body *bytes.Buffer, owner bool) *http.Request {
	t.Helper()

	var reader *bytes.Buffer
	if body == nil {
		reader = bytes.NewBuffer(nil)
	} else {
		reader = body
	}
	req := httptest.NewRequest(method, target, reader)

	manager := auth.NewSessionManager(auth.SessionConfig{
		Secret: "test-secret",
	})
	token, err := manager.Create(auth.User{
		ID:      "worker",
		Email:   "worker@example.com",
		IsOwner: owner,
	})
	if err != nil {
		t.Fatalf("create auth token: %v", err)
	}
	req.AddCookie(&http.Cookie{Name: manager.CookieName(), Value: token})
	return req
}

type stubBackend struct {
	pushCalled           bool
	pullCalled           bool
	pushErr              error
	pullErr              error
	currentBranchName    string
	branchCreateName     string
	branchCreateCheckout bool
	mergeSource          string
	mergeMessage         string
}

func (b *stubBackend) IsRepo(context.Context) (bool, error) { return true, nil }
func (b *stubBackend) Status(context.Context) ([]gitbackend.StatusEntry, error) {
	return []gitbackend.StatusEntry{}, nil
}
func (b *stubBackend) Diff(context.Context, string) (string, error) { return "", nil }
func (b *stubBackend) DiffCached(context.Context, string) (string, error) {
	return "", nil
}
func (b *stubBackend) Log(context.Context, int) ([]gitbackend.LogEntry, error) {
	return []gitbackend.LogEntry{}, nil
}
func (b *stubBackend) Show(context.Context, string) (string, error) { return "", nil }
func (b *stubBackend) Init(context.Context) error                   { return nil }
func (b *stubBackend) Add(context.Context, []string) error          { return nil }
func (b *stubBackend) Commit(context.Context, string, string, string) (string, error) {
	return "", nil
}
func (b *stubBackend) Push(_ context.Context, _ string, _ string, _ *gitbackend.GitCredentials) error {
	b.pushCalled = true
	return b.pushErr
}
func (b *stubBackend) Pull(_ context.Context, _ string, _ string, _ *gitbackend.GitCredentials) error {
	b.pullCalled = true
	return b.pullErr
}
func (b *stubBackend) Fetch(context.Context, string, *gitbackend.GitCredentials) error { return nil }
func (b *stubBackend) Clone(context.Context, string, string, *gitbackend.GitCredentials) error {
	return nil
}
func (b *stubBackend) BranchList(context.Context) ([]string, string, error) {
	return []string{}, "", nil
}
func (b *stubBackend) CurrentBranchName(context.Context) (string, error) {
	return b.currentBranchName, nil
}
func (b *stubBackend) BranchCreate(_ context.Context, name string, checkout bool) error {
	b.branchCreateName = name
	b.branchCreateCheckout = checkout
	return nil
}
func (b *stubBackend) BranchDelete(context.Context, string, bool) error { return nil }
func (b *stubBackend) Checkout(context.Context, string) error           { return nil }
func (b *stubBackend) Merge(_ context.Context, source string, message string) error {
	b.mergeSource = source
	b.mergeMessage = message
	return nil
}
func (b *stubBackend) RemoteAdd(context.Context, string, string) error { return nil }
func (b *stubBackend) RemoteDelete(context.Context, string) error      { return nil }
func (b *stubBackend) RemoteList(context.Context) ([]gitbackend.RemoteInfo, error) {
	return []gitbackend.RemoteInfo{}, nil
}
func (b *stubBackend) StashList(context.Context) ([]gitbackend.StashEntry, error) {
	return []gitbackend.StashEntry{}, nil
}
func (b *stubBackend) StashPush(context.Context, string, bool) (string, error) { return "", nil }
func (b *stubBackend) StashPop(context.Context, string) error                  { return nil }
