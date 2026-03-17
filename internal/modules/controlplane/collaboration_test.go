package controlplane

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestControlPlaneInviteAcceptListRoleChangeAndRemoveFlow(t *testing.T) {
	instance := newControlPlaneApp(t)
	ownerCookie := issueSession(t, instance, "user-owner", "owner@example.com")

	createWorkspaceReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", strings.NewReader(`{"name":"Shared"}`))
	createWorkspaceReq.Header.Set("Cookie", ownerCookie)
	createWorkspaceRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(createWorkspaceRec, createWorkspaceReq)
	if createWorkspaceRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 from create workspace, got %d: %s", createWorkspaceRec.Code, createWorkspaceRec.Body.String())
	}
	workspaceID := extractJSONField(t, createWorkspaceRec.Body.String(), `"id":"`, `"`)

	createInviteReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/invites", strings.NewReader(`{"email":"editor@example.com","role":"editor"}`))
	createInviteReq.Header.Set("Cookie", ownerCookie)
	createInviteRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(createInviteRec, createInviteReq)
	if createInviteRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from create invite, got %d: %s", createInviteRec.Code, createInviteRec.Body.String())
	}
	inviteID := extractJSONField(t, createInviteRec.Body.String(), `"invite_id":"`, `"`)

	editorCookie := issueSession(t, instance, "user-editor", "editor@example.com")
	acceptReq := httptest.NewRequest(http.MethodPost, "/api/v1/invites/"+inviteID+"/accept", nil)
	acceptReq.Header.Set("Cookie", editorCookie)
	acceptRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(acceptRec, acceptReq)
	if acceptRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from accept invite, got %d: %s", acceptRec.Code, acceptRec.Body.String())
	}
	if !strings.Contains(acceptRec.Body.String(), `"role":"editor"`) {
		t.Fatalf("expected editor membership from accept payload, got %s", acceptRec.Body.String())
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/"+workspaceID+"/members", nil)
	listReq.Header.Set("Cookie", ownerCookie)
	listRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from list members, got %d: %s", listRec.Code, listRec.Body.String())
	}
	if !strings.Contains(listRec.Body.String(), `"count":2`) {
		t.Fatalf("expected two members, got %s", listRec.Body.String())
	}
	if !strings.Contains(listRec.Body.String(), `"user_id":"user-editor"`) {
		t.Fatalf("expected invited member in list, got %s", listRec.Body.String())
	}

	roleReq := httptest.NewRequest(http.MethodPut, "/api/v1/workspaces/"+workspaceID+"/members/user-editor/role", strings.NewReader(`{"role":"viewer"}`))
	roleReq.Header.Set("Cookie", ownerCookie)
	roleRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(roleRec, roleReq)
	if roleRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from update member role, got %d: %s", roleRec.Code, roleRec.Body.String())
	}
	if !strings.Contains(roleRec.Body.String(), `"role":"viewer"`) {
		t.Fatalf("expected viewer role after update, got %s", roleRec.Body.String())
	}

	removeReq := httptest.NewRequest(http.MethodDelete, "/api/v1/workspaces/"+workspaceID+"/members/user-editor", nil)
	removeReq.Header.Set("Cookie", ownerCookie)
	removeRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(removeRec, removeReq)
	if removeRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from remove member, got %d: %s", removeRec.Code, removeRec.Body.String())
	}
	if !strings.Contains(removeRec.Body.String(), `"removed":true`) {
		t.Fatalf("expected removed response, got %s", removeRec.Body.String())
	}

	listAfterReq := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/"+workspaceID+"/members", nil)
	listAfterReq.Header.Set("Cookie", ownerCookie)
	listAfterRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(listAfterRec, listAfterReq)
	if listAfterRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from list members after remove, got %d: %s", listAfterRec.Code, listAfterRec.Body.String())
	}
	if !strings.Contains(listAfterRec.Body.String(), `"count":1`) {
		t.Fatalf("expected only owner to remain, got %s", listAfterRec.Body.String())
	}
}

