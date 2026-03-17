package uistate

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
	module := newUIStateModule(t, t.TempDir())
	if module.Name() != "ui_state" {
		t.Fatalf("expected module name ui_state, got %q", module.Name())
	}
	if module.Prefix() != "/api/v1/ui" {
		t.Fatalf("expected canonical prefix, got %q", module.Prefix())
	}
}

func TestUIStateRoundTripAndLatest(t *testing.T) {
	handler := newUIStateApp(t, t.TempDir())

	payload := `{"client_id":"web-client-1","project_root":"/tmp/demo","active_panel_id":"pane-1","open_panels":[{"id":"pane-1","component":"list"},{"id":"pane-2","component":"chart"}],"meta":{"pane_count":2}}`

	putReq := authedRequest(t, http.MethodPut, "/api/v1/ui/state", bytes.NewBufferString(payload))
	putReq.Header.Set("Content-Type", "application/json")
	putRec := httptest.NewRecorder()
	handler.ServeHTTP(putRec, putReq)
	if putRec.Code != http.StatusOK || !strings.Contains(putRec.Body.String(), `"client_id":"web-client-1"`) {
		t.Fatalf("expected successful upsert, got status=%d body=%s", putRec.Code, putRec.Body.String())
	}
	if !strings.Contains(putRec.Body.String(), `"captured_at_ms":null`) {
		t.Fatalf("expected omitted captured_at_ms to round-trip as null, got body=%s", putRec.Body.String())
	}

	latestReq := authedRequest(t, http.MethodGet, "/api/v1/ui/state/latest", nil)
	latestRec := httptest.NewRecorder()
	handler.ServeHTTP(latestRec, latestReq)
	if latestRec.Code != http.StatusOK || !strings.Contains(latestRec.Body.String(), `"active_panel_id":"pane-1"`) {
		t.Fatalf("expected latest state, got status=%d body=%s", latestRec.Code, latestRec.Body.String())
	}
	if !strings.Contains(latestRec.Body.String(), `"captured_at_ms":null`) {
		t.Fatalf("expected latest state to include captured_at_ms null, got body=%s", latestRec.Body.String())
	}

	listReq := authedRequest(t, http.MethodGet, "/api/v1/ui/state", nil)
	listRec := httptest.NewRecorder()
	handler.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK || !strings.Contains(listRec.Body.String(), `"count":1`) {
		t.Fatalf("expected state listing, got status=%d body=%s", listRec.Code, listRec.Body.String())
	}

	getReq := authedRequest(t, http.MethodGet, "/api/v1/ui/state/web-client-1", nil)
	getRec := httptest.NewRecorder()
	handler.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusOK || !strings.Contains(getRec.Body.String(), `"project_root":"/tmp/demo"`) {
		t.Fatalf("expected state fetch, got status=%d body=%s", getRec.Code, getRec.Body.String())
	}
}

