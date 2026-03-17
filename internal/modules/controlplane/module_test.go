package controlplane

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/boringdata/boring-ui/internal/app"
	"github.com/boringdata/boring-ui/internal/auth"
	"github.com/boringdata/boring-ui/internal/config"
)

func TestControlPlaneModuleLoginCreatesDefaultWorkspaceAndMePayload(t *testing.T) {
	t.Setenv("DEV_AUTOLOGIN", "1")
	t.Setenv("AUTH_DEV_USER_ID", "user-1")
	t.Setenv("AUTH_DEV_EMAIL", "owner@example.com")
	t.Setenv("BORING_SESSION_SECRET", "test-secret")

	instance := newControlPlaneApp(t)

	loginReq := httptest.NewRequest(http.MethodGet, "/auth/login?user_id=user-1&email=owner@example.com&redirect_uri=/", nil)
	loginRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(loginRec, loginReq)

	if loginRec.Code != http.StatusFound {
		t.Fatalf("expected 302 from login, got %d", loginRec.Code)
	}

	meReq := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	meReq.Header.Set("Cookie", loginRec.Header().Get("Set-Cookie"))
	meRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(meRec, meReq)

	if meRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from me, got %d: %s", meRec.Code, meRec.Body.String())
	}
	if !strings.Contains(meRec.Body.String(), `"user_id":"user-1"`) {
		t.Fatalf("expected user id in me payload, got %s", meRec.Body.String())
	}
	if !strings.Contains(meRec.Body.String(), `"email":"owner@example.com"`) {
		t.Fatalf("expected email in me payload, got %s", meRec.Body.String())
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces", nil)
	listReq.Header.Set("Cookie", loginRec.Header().Get("Set-Cookie"))
	listRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(listRec, listReq)

	if listRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from workspace list, got %d: %s", listRec.Code, listRec.Body.String())
	}
	if !strings.Contains(listRec.Body.String(), `"count":1`) {
		t.Fatalf("expected a default workspace after login, got %s", listRec.Body.String())
	}
	if !strings.Contains(listRec.Body.String(), `"created_by":"user-1"`) {
		t.Fatalf("expected default workspace ownership, got %s", listRec.Body.String())
	}
}

func TestControlPlaneWorkspaceCreateGetListDeleteLifecycle(t *testing.T) {
	instance := newControlPlaneApp(t)
	cookie := issueSession(t, instance, "user-1", "owner@example.com")

	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", strings.NewReader(`{"name":"Primary"}`))
	createReq.Header.Set("Cookie", cookie)
	createRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(createRec, createReq)

	if createRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 from create workspace, got %d: %s", createRec.Code, createRec.Body.String())
	}
	if !strings.Contains(createRec.Body.String(), `"name":"Primary"`) {
		t.Fatalf("expected workspace name in create payload, got %s", createRec.Body.String())
	}
	workspaceID := extractJSONField(t, createRec.Body.String(), `"id":"`, `"`)
	if !strings.HasPrefix(workspaceID, "ws-") {
		t.Fatalf("expected workspace id prefix, got %q", workspaceID)
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/"+workspaceID, nil)
	getReq.Header.Set("Cookie", cookie)
	getRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(getRec, getReq)

	if getRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from get workspace, got %d: %s", getRec.Code, getRec.Body.String())
	}
	if !strings.Contains(getRec.Body.String(), `"workspace_id":"`+workspaceID+`"`) {
		t.Fatalf("expected workspace id in get payload, got %s", getRec.Body.String())
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces", nil)
	listReq.Header.Set("Cookie", cookie)
	listRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(listRec, listReq)

	if listRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from list workspaces, got %d: %s", listRec.Code, listRec.Body.String())
	}
	if !strings.Contains(listRec.Body.String(), `"count":2`) {
		t.Fatalf("expected default plus created workspace, got %s", listRec.Body.String())
	}

	updateReq := httptest.NewRequest(http.MethodPatch, "/api/v1/workspaces/"+workspaceID, strings.NewReader(`{"name":"Renamed"}`))
	updateReq.Header.Set("Cookie", cookie)
	updateRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(updateRec, updateReq)

	if updateRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from update workspace, got %d: %s", updateRec.Code, updateRec.Body.String())
	}
	if !strings.Contains(updateRec.Body.String(), `"name":"Renamed"`) {
		t.Fatalf("expected renamed workspace in update payload, got %s", updateRec.Body.String())
	}

	runtimeReq := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/"+workspaceID+"/runtime", nil)
	runtimeReq.Header.Set("Cookie", cookie)
	runtimeRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(runtimeRec, runtimeReq)

	if runtimeRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from get workspace runtime, got %d: %s", runtimeRec.Code, runtimeRec.Body.String())
	}
	if !strings.Contains(runtimeRec.Body.String(), `"state":"pending"`) {
		t.Fatalf("expected pending runtime in get payload, got %s", runtimeRec.Body.String())
	}

	retryReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/runtime/retry", nil)
	retryReq.Header.Set("Cookie", cookie)
	retryRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(retryRec, retryReq)

	if retryRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from retry workspace runtime, got %d: %s", retryRec.Code, retryRec.Body.String())
	}
	if !strings.Contains(retryRec.Body.String(), `"retried":true`) {
		t.Fatalf("expected retried=true in retry payload, got %s", retryRec.Body.String())
	}
	if !strings.Contains(retryRec.Body.String(), `"state":"provisioning"`) {
		t.Fatalf("expected provisioning runtime in retry payload, got %s", retryRec.Body.String())
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, "/api/v1/workspaces/"+workspaceID, nil)
	deleteReq.Header.Set("Cookie", cookie)
	deleteRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(deleteRec, deleteReq)

	if deleteRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from delete workspace, got %d: %s", deleteRec.Code, deleteRec.Body.String())
	}
	if !strings.Contains(deleteRec.Body.String(), `"deleted":true`) {
		t.Fatalf("expected deleted response, got %s", deleteRec.Body.String())
	}

	listAfterReq := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces", nil)
	listAfterReq.Header.Set("Cookie", cookie)
	listAfterRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(listAfterRec, listAfterReq)

	if listAfterRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from list after delete, got %d: %s", listAfterRec.Code, listAfterRec.Body.String())
	}
	if !strings.Contains(listAfterRec.Body.String(), `"count":1`) {
		t.Fatalf("expected only default workspace after delete, got %s", listAfterRec.Body.String())
	}
}