func TestControlPlaneInviteDeclineMarksInviteDeclined(t *testing.T) {
	instance := newControlPlaneApp(t)
	ownerCookie := issueSession(t, instance, "user-owner", "owner@example.com")

	createWorkspaceReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", strings.NewReader(`{"name":"Decline"}`))
	createWorkspaceReq.Header.Set("Cookie", ownerCookie)
	createWorkspaceRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(createWorkspaceRec, createWorkspaceReq)
	if createWorkspaceRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 from create workspace, got %d: %s", createWorkspaceRec.Code, createWorkspaceRec.Body.String())
	}
	workspaceID := extractJSONField(t, createWorkspaceRec.Body.String(), `"id":"`, `"`)

	createInviteReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/invites", strings.NewReader(`{"email":"viewer@example.com","role":"viewer"}`))
	createInviteReq.Header.Set("Cookie", ownerCookie)
	createInviteRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(createInviteRec, createInviteReq)
	if createInviteRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from create invite, got %d: %s", createInviteRec.Code, createInviteRec.Body.String())
	}
	inviteID := extractJSONField(t, createInviteRec.Body.String(), `"invite_id":"`, `"`)

	viewerCookie := issueSession(t, instance, "user-viewer", "viewer@example.com")
	declineReq := httptest.NewRequest(http.MethodPost, "/api/v1/invites/"+inviteID+"/decline", nil)
	declineReq.Header.Set("Cookie", viewerCookie)
	declineRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(declineRec, declineReq)
	if declineRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from decline invite, got %d: %s", declineRec.Code, declineRec.Body.String())
	}
	if !strings.Contains(declineRec.Body.String(), `"status":"declined"`) {
		t.Fatalf("expected declined invite status, got %s", declineRec.Body.String())
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/"+workspaceID+"/members", nil)
	listReq.Header.Set("Cookie", ownerCookie)
	listRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from list members after decline, got %d: %s", listRec.Code, listRec.Body.String())
	}
	if !strings.Contains(listRec.Body.String(), `"count":1`) {
		t.Fatalf("expected only owner after decline, got %s", listRec.Body.String())
	}
}

func TestControlPlaneOwnerAndSelfRemovalGuards(t *testing.T) {
	instance := newControlPlaneApp(t)
	ownerCookie := issueSession(t, instance, "user-owner", "owner@example.com")

	createWorkspaceReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", strings.NewReader(`{"name":"Guards"}`))
	createWorkspaceReq.Header.Set("Cookie", ownerCookie)
	createWorkspaceRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(createWorkspaceRec, createWorkspaceReq)
	if createWorkspaceRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 from create workspace, got %d: %s", createWorkspaceRec.Code, createWorkspaceRec.Body.String())
	}
	workspaceID := extractJSONField(t, createWorkspaceRec.Body.String(), `"id":"`, `"`)

	createInviteReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/invites", strings.NewReader(`{"email":"editor@example.com","role":"editor"}`))
	createInviteReq.Header.Set("Cookie", ownerCookie)
	createInviteRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(createInviteRec, createInviteReq)
	if createInviteRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from create invite, got %d: %s", createInviteRec.Code, createInviteRec.Body.String())
	}
	inviteID := extractJSONField(t, createInviteRec.Body.String(), `"invite_id":"`, `"`)

	editorCookie := issueSession(t, instance, "user-editor", "editor@example.com")
	acceptReq := httptest.NewRequest(http.MethodPost, "/api/v1/invites/"+inviteID+"/accept", nil)
	acceptReq.Header.Set("Cookie", editorCookie)
	acceptRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(acceptRec, acceptReq)
	if acceptRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from accept invite, got %d: %s", acceptRec.Code, acceptRec.Body.String())
	}

	editorRoleReq := httptest.NewRequest(http.MethodPut, "/api/v1/workspaces/"+workspaceID+"/members/user-owner/role", strings.NewReader(`{"role":"viewer"}`))
	editorRoleReq.Header.Set("Cookie", editorCookie)
	editorRoleRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(editorRoleRec, editorRoleReq)
	if editorRoleRec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 from editor role update, got %d: %s", editorRoleRec.Code, editorRoleRec.Body.String())
	}
	if !strings.Contains(editorRoleRec.Body.String(), `"code":"ROLE_REQUIRED_OWNER"`) {
		t.Fatalf("expected owner-required code, got %s", editorRoleRec.Body.String())
	}

	selfRoleReq := httptest.NewRequest(http.MethodPut, "/api/v1/workspaces/"+workspaceID+"/members/user-owner/role", strings.NewReader(`{"role":"viewer"}`))
	selfRoleReq.Header.Set("Cookie", ownerCookie)
	selfRoleRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(selfRoleRec, selfRoleReq)
	if selfRoleRec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 from self role change, got %d: %s", selfRoleRec.Code, selfRoleRec.Body.String())
	}
	if !strings.Contains(selfRoleRec.Body.String(), `"code":"CANNOT_CHANGE_OWN_ROLE"`) {
		t.Fatalf("expected self-role-change code, got %s", selfRoleRec.Body.String())
	}

	selfRemoveReq := httptest.NewRequest(http.MethodDelete, "/api/v1/workspaces/"+workspaceID+"/members/user-owner", nil)
	selfRemoveReq.Header.Set("Cookie", ownerCookie)
	selfRemoveRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(selfRemoveRec, selfRemoveReq)
	if selfRemoveRec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 from self-removal, got %d: %s", selfRemoveRec.Code, selfRemoveRec.Body.String())
	}
	if !strings.Contains(selfRemoveRec.Body.String(), `"code":"CANNOT_REMOVE_SELF"`) {
		t.Fatalf("expected self-removal code, got %s", selfRemoveRec.Body.String())
	}
}