func TestUIStateMissingLatestReturns404(t *testing.T) {
	handler := newUIStateApp(t, t.TempDir())

	req := authedRequest(t, http.MethodGet, "/api/v1/ui/state/latest", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"detail":"No frontend state has been published"`) {
		t.Fatalf("expected python-style detail payload, got %s", rec.Body.String())
	}
}

func TestUIStatePanesAndCommands(t *testing.T) {
	handler := newUIStateApp(t, t.TempDir())

	seed := `{"client_id":"web-client-2","active_panel_id":"pane-2","open_panels":[{"id":"pane-1","component":"table"},{"id":"pane-2","component":"chart-canvas"}]}`
	seedReq := authedRequest(t, http.MethodPut, "/api/v1/ui/state", bytes.NewBufferString(seed))
	seedReq.Header.Set("Content-Type", "application/json")
	seedRec := httptest.NewRecorder()
	handler.ServeHTTP(seedRec, seedReq)
	if seedRec.Code != http.StatusOK {
		t.Fatalf("expected seed success, got %d body=%s", seedRec.Code, seedRec.Body.String())
	}

	panesReq := authedRequest(t, http.MethodGet, "/api/v1/ui/panes", nil)
	panesRec := httptest.NewRecorder()
	handler.ServeHTTP(panesRec, panesReq)
	if panesRec.Code != http.StatusOK || !strings.Contains(panesRec.Body.String(), `"count":2`) {
		t.Fatalf("expected panes payload, got status=%d body=%s", panesRec.Code, panesRec.Body.String())
	}

	focusReq := authedRequest(t, http.MethodPost, "/api/v1/ui/focus", bytes.NewBufferString(`{"client_id":"web-client-2","panel_id":"pane-1"}`))
	focusReq.Header.Set("Content-Type", "application/json")
	focusRec := httptest.NewRecorder()
	handler.ServeHTTP(focusRec, focusReq)
	if focusRec.Code != http.StatusOK || !strings.Contains(focusRec.Body.String(), `"kind":"focus_panel"`) {
		t.Fatalf("expected focus command, got status=%d body=%s", focusRec.Code, focusRec.Body.String())
	}

	openReq := authedRequest(t, http.MethodPost, "/api/v1/ui/commands", bytes.NewBufferString(`{"command":{"kind":"open_panel","component":"chart-canvas"}}`))
	openReq.Header.Set("Content-Type", "application/json")
	openRec := httptest.NewRecorder()
	handler.ServeHTTP(openRec, openReq)
	if openRec.Code != http.StatusOK || !strings.Contains(openRec.Body.String(), `"kind":"open_panel"`) {
		t.Fatalf("expected open-panel command to resolve latest client, got status=%d body=%s", openRec.Code, openRec.Body.String())
	}

	nextReq := authedRequest(t, http.MethodGet, "/api/v1/ui/commands/next", nil)
	nextRec := httptest.NewRecorder()
	handler.ServeHTTP(nextRec, nextReq)
	if nextRec.Code != http.StatusOK || !strings.Contains(nextRec.Body.String(), `"panel_id":"pane-1"`) {
		t.Fatalf("expected queued command for latest client, got status=%d body=%s", nextRec.Code, nextRec.Body.String())
	}

	nextOpenReq := authedRequest(t, http.MethodGet, "/api/v1/ui/commands/next?client_id=web-client-2", nil)
	nextOpenRec := httptest.NewRecorder()
	handler.ServeHTTP(nextOpenRec, nextOpenReq)
	if nextOpenRec.Code != http.StatusOK || !strings.Contains(nextOpenRec.Body.String(), `"component":"chart-canvas"`) {
		t.Fatalf("expected second queued command, got status=%d body=%s", nextOpenRec.Code, nextOpenRec.Body.String())
	}

	emptyReq := authedRequest(t, http.MethodGet, "/api/v1/ui/commands/next?client_id=web-client-2", nil)
	emptyRec := httptest.NewRecorder()
	handler.ServeHTTP(emptyRec, emptyReq)
	if emptyRec.Code != http.StatusOK || !strings.Contains(emptyRec.Body.String(), `"command":null`) {
		t.Fatalf("expected empty queue, got status=%d body=%s", emptyRec.Code, emptyRec.Body.String())
	}
}

func TestUIStateCommandValidationErrors(t *testing.T) {
	handler := newUIStateApp(t, t.TempDir())

	seedReq := authedRequest(t, http.MethodPut, "/api/v1/ui/state", bytes.NewBufferString(`{"client_id":"client-errors","open_panels":[{"id":"pane-1","component":"editor"}]}`))
	seedReq.Header.Set("Content-Type", "application/json")
	seedRec := httptest.NewRecorder()
	handler.ServeHTTP(seedRec, seedReq)
	if seedRec.Code != http.StatusOK {
		t.Fatalf("expected seed success, got %d body=%s", seedRec.Code, seedRec.Body.String())
	}

	cases := []struct {
		name   string
		body   string
		status int
	}{
		{name: "missing open panel component", body: `{"command":{"kind":"open_panel"}}`, status: http.StatusBadRequest},
		{name: "missing focus panel id", body: `{"command":{"kind":"focus_panel"}}`, status: http.StatusBadRequest},
		{name: "focuses missing panel", body: `{"command":{"kind":"focus_panel","panel_id":"missing-pane"}}`, status: http.StatusConflict},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := authedRequest(t, http.MethodPost, "/api/v1/ui/commands", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != tc.status {
				t.Fatalf("expected status %d, got %d body=%s", tc.status, rec.Code, rec.Body.String())
			}
		})
	}
}

func TestUIStatePersistsViaStorage(t *testing.T) {
	root := t.TempDir()
	store, err := storage.NewLocal(root)
	if err != nil {
		t.Fatalf("new local storage: %v", err)
	}
	cfg := config.Config{ConfigPath: filepath.Join(root, config.ConfigFile)}

	serviceA, err := NewService(cfg, store)
	if err != nil {
		t.Fatalf("new service A: %v", err)
	}
	if _, err := serviceA.Upsert(map[string]any{
		"client_id":       "persisted-client",
		"active_panel_id": "pane-9",
		"open_panels":     []any{map[string]any{"id": "pane-9", "component": "editor"}},
	}); err != nil {
		t.Fatalf("upsert state: %v", err)
	}

	serviceB, err := NewService(cfg, store)
	if err != nil {
		t.Fatalf("new service B: %v", err)
	}
	latest := serviceB.GetLatest()
	if latest == nil || latest["client_id"] != "persisted-client" {
		t.Fatalf("expected persisted state, got %#v", latest)
	}
	stateFile := filepath.Join(root, ".boring", "ui_state.json")
	if _, err := os.Stat(stateFile); err != nil {
		t.Fatalf("expected persisted state file, got err=%v", err)
	}
}

func TestUIStateDeleteAndClear(t *testing.T) {
	handler := newUIStateApp(t, t.TempDir())

	for _, payload := range []string{
		`{"client_id":"client-a","open_panels":[{"id":"pane-a"}]}`,
		`{"client_id":"client-b","open_panels":[{"id":"pane-b"}]}`,
	} {
		req := authedRequest(t, http.MethodPut, "/api/v1/ui/state", bytes.NewBufferString(payload))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected seed success, got %d body=%s", rec.Code, rec.Body.String())
		}
	}

	deleteReq := authedRequest(t, http.MethodDelete, "/api/v1/ui/state/client-a", nil)
	deleteRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusOK || !strings.Contains(deleteRec.Body.String(), `"deleted":"client-a"`) {
		t.Fatalf("expected delete success, got status=%d body=%s", deleteRec.Code, deleteRec.Body.String())
	}

	missingReq := authedRequest(t, http.MethodGet, "/api/v1/ui/state/client-a", nil)
	missingRec := httptest.NewRecorder()
	handler.ServeHTTP(missingRec, missingReq)
	if missingRec.Code != http.StatusNotFound {
		t.Fatalf("expected deleted state to 404, got %d body=%s", missingRec.Code, missingRec.Body.String())
	}

	clearReq := authedRequest(t, http.MethodDelete, "/api/v1/ui/state", nil)
	clearRec := httptest.NewRecorder()
	handler.ServeHTTP(clearRec, clearReq)
	if clearRec.Code != http.StatusOK || !strings.Contains(clearRec.Body.String(), `"cleared":1`) {
		t.Fatalf("expected clear success, got status=%d body=%s", clearRec.Code, clearRec.Body.String())
	}

	missingDeleteReq := authedRequest(t, http.MethodDelete, "/api/v1/ui/state/client-a", nil)
	missingDeleteRec := httptest.NewRecorder()
	handler.ServeHTTP(missingDeleteRec, missingDeleteReq)
	if missingDeleteRec.Code != http.StatusNotFound {
		t.Fatalf("expected deleting missing state to 404, got %d body=%s", missingDeleteRec.Code, missingDeleteRec.Body.String())
	}
}

func newUIStateModule(t *testing.T, root string) *Module {
	t.Helper()
	store, err := storage.NewLocal(root)
	if err != nil {
		t.Fatalf("new local storage: %v", err)
	}
	module, err := NewModule(config.Config{ConfigPath: filepath.Join(root, config.ConfigFile)}, store)
	if err != nil {
		t.Fatalf("new ui state module: %v", err)
	}
	return module
}

func newUIStateApp(t *testing.T, root string) http.Handler {
	t.Helper()

	t.Setenv("BORING_UI_SESSION_SECRET", "test-secret")
	t.Setenv("BORING_SESSION_SECRET", "test-secret")
	appInstance := app.New(config.Config{ConfigPath: filepath.Join(root, config.ConfigFile)})
	appInstance.AddModule(newUIStateModule(t, root))
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