func TestControlPlaneDeleteRequiresOwner(t *testing.T) {
	instance := newControlPlaneApp(t)
	ownerCookie := issueSession(t, instance, "user-owner", "owner@example.com")

	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", strings.NewReader(`{"name":"Shared"}`))
	createReq.Header.Set("Cookie", ownerCookie)
	createRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 from create workspace, got %d: %s", createRec.Code, createRec.Body.String())
	}
	workspaceID := extractJSONField(t, createRec.Body.String(), `"id":"`, `"`)

	module := controlPlaneModule(t, instance)
	repo := module.currentRepo()
	if _, err := repo.CreateUser(context.Background(), "user-viewer", map[string]any{
		"email":        "viewer@example.com",
		"display_name": "",
	}); err != nil {
		t.Fatalf("create viewer user: %v", err)
	}
	if _, err := repo.UpdateMemberRole(context.Background(), workspaceID, "user-viewer", "viewer"); err != nil {
		t.Fatalf("add viewer membership: %v", err)
	}

	viewerCookie := issueSession(t, instance, "user-viewer", "viewer@example.com")
	deleteReq := httptest.NewRequest(http.MethodDelete, "/api/v1/workspaces/"+workspaceID, nil)
	deleteReq.Header.Set("Cookie", viewerCookie)
	deleteRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(deleteRec, deleteReq)

	if deleteRec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-owner delete, got %d: %s", deleteRec.Code, deleteRec.Body.String())
	}
	if !strings.Contains(deleteRec.Body.String(), `"code":"forbidden"`) {
		t.Fatalf("expected forbidden code, got %s", deleteRec.Body.String())
	}
}

func TestControlPlaneUpdateRequiresOwner(t *testing.T) {
	instance := newControlPlaneApp(t)
	ownerCookie := issueSession(t, instance, "user-owner", "owner@example.com")

	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", strings.NewReader(`{"name":"Shared"}`))
	createReq.Header.Set("Cookie", ownerCookie)
	createRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 from create workspace, got %d: %s", createRec.Code, createRec.Body.String())
	}
	workspaceID := extractJSONField(t, createRec.Body.String(), `"id":"`, `"`)

	module := controlPlaneModule(t, instance)
	repo := module.currentRepo()
	if _, err := repo.CreateUser(context.Background(), "user-viewer", map[string]any{
		"email":        "viewer@example.com",
		"display_name": "",
	}); err != nil {
		t.Fatalf("create viewer user: %v", err)
	}
	if _, err := repo.UpdateMemberRole(context.Background(), workspaceID, "user-viewer", "viewer"); err != nil {
		t.Fatalf("add viewer membership: %v", err)
	}

	viewerCookie := issueSession(t, instance, "user-viewer", "viewer@example.com")
	updateReq := httptest.NewRequest(http.MethodPatch, "/api/v1/workspaces/"+workspaceID, strings.NewReader(`{"name":"Nope"}`))
	updateReq.Header.Set("Cookie", viewerCookie)
	updateRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(updateRec, updateReq)

	if updateRec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-owner update, got %d: %s", updateRec.Code, updateRec.Body.String())
	}
	if !strings.Contains(updateRec.Body.String(), `"code":"forbidden"`) {
		t.Fatalf("expected forbidden code, got %s", updateRec.Body.String())
	}
}

