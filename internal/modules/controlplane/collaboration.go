package controlplane

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/boringdata/boring-ui/internal/app"
)

const defaultInviteExpiry = 7 * 24 * time.Hour

func (m *Module) handleListMembers(w http.ResponseWriter, req *http.Request) {
	authCtx, repo := m.requireSessionAndRepo(req)
	workspaceID := m.requireWorkspaceID(req)

	if !m.userHasMembership(req.Context(), repo, workspaceID, authCtx.UserID) {
		panic(app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: "Workspace not found"})
	}

	members, err := repo.ListMembers(req.Context(), workspaceID)
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"members": members,
		"count":   len(members),
	})
}

func (m *Module) handleCreateInvite(w http.ResponseWriter, req *http.Request) {
	authCtx, repo := m.requireSessionAndRepo(req)
	workspaceID := m.requireWorkspaceID(req)

	role, found, err := m.workspaceRoleForUser(req.Context(), repo, workspaceID, authCtx.UserID)
	if err != nil {
		panic(err)
	}
	if !found {
		panic(app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: "Workspace not found"})
	}
	if role != "owner" && role != "editor" {
		panic(app.APIError{Status: http.StatusForbidden, Code: "ROLE_REQUIRED_EDITOR", Message: "Owner or editor role required"})
	}
	m.requireWorkspace(req.Context(), repo, workspaceID)

	var body map[string]any
	if err := decodeJSON(req, &body); err != nil && !errors.Is(err, io.EOF) {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "INVALID_JSON", Message: err.Error()})
	}

	email := strings.ToLower(strings.TrimSpace(asString(body["email"])))
	if email == "" {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "INVITE_EMAIL_REQUIRED", Message: "email is required"})
	}
	requestedRole := normalizeRole(asString(body["role"]), "editor")
	if requestedRole == "owner" && role != "owner" {
		panic(app.APIError{Status: http.StatusForbidden, Code: "ROLE_REQUIRED_OWNER", Message: "Owner role required to invite owners"})
	}

	inviteID := strings.TrimSpace(asString(body["invite_id"]))
	if inviteID == "" {
		inviteID = "inv-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:8]
	}
	expiresAt := strings.TrimSpace(asString(body["expires_at"]))
	if expiresAt == "" {
		expiresAt = nowISO(m.now().Add(defaultInviteExpiry))
	}
	expiry, ok := parseInviteExpiry(expiresAt)
	if !ok {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "INVALID_INVITE_EXPIRY", Message: "expires_at must be RFC3339"})
	}

	invite, err := repo.CreateInvite(req.Context(), inviteID, map[string]any{
		"workspace_id":       workspaceID,
		"email":              email,
		"role":               requestedRole,
		"status":             "pending",
		"created_by_user_id": authCtx.UserID,
		"expires_at":         nowISO(expiry),
	})
	if err != nil {
		panic(err)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"invite": m.normalizeInvite(invite),
	})
}

func (m *Module) handleAcceptInvite(w http.ResponseWriter, req *http.Request) {
	m.handleInviteDecision(w, req, false, true)
}

func (m *Module) handleAcceptInviteScoped(w http.ResponseWriter, req *http.Request) {
	m.handleInviteDecision(w, req, true, true)
}

func (m *Module) handleDeclineInvite(w http.ResponseWriter, req *http.Request) {
	m.handleInviteDecision(w, req, false, false)
}

func (m *Module) handleDeclineInviteScoped(w http.ResponseWriter, req *http.Request) {
	m.handleInviteDecision(w, req, true, false)
}

