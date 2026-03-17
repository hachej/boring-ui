package files

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/boringdata/boring-ui/internal/app"
	"github.com/boringdata/boring-ui/internal/auth"
	"github.com/boringdata/boring-ui/internal/config"
	"github.com/boringdata/boring-ui/internal/storage"
)

func TestModuleMetadata(t *testing.T) {
	module := newFilesModule(t, t.TempDir())
	if module.Name() != "files" {
		t.Fatalf("expected module name files, got %q", module.Name())
	}
	if module.Prefix() != "/api/v1/files" {
		t.Fatalf("expected canonical prefix, got %q", module.Prefix())
	}
}

func TestFilesModuleTraversalRejected(t *testing.T) {
	handler := newFilesApp(t)

	req := authedRequest(t, http.MethodGet, "/api/v1/files/content?path=../../etc/passwd", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for traversal, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestFilesModuleMissingReadReturns404(t *testing.T) {
	handler := newFilesApp(t)

	req := authedRequest(t, http.MethodGet, "/api/v1/files/read?path=missing.txt", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for missing file, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestFilesModuleSearchReturnsResults(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "subdir"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "alpha.txt"), []byte("alpha"), 0o644); err != nil {
		t.Fatalf("write alpha: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "subdir", "Upper.TXT"), []byte("beta"), 0o644); err != nil {
		t.Fatalf("write upper: %v", err)
	}

	handler := newFilesAppWithRoot(t, root)
	body := bytes.NewBufferString(`{"q":"*.txt","path":"."}`)
	req := authedRequest(t, http.MethodPost, "/api/v1/files/search", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 from search, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"path":"alpha.txt"`) {
		t.Fatalf("expected alpha.txt in search results, got %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"path":"subdir/Upper.TXT"`) {
		t.Fatalf("expected case-insensitive Upper.TXT match, got %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"dir":"subdir"`) {
		t.Fatalf("expected dir field in search results, got %s", rec.Body.String())
	}
}

func TestFilesModuleListReadWriteAndMkdir(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatalf("write hello: %v", err)
	}

	handler := newFilesAppWithRoot(t, root)

	listReq := authedRequest(t, http.MethodGet, "/api/v1/files/tree?path=.", nil)
	listRec := httptest.NewRecorder()
	handler.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK || !strings.Contains(listRec.Body.String(), `"name":"hello.txt"`) {
		t.Fatalf("expected list payload, got status=%d body=%s", listRec.Code, listRec.Body.String())
	}

	writeReq := authedRequest(t, http.MethodPut, "/api/v1/files/content?path=newdir/new.txt", bytes.NewBufferString(`{"content":"new content"}`))
	writeReq.Header.Set("Content-Type", "application/json")
	writeRec := httptest.NewRecorder()
	handler.ServeHTTP(writeRec, writeReq)
	if writeRec.Code != http.StatusOK {
		t.Fatalf("expected write 200, got %d body=%s", writeRec.Code, writeRec.Body.String())
	}

	readReq := authedRequest(t, http.MethodGet, "/api/v1/files/content?path=newdir/new.txt", nil)
	readRec := httptest.NewRecorder()
	handler.ServeHTTP(readRec, readReq)
	if readRec.Code != http.StatusOK || !strings.Contains(readRec.Body.String(), `"content":"new content"`) {
		t.Fatalf("expected content payload, got status=%d body=%s", readRec.Code, readRec.Body.String())
	}

	mkdirReq := authedRequest(t, http.MethodPost, "/api/v1/files/mkdir", bytes.NewBufferString(`{"path":"created/child"}`))
	mkdirReq.Header.Set("Content-Type", "application/json")
	mkdirRec := httptest.NewRecorder()
	handler.ServeHTTP(mkdirRec, mkdirReq)
	if mkdirRec.Code != http.StatusOK {
		t.Fatalf("expected mkdir 200, got %d body=%s", mkdirRec.Code, mkdirRec.Body.String())
	}
	if info, err := os.Stat(filepath.Join(root, "created", "child")); err != nil || !info.IsDir() {
		t.Fatalf("expected created directory, err=%v info=%v", err, info)
	}
}

func TestFilesModuleRejectsSymlinkEscapesForOSOperations(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "source.txt"), []byte("source"), 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("secret"), 0o644); err != nil {
		t.Fatalf("write outside secret: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(root, "safe"), 0o755); err != nil {
		t.Fatalf("mkdir safe: %v", err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Fatalf("create symlink: %v", err)
	}

	handler := newFilesAppWithRoot(t, root)

	tests := []struct {
		name   string
		method string
		target string
		body   string
	}{
		{name: "mkdir", method: http.MethodPost, target: "/api/v1/files/mkdir", body: `{"path":"escape/newdir"}`},
		{name: "search", method: http.MethodPost, target: "/api/v1/files/search", body: `{"q":"*.txt","path":"escape"}`},
		{name: "rename", method: http.MethodPost, target: "/api/v1/files/rename", body: `{"old_path":"source.txt","new_path":"escape/renamed.txt"}`},
		{name: "move", method: http.MethodPost, target: "/api/v1/files/move", body: `{"src_path":"source.txt","dest_dir":"escape"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := authedRequest(t, tt.method, tt.target, bytes.NewBufferString(tt.body))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("expected 403, got %d body=%s", rec.Code, rec.Body.String())
			}
		})
	}

	if _, err := os.Stat(filepath.Join(outside, "renamed.txt")); !os.IsNotExist(err) {
		t.Fatalf("outside file should not be created, err=%v", err)
	}
}

func newFilesModule(t *testing.T, root string) *Module {
	t.Helper()

	store, err := storage.NewLocal(root)
	if err != nil {
		t.Fatalf("new local storage: %v", err)
	}
	module, err := NewModule(config.Config{ConfigPath: filepath.Join(root, config.ConfigFile)}, store)
	if err != nil {
		t.Fatalf("new files module: %v", err)
	}
	return module
}

func newFilesApp(t *testing.T) http.Handler {
	t.Helper()
	return newFilesAppWithRoot(t, t.TempDir())
}

func newFilesAppWithRoot(t *testing.T, root string) http.Handler {
	t.Helper()

	t.Setenv("BORING_UI_SESSION_SECRET", "test-secret")
	t.Setenv("BORING_SESSION_SECRET", "test-secret")

	appInstance := app.New(config.Config{ConfigPath: filepath.Join(root, config.ConfigFile)})
	appInstance.AddModule(newFilesModule(t, root))
	return appInstance.Handler()
}

func authedRequest(t *testing.T, method string, target string, body *bytes.Buffer) *http.Request {
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
		IsOwner: true,
	})
	if err != nil {
		t.Fatalf("create auth token: %v", err)
	}
	req.AddCookie(&http.Cookie{Name: manager.CookieName(), Value: token})
	return req
}