func TestControlPlaneFoundationRoutesExposeSnapshotState(t *testing.T) {
	instance := newControlPlaneApp(t)
	cookie := issueSession(t, instance, "user-1", "owner@example.com")

	healthReq := httptest.NewRequest(http.MethodGet, "/api/v1/control-plane/health", nil)
	healthReq.Header.Set("Cookie", cookie)
	healthRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(healthRec, healthReq)
	if healthRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from control-plane health, got %d: %s", healthRec.Code, healthRec.Body.String())
	}
	if !strings.Contains(healthRec.Body.String(), `"storage":"local-json"`) {
		t.Fatalf("expected local-json storage marker, got %s", healthRec.Body.String())
	}
	if !strings.Contains(healthRec.Body.String(), `"workspace_root":"`) {
		t.Fatalf("expected workspace_root in health payload, got %s", healthRec.Body.String())
	}
	if !strings.Contains(healthRec.Body.String(), `"counts":{"`) || !strings.Contains(healthRec.Body.String(), `"users":1`) {
		t.Fatalf("expected nested count payload in health response, got %s", healthRec.Body.String())
	}

	usersReq := httptest.NewRequest(http.MethodGet, "/api/v1/control-plane/users", nil)
	usersReq.Header.Set("Cookie", cookie)
	usersRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(usersRec, usersReq)
	if usersRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from users listing, got %d: %s", usersRec.Code, usersRec.Body.String())
	}
	if !strings.Contains(usersRec.Body.String(), `"count":1`) || !strings.Contains(usersRec.Body.String(), `"user_id":"user-1"`) {
		t.Fatalf("expected seeded user in foundation list, got %s", usersRec.Body.String())
	}

	snapshotReq := httptest.NewRequest(http.MethodGet, "/api/v1/control-plane/snapshot", nil)
	snapshotReq.Header.Set("Cookie", cookie)
	snapshotRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(snapshotRec, snapshotReq)
	if snapshotRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from snapshot, got %d: %s", snapshotRec.Code, snapshotRec.Body.String())
	}
	if !strings.Contains(snapshotRec.Body.String(), `"snapshot":`) || !strings.Contains(snapshotRec.Body.String(), `"workspace_settings"`) {
		t.Fatalf("expected snapshot payload, got %s", snapshotRec.Body.String())
	}
	if strings.Contains(snapshotRec.Body.String(), `"last_seen_at"`) {
		t.Fatalf("expected untouched foundation snapshot before /me, got %s", snapshotRec.Body.String())
	}
}

func newControlPlaneApp(t *testing.T) *app.App {
	t.Helper()

	root := t.TempDir()
	cfg := config.Config{ConfigPath: filepath.Join(root, config.ConfigFile)}
	instance := app.New(cfg)
	module, err := NewModule(cfg)
	if err != nil {
		t.Fatalf("new control-plane module: %v", err)
	}
	instance.SetAuthStateBridge(module)
	instance.AddModule(module)
	return instance
}

func controlPlaneModule(t *testing.T, instance *app.App) *Module {
	t.Helper()
	for _, module := range instance.Modules() {
		if controlPlane, ok := module.(*Module); ok {
			return controlPlane
		}
	}
	t.Fatal("control-plane module not found")
	return nil
}

func issueSession(t *testing.T, instance *app.App, userID, email string) string {
	t.Helper()

	module := controlPlaneModule(t, instance)
	if err := module.OnAuthenticated(context.Background(), auth.User{
		ID:      userID,
		Email:   email,
		IsOwner: true,
	}); err != nil {
		t.Fatalf("seed control-plane auth state: %v", err)
	}

	token, err := instance.SessionManager().Create(auth.User{
		ID:      userID,
		Email:   email,
		IsOwner: true,
	})
	if err != nil {
		t.Fatalf("create session token: %v", err)
	}
	return instance.SessionManager().CookieName() + "=" + token
}

func extractJSONField(t *testing.T, body, prefix, suffix string) string {
	t.Helper()
	start := strings.Index(body, prefix)
	if start < 0 {
		t.Fatalf("prefix %q not found in %s", prefix, body)
	}
	start += len(prefix)
	end := strings.Index(body[start:], suffix)
	if end < 0 {
		t.Fatalf("suffix %q not found in %s", suffix, body[start:])
	}
	return body[start : start+end]
}