func (m *Module) handleUpdateMemberRole(w http.ResponseWriter, req *http.Request) {
	authCtx, repo := m.requireSessionAndRepo(req)
	workspaceID := m.requireWorkspaceID(req)
	targetUserID := strings.TrimSpace(app.URLParam(req, "userID"))
	if targetUserID == "" {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "INVALID_MEMBER_USER_ID", Message: "user_id is required"})
	}

	role, found, err := m.workspaceRoleForUser(req.Context(), repo, workspaceID, authCtx.UserID)
	if err != nil {
		panic(err)
	}
	if !found {
		panic(app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: "Workspace not found"})
	}
	if role != "owner" {
		panic(app.APIError{Status: http.StatusForbidden, Code: "ROLE_REQUIRED_OWNER", Message: "Owner role required"})
	}
	m.requireWorkspace(req.Context(), repo, workspaceID)

	member, found, err := m.findMember(req.Context(), repo, workspaceID, targetUserID)
	if err != nil {
		panic(err)
	}
	if !found {
		panic(app.APIError{Status: http.StatusNotFound, Code: "MEMBER_NOT_FOUND", Message: "Member not found"})
	}

	var body map[string]any
	if err := decodeJSON(req, &body); err != nil && !errors.Is(err, io.EOF) {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "INVALID_JSON", Message: err.Error()})
	}

	newRole := normalizeRole(asString(body["role"]), strings.TrimSpace(asString(member["role"])))
	if targetUserID == strings.TrimSpace(authCtx.UserID) && strings.TrimSpace(asString(member["role"])) == "owner" && newRole != "owner" {
		panic(app.APIError{Status: http.StatusForbidden, Code: "CANNOT_CHANGE_OWN_ROLE", Message: "Owners cannot change their own role"})
	}

	updated, err := repo.UpdateMemberRole(req.Context(), workspaceID, targetUserID, newRole)
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"member": updated,
	})
}

func (m *Module) handleRemoveMember(w http.ResponseWriter, req *http.Request) {
	authCtx, repo := m.requireSessionAndRepo(req)
	workspaceID := m.requireWorkspaceID(req)
	targetUserID := strings.TrimSpace(app.URLParam(req, "userID"))
	if targetUserID == "" {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "INVALID_MEMBER_USER_ID", Message: "user_id is required"})
	}

	role, found, err := m.workspaceRoleForUser(req.Context(), repo, workspaceID, authCtx.UserID)
	if err != nil {
		panic(err)
	}
	if !found {
		panic(app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: "Workspace not found"})
	}
	if role != "owner" {
		panic(app.APIError{Status: http.StatusForbidden, Code: "ROLE_REQUIRED_OWNER", Message: "Owner role required"})
	}
	m.requireWorkspace(req.Context(), repo, workspaceID)
	if strings.TrimSpace(authCtx.UserID) == targetUserID {
		panic(app.APIError{Status: http.StatusForbidden, Code: "CANNOT_REMOVE_SELF", Message: "Owners cannot remove themselves"})
	}

	removed, err := repo.RemoveMember(req.Context(), workspaceID, targetUserID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			panic(app.APIError{Status: http.StatusNotFound, Code: "MEMBER_NOT_FOUND", Message: "Member not found"})
		}
		panic(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"removed": true,
		"member":  removed,
	})
}