func TestControlPlaneCreateInviteRejectsInvalidExpiry(t *testing.T) {
	instance := newControlPlaneApp(t)
	ownerCookie := issueSession(t, instance, "user-owner", "owner@example.com")

	createWorkspaceReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", strings.NewReader(`{"name":"Expiry"}`))
	createWorkspaceReq.Header.Set("Cookie", ownerCookie)
	createWorkspaceRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(createWorkspaceRec, createWorkspaceReq)
	if createWorkspaceRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 from create workspace, got %d: %s", createWorkspaceRec.Code, createWorkspaceRec.Body.String())
	}
	workspaceID := extractJSONField(t, createWorkspaceRec.Body.String(), `"id":"`, `"`)

	createInviteReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/invites", strings.NewReader(`{"email":"viewer@example.com","expires_at":"tomorrow"}`))
	createInviteReq.Header.Set("Cookie", ownerCookie)
	createInviteRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(createInviteRec, createInviteReq)
	if createInviteRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 from invalid invite expiry, got %d: %s", createInviteRec.Code, createInviteRec.Body.String())
	}
	if !strings.Contains(createInviteRec.Body.String(), `"code":"INVALID_INVITE_EXPIRY"`) {
		t.Fatalf("expected invalid expiry code, got %s", createInviteRec.Body.String())
	}
}

func TestControlPlaneEditorCannotInviteOwner(t *testing.T) {
	instance := newControlPlaneApp(t)
	ownerCookie := issueSession(t, instance, "user-owner", "owner@example.com")

	createWorkspaceReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", strings.NewReader(`{"name":"OwnerInviteGuard"}`))
	createWorkspaceReq.Header.Set("Cookie", ownerCookie)
	createWorkspaceRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(createWorkspaceRec, createWorkspaceReq)
	if createWorkspaceRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 from create workspace, got %d: %s", createWorkspaceRec.Code, createWorkspaceRec.Body.String())
	}
	workspaceID := extractJSONField(t, createWorkspaceRec.Body.String(), `"id":"`, `"`)

	createEditorInviteReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/invites", strings.NewReader(`{"email":"editor@example.com","role":"editor"}`))
	createEditorInviteReq.Header.Set("Cookie", ownerCookie)
	createEditorInviteRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(createEditorInviteRec, createEditorInviteReq)
	if createEditorInviteRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from create editor invite, got %d: %s", createEditorInviteRec.Code, createEditorInviteRec.Body.String())
	}
	editorInviteID := extractJSONField(t, createEditorInviteRec.Body.String(), `"invite_id":"`, `"`)

	editorCookie := issueSession(t, instance, "user-editor", "editor@example.com")
	acceptReq := httptest.NewRequest(http.MethodPost, "/api/v1/invites/"+editorInviteID+"/accept", nil)
	acceptReq.Header.Set("Cookie", editorCookie)
	acceptRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(acceptRec, acceptReq)
	if acceptRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from editor invite accept, got %d: %s", acceptRec.Code, acceptRec.Body.String())
	}

	createOwnerInviteReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/invites", strings.NewReader(`{"email":"new-owner@example.com","role":"owner"}`))
	createOwnerInviteReq.Header.Set("Cookie", editorCookie)
	createOwnerInviteRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(createOwnerInviteRec, createOwnerInviteReq)
	if createOwnerInviteRec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 from editor owner invite, got %d: %s", createOwnerInviteRec.Code, createOwnerInviteRec.Body.String())
	}
	if !strings.Contains(createOwnerInviteRec.Body.String(), `"code":"ROLE_REQUIRED_OWNER"`) {
		t.Fatalf("expected owner-required code, got %s", createOwnerInviteRec.Body.String())
	}
}

