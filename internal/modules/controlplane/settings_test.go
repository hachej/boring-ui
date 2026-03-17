package controlplane

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestControlPlaneMeAndWorkspaceSettingsFlow(t *testing.T) {
	instance := newControlPlaneApp(t)
	cookie := issueSession(t, instance, "user-1", "owner@example.com")

	getMeReq := httptest.NewRequest(http.MethodGet, "/api/v1/me/settings", nil)
	getMeReq.Header.Set("Cookie", cookie)
	getMeRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(getMeRec, getMeReq)
	if getMeRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from get me settings, got %d: %s", getMeRec.Code, getMeRec.Body.String())
	}
	if !strings.Contains(getMeRec.Body.String(), `"settings":{}`) {
		t.Fatalf("expected empty me settings, got %s", getMeRec.Body.String())
	}

	putMeReq := httptest.NewRequest(http.MethodPut, "/api/v1/me/settings", strings.NewReader(`{"display_name":"Owner Updated","github_default_installation_id":"321"}`))
	putMeReq.Header.Set("Cookie", cookie)
	putMeRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(putMeRec, putMeReq)
	if putMeRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from put me settings, got %d: %s", putMeRec.Code, putMeRec.Body.String())
	}
	if !strings.Contains(putMeRec.Body.String(), `"github_default_installation_id":"321"`) {
		t.Fatalf("expected saved default installation id, got %s", putMeRec.Body.String())
	}

	createWorkspaceReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", strings.NewReader(`{"name":"Settings"}`))
	createWorkspaceReq.Header.Set("Cookie", cookie)
	createWorkspaceRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(createWorkspaceRec, createWorkspaceReq)
	if createWorkspaceRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 from create workspace, got %d: %s", createWorkspaceRec.Code, createWorkspaceRec.Body.String())
	}
	workspaceID := extractJSONField(t, createWorkspaceRec.Body.String(), `"id":"`, `"`)

	getWorkspaceReq := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/"+workspaceID+"/settings", nil)
	getWorkspaceReq.Header.Set("Cookie", cookie)
	getWorkspaceRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(getWorkspaceRec, getWorkspaceReq)
	if getWorkspaceRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from get workspace settings, got %d: %s", getWorkspaceRec.Code, getWorkspaceRec.Body.String())
	}
	if !strings.Contains(getWorkspaceRec.Body.String(), `"github_installation_id":"321"`) {
		t.Fatalf("expected inherited github installation id, got %s", getWorkspaceRec.Body.String())
	}

	putWorkspaceReq := httptest.NewRequest(http.MethodPut, "/api/v1/workspaces/"+workspaceID+"/settings", strings.NewReader(`{"theme":"dark"}`))
	putWorkspaceReq.Header.Set("Cookie", cookie)
	putWorkspaceRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(putWorkspaceRec, putWorkspaceReq)
	if putWorkspaceRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from put workspace settings, got %d: %s", putWorkspaceRec.Code, putWorkspaceRec.Body.String())
	}
	if !strings.Contains(putWorkspaceRec.Body.String(), `"theme":"dark"`) {
		t.Fatalf("expected saved workspace theme, got %s", putWorkspaceRec.Body.String())
	}
	if !strings.Contains(putWorkspaceRec.Body.String(), `"github_installation_id":"321"`) {
		t.Fatalf("expected inherited github installation id to remain, got %s", putWorkspaceRec.Body.String())
	}
}

func TestControlPlaneBoundarySettingsRequireMembership(t *testing.T) {
	instance := newControlPlaneApp(t)
	ownerCookie := issueSession(t, instance, "user-owner", "owner@example.com")

	createWorkspaceReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", strings.NewReader(`{"name":"Boundary"}`))
	createWorkspaceReq.Header.Set("Cookie", ownerCookie)
	createWorkspaceRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(createWorkspaceRec, createWorkspaceReq)
	if createWorkspaceRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 from create workspace, got %d: %s", createWorkspaceRec.Code, createWorkspaceRec.Body.String())
	}
	workspaceID := extractJSONField(t, createWorkspaceRec.Body.String(), `"id":"`, `"`)

	boundaryPutReq := httptest.NewRequest(http.MethodPut, "/w/"+workspaceID+"/settings", strings.NewReader(`{"env":"staging"}`))
	boundaryPutReq.Header.Set("Cookie", ownerCookie)
	boundaryPutRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(boundaryPutRec, boundaryPutReq)
	if boundaryPutRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from boundary put settings, got %d: %s", boundaryPutRec.Code, boundaryPutRec.Body.String())
	}

	canonicalGetReq := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/"+workspaceID+"/settings", nil)
	canonicalGetReq.Header.Set("Cookie", ownerCookie)
	canonicalGetRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(canonicalGetRec, canonicalGetReq)
	if canonicalGetRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from canonical get settings, got %d: %s", canonicalGetRec.Code, canonicalGetRec.Body.String())
	}
	if !strings.Contains(canonicalGetRec.Body.String(), `"env":"staging"`) {
		t.Fatalf("expected boundary write to persist, got %s", canonicalGetRec.Body.String())
	}

	unauthReq := httptest.NewRequest(http.MethodGet, "/w/"+workspaceID+"/settings", nil)
	unauthRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(unauthRec, unauthReq)
	if unauthRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 from boundary without auth, got %d: %s", unauthRec.Code, unauthRec.Body.String())
	}

	outsiderCookie := issueSession(t, instance, "user-outsider", "outsider@example.com")
	outsiderReq := httptest.NewRequest(http.MethodGet, "/w/"+workspaceID+"/settings", nil)
	outsiderReq.Header.Set("Cookie", outsiderCookie)
	outsiderRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(outsiderRec, outsiderReq)
	if outsiderRec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 from boundary outsider access, got %d: %s", outsiderRec.Code, outsiderRec.Body.String())
	}
	if !strings.Contains(outsiderRec.Body.String(), `"code":"not_found"`) {
		t.Fatalf("expected not_found code from boundary outsider access, got %s", outsiderRec.Body.String())
	}
}