func (m *Module) handleInviteDecision(w http.ResponseWriter, req *http.Request, scoped bool, accept bool) {
	authCtx, repo := m.requireSessionAndRepo(req)
	inviteID := strings.TrimSpace(app.URLParam(req, "inviteID"))
	if inviteID == "" {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "INVALID_INVITE_ID", Message: "invite_id is required"})
	}

	pathWorkspaceID := strings.TrimSpace(app.URLParam(req, "workspaceID"))
	invite, found, err := m.findInvite(req.Context(), repo, inviteID)
	if err != nil {
		panic(err)
	}
	if !found {
		panic(app.APIError{Status: http.StatusNotFound, Code: "INVITE_NOT_FOUND", Message: "Invite not found"})
	}

	workspaceID := strings.TrimSpace(asString(invite["workspace_id"]))
	if scoped && pathWorkspaceID != "" && pathWorkspaceID != workspaceID {
		panic(app.APIError{Status: http.StatusNotFound, Code: "INVITE_NOT_FOUND", Message: "Invite not found"})
	}
	m.requireWorkspace(req.Context(), repo, workspaceID)

	if strings.ToLower(strings.TrimSpace(asString(invite["email"]))) != strings.ToLower(strings.TrimSpace(authCtx.Email)) {
		panic(app.APIError{Status: http.StatusNotFound, Code: "INVITE_NOT_FOUND", Message: "Invite not found"})
	}
	if normalizeRole(asString(invite["role"]), "viewer") == "owner" {
		creatorRole, creatorFound, err := m.workspaceRoleForUser(req.Context(), repo, workspaceID, asString(invite["created_by_user_id"]))
		if err != nil {
			panic(err)
		}
		if !creatorFound || creatorRole != "owner" {
			panic(app.APIError{Status: http.StatusForbidden, Code: "ROLE_REQUIRED_OWNER", Message: "Owner role required to invite owners"})
		}
	}
	if strings.TrimSpace(asString(invite["accepted_at"])) != "" {
		panic(app.APIError{Status: http.StatusConflict, Code: "INVITE_ALREADY_ACCEPTED", Message: "Invite has already been accepted"})
	}
	if expiresAt := strings.TrimSpace(asString(invite["expires_at"])); expiresAt != "" {
		expiry, ok := parseInviteExpiry(expiresAt)
		if !ok || !expiry.After(m.now()) {
			panic(app.APIError{Status: http.StatusGone, Code: "INVITE_EXPIRED", Message: "Invite has expired"})
		}
	}

	if accept {
		existingRole, hadExistingRole, err := m.workspaceRoleForUser(req.Context(), repo, workspaceID, authCtx.UserID)
		if err != nil {
			panic(err)
		}

		updatedInvite, member, err := repo.AcceptInvite(req.Context(), workspaceID, inviteID, authCtx.UserID, authCtx.Email)
		if err != nil {
			if errors.Is(err, ErrInviteEmail) {
				panic(app.APIError{Status: http.StatusNotFound, Code: "INVITE_NOT_FOUND", Message: "Invite not found"})
			}
			if errors.Is(err, ErrNotFound) {
				panic(app.APIError{Status: http.StatusNotFound, Code: "INVITE_NOT_FOUND", Message: "Invite not found"})
			}
			panic(err)
		}

		if hadExistingRole && roleRank(existingRole) > roleRank(asString(member["role"])) {
			member, err = repo.UpdateMemberRole(req.Context(), workspaceID, authCtx.UserID, existingRole)
			if err != nil {
				panic(err)
			}
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"ok":         true,
			"invite":     m.normalizeInvite(updatedInvite),
			"membership": member,
		})
		return
	}

	updatedInvite, err := repo.DeclineInvite(req.Context(), workspaceID, inviteID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			panic(app.APIError{Status: http.StatusNotFound, Code: "INVITE_NOT_FOUND", Message: "Invite not found"})
		}
		panic(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"invite": m.normalizeInvite(updatedInvite),
	})
}

func (m *Module) requireWorkspaceID(req *http.Request) string {
	workspaceID := strings.TrimSpace(app.URLParam(req, "workspaceID"))
	if workspaceID == "" {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_workspace_id", Message: "workspace_id is required"})
	}
	return workspaceID
}

func (m *Module) requireWorkspace(ctx context.Context, repo Repository, workspaceID string) map[string]any {
	workspace, err := repo.GetWorkspace(ctx, workspaceID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			panic(app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: "Workspace not found"})
		}
		panic(err)
	}
	return workspace
}

func (m *Module) findInvite(ctx context.Context, repo Repository, inviteID string) (map[string]any, bool, error) {
	id, err := normalizeID(inviteID)
	if err != nil {
		return nil, false, err
	}
	snapshot, err := repo.Snapshot(ctx)
	if err != nil {
		return nil, false, err
	}
	record, ok := stateFromMap(snapshot).Invites[id]
	if !ok || record["deleted_at"] != nil {
		return nil, false, nil
	}
	return cloneMap(record), true, nil
}

func (m *Module) findMember(ctx context.Context, repo Repository, workspaceID, userID string) (map[string]any, bool, error) {
	members, err := repo.ListMembers(ctx, workspaceID)
	if err != nil {
		return nil, false, err
	}
	for _, member := range members {
		if strings.TrimSpace(asString(member["user_id"])) == strings.TrimSpace(userID) {
			return cloneMap(member), true, nil
		}
	}
	return nil, false, nil
}

func (m *Module) normalizeInvite(invite map[string]any) map[string]any {
	normalized := cloneMap(invite)
	if strings.TrimSpace(asString(normalized["id"])) == "" {
		normalized["id"] = strings.TrimSpace(asString(normalized["invite_id"]))
	}
	return normalized
}

func parseInviteExpiry(raw string) (time.Time, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return time.Time{}, false
	}
	parsed, err := time.Parse(time.RFC3339Nano, trimmed)
	if err != nil {
		return time.Time{}, false
	}
	return parsed, true
}

func roleRank(role string) int {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "owner":
		return 3
	case "editor":
		return 2
	case "viewer":
		return 1
	default:
		return 0
	}
}