func TestControlPlaneListMembersHidesWorkspaceFromNonMembers(t *testing.T) {
	instance := newControlPlaneApp(t)
	ownerCookie := issueSession(t, instance, "user-owner", "owner@example.com")

	createWorkspaceReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", strings.NewReader(`{"name":"Hidden"}`))
	createWorkspaceReq.Header.Set("Cookie", ownerCookie)
	createWorkspaceRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(createWorkspaceRec, createWorkspaceReq)
	if createWorkspaceRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 from create workspace, got %d: %s", createWorkspaceRec.Code, createWorkspaceRec.Body.String())
	}
	workspaceID := extractJSONField(t, createWorkspaceRec.Body.String(), `"id":"`, `"`)

	outsiderCookie := issueSession(t, instance, "user-outsider", "outsider@example.com")
	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/"+workspaceID+"/members", nil)
	listReq.Header.Set("Cookie", outsiderCookie)
	listRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 from outsider member list, got %d: %s", listRec.Code, listRec.Body.String())
	}
	if !strings.Contains(listRec.Body.String(), `"code":"not_found"`) {
		t.Fatalf("expected not_found code, got %s", listRec.Body.String())
	}
}

func TestControlPlaneWriteEndpointsHideWorkspaceFromNonMembers(t *testing.T) {
	instance := newControlPlaneApp(t)
	ownerCookie := issueSession(t, instance, "user-owner", "owner@example.com")

	createWorkspaceReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", strings.NewReader(`{"name":"HiddenWrites"}`))
	createWorkspaceReq.Header.Set("Cookie", ownerCookie)
	createWorkspaceRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(createWorkspaceRec, createWorkspaceReq)
	if createWorkspaceRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 from create workspace, got %d: %s", createWorkspaceRec.Code, createWorkspaceRec.Body.String())
	}
	workspaceID := extractJSONField(t, createWorkspaceRec.Body.String(), `"id":"`, `"`)

	createInviteReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/invites", strings.NewReader(`{"email":"viewer@example.com","role":"viewer"}`))
	createInviteReq.Header.Set("Cookie", ownerCookie)
	createInviteRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(createInviteRec, createInviteReq)
	if createInviteRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from create invite, got %d: %s", createInviteRec.Code, createInviteRec.Body.String())
	}
	inviteID := extractJSONField(t, createInviteRec.Body.String(), `"invite_id":"`, `"`)

	viewerCookie := issueSession(t, instance, "user-viewer", "viewer@example.com")
	acceptReq := httptest.NewRequest(http.MethodPost, "/api/v1/invites/"+inviteID+"/accept", nil)
	acceptReq.Header.Set("Cookie", viewerCookie)
	acceptRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(acceptRec, acceptReq)
	if acceptRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from invite accept, got %d: %s", acceptRec.Code, acceptRec.Body.String())
	}

	outsiderCookie := issueSession(t, instance, "user-outsider", "outsider@example.com")

	outsiderInviteReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/invites", strings.NewReader(`{"email":"other@example.com","role":"viewer"}`))
	outsiderInviteReq.Header.Set("Cookie", outsiderCookie)
	outsiderInviteRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(outsiderInviteRec, outsiderInviteReq)
	if outsiderInviteRec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 from outsider invite create, got %d: %s", outsiderInviteRec.Code, outsiderInviteRec.Body.String())
	}
	if !strings.Contains(outsiderInviteRec.Body.String(), `"code":"not_found"`) {
		t.Fatalf("expected not_found code from outsider invite create, got %s", outsiderInviteRec.Body.String())
	}

	outsiderRoleReq := httptest.NewRequest(http.MethodPut, "/api/v1/workspaces/"+workspaceID+"/members/user-viewer/role", strings.NewReader(`{"role":"viewer"}`))
	outsiderRoleReq.Header.Set("Cookie", outsiderCookie)
	outsiderRoleRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(outsiderRoleRec, outsiderRoleReq)
	if outsiderRoleRec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 from outsider role update, got %d: %s", outsiderRoleRec.Code, outsiderRoleRec.Body.String())
	}
	if !strings.Contains(outsiderRoleRec.Body.String(), `"code":"not_found"`) {
		t.Fatalf("expected not_found code from outsider role update, got %s", outsiderRoleRec.Body.String())
	}

	outsiderRemoveReq := httptest.NewRequest(http.MethodDelete, "/api/v1/workspaces/"+workspaceID+"/members/user-viewer", nil)
	outsiderRemoveReq.Header.Set("Cookie", outsiderCookie)
	outsiderRemoveRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(outsiderRemoveRec, outsiderRemoveReq)
	if outsiderRemoveRec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 from outsider remove member, got %d: %s", outsiderRemoveRec.Code, outsiderRemoveRec.Body.String())
	}
	if !strings.Contains(outsiderRemoveRec.Body.String(), `"code":"not_found"`) {
		t.Fatalf("expected not_found code from outsider remove member, got %s", outsiderRemoveRec.Body.String())
	}
}

func TestControlPlaneInviteAcceptRejectsCorruptExpiryAndEmailMismatch(t *testing.T) {
	instance := newControlPlaneApp(t)
	ownerCookie := issueSession(t, instance, "user-owner", "owner@example.com")

	createWorkspaceReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", strings.NewReader(`{"name":"InviteGuards"}`))
	createWorkspaceReq.Header.Set("Cookie", ownerCookie)
	createWorkspaceRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(createWorkspaceRec, createWorkspaceReq)
	if createWorkspaceRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 from create workspace, got %d: %s", createWorkspaceRec.Code, createWorkspaceRec.Body.String())
	}
	workspaceID := extractJSONField(t, createWorkspaceRec.Body.String(), `"id":"`, `"`)

	module := controlPlaneModule(t, instance)
	repo := module.currentRepo()
	if _, err := repo.CreateInvite(
		context.Background(),
		"inv-corrupt-expiry",
		map[string]any{
			"workspace_id":       workspaceID,
			"email":              "target@example.com",
			"role":               "viewer",
			"status":             "pending",
			"created_by_user_id": "user-owner",
			"expires_at":         "not-a-timestamp",
		},
	); err != nil {
		t.Fatalf("seed corrupt invite: %v", err)
	}

	targetCookie := issueSession(t, instance, "user-target", "target@example.com")
	corruptAcceptReq := httptest.NewRequest(http.MethodPost, "/api/v1/invites/inv-corrupt-expiry/accept", nil)
	corruptAcceptReq.Header.Set("Cookie", targetCookie)
	corruptAcceptRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(corruptAcceptRec, corruptAcceptReq)
	if corruptAcceptRec.Code != http.StatusGone {
		t.Fatalf("expected 410 from corrupt expiry invite, got %d: %s", corruptAcceptRec.Code, corruptAcceptRec.Body.String())
	}
	if !strings.Contains(corruptAcceptRec.Body.String(), `"code":"INVITE_EXPIRED"`) {
		t.Fatalf("expected invite expired code, got %s", corruptAcceptRec.Body.String())
	}

	createInviteReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/"+workspaceID+"/invites", strings.NewReader(`{"email":"match@example.com","role":"viewer"}`))
	createInviteReq.Header.Set("Cookie", ownerCookie)
	createInviteRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(createInviteRec, createInviteReq)
	if createInviteRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from create invite, got %d: %s", createInviteRec.Code, createInviteRec.Body.String())
	}
	inviteID := extractJSONField(t, createInviteRec.Body.String(), `"invite_id":"`, `"`)

	wrongCookie := issueSession(t, instance, "user-wrong", "wrong@example.com")
	wrongAcceptReq := httptest.NewRequest(http.MethodPost, "/api/v1/invites/"+inviteID+"/accept", nil)
	wrongAcceptReq.Header.Set("Cookie", wrongCookie)
	wrongAcceptRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(wrongAcceptRec, wrongAcceptReq)
	if wrongAcceptRec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 from wrong-email invite accept, got %d: %s", wrongAcceptRec.Code, wrongAcceptRec.Body.String())
	}
	if !strings.Contains(wrongAcceptRec.Body.String(), `"code":"INVITE_NOT_FOUND"`) {
		t.Fatalf("expected invite not found code, got %s", wrongAcceptRec.Body.String())
	}

	targetAcceptReq := httptest.NewRequest(http.MethodPost, "/api/v1/invites/"+inviteID+"/accept", nil)
	targetAcceptReq.Header.Set("Cookie", issueSession(t, instance, "user-match", "match@example.com"))
	targetAcceptRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(targetAcceptRec, targetAcceptReq)
	if targetAcceptRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from matching invite accept, got %d: %s", targetAcceptRec.Code, targetAcceptRec.Body.String())
	}

	wrongAcceptedReq := httptest.NewRequest(http.MethodPost, "/api/v1/invites/"+inviteID+"/accept", nil)
	wrongAcceptedReq.Header.Set("Cookie", wrongCookie)
	wrongAcceptedRec := httptest.NewRecorder()
	instance.Handler().ServeHTTP(wrongAcceptedRec, wrongAcceptedReq)
	if wrongAcceptedRec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 from wrong-email accepted invite, got %d: %s", wrongAcceptedRec.Code, wrongAcceptedRec.Body.String())
	}
	if !strings.Contains(wrongAcceptedRec.Body.String(), `"code":"INVITE_NOT_FOUND"`) {
		t.Fatalf("expected invite not found code after accept, got %s", wrongAcceptedRec.Body.String())
	}
}
