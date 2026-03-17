package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	localStateFilePath = ".boring/local_db.json"
	defaultAppID       = "boring-ui"
	memberStatusActive = "active"
)

var (
	ErrNotFound    = errors.New("control-plane record not found")
	ErrInvalidID   = errors.New("control-plane record id is required")
	ErrInviteEmail = errors.New("control-plane invite email mismatch")
)

var validRoles = map[string]struct{}{
	"owner":  {},
	"editor": {},
	"viewer": {},
}

type Repository interface {
	Snapshot(ctx context.Context) (map[string]any, error)
	CreateUser(ctx context.Context, userID string, payload map[string]any) (map[string]any, error)
	GetUser(ctx context.Context, userID string) (map[string]any, error)
	CreateWorkspace(ctx context.Context, workspaceID string, payload map[string]any) (map[string]any, error)
	GetWorkspace(ctx context.Context, workspaceID string) (map[string]any, error)
	UpdateWorkspace(ctx context.Context, workspaceID string, patch map[string]any) (map[string]any, error)
	ListWorkspaces(ctx context.Context, userID string) ([]map[string]any, error)
	SoftDeleteWorkspace(ctx context.Context, workspaceID string) (map[string]any, error)
	CreateInvite(ctx context.Context, inviteID string, payload map[string]any) (map[string]any, error)
	AcceptInvite(ctx context.Context, workspaceID, inviteID, userID, email string) (map[string]any, map[string]any, error)
	DeclineInvite(ctx context.Context, workspaceID, inviteID string) (map[string]any, error)
	ListMembers(ctx context.Context, workspaceID string) ([]map[string]any, error)
	UpdateMemberRole(ctx context.Context, workspaceID, userID, role string) (map[string]any, error)
	RemoveMember(ctx context.Context, workspaceID, userID string) (map[string]any, error)
	GetSettings(ctx context.Context, userID string) (map[string]any, error)
	SaveSettings(ctx context.Context, userID, email string, patch map[string]any) (map[string]any, error)
	GetWorkspaceRuntime(ctx context.Context, workspaceID string) (map[string]any, error)
	SaveWorkspaceRuntime(ctx context.Context, workspaceID string, patch map[string]any) (map[string]any, error)
	GetWorkspaceSettings(ctx context.Context, workspaceID string) (map[string]any, error)
	SaveWorkspaceSettings(ctx context.Context, workspaceID string, patch map[string]any) (map[string]any, error)
}

type stateSnapshot struct {
	Users             map[string]map[string]any `json:"users"`
	Workspaces        map[string]map[string]any `json:"workspaces"`
	Memberships       map[string]map[string]any `json:"memberships"`
	Invites           map[string]map[string]any `json:"invites"`
	WorkspaceSettings map[string]map[string]any `json:"workspace_settings"`
	WorkspaceRuntime  map[string]map[string]any `json:"workspace_runtime"`
}

func emptyStateSnapshot() stateSnapshot {
	return stateSnapshot{
		Users:             map[string]map[string]any{},
		Workspaces:        map[string]map[string]any{},
		Memberships:       map[string]map[string]any{},
		Invites:           map[string]map[string]any{},
		WorkspaceSettings: map[string]map[string]any{},
		WorkspaceRuntime:  map[string]map[string]any{},
	}
}

func (s stateSnapshot) toMap() map[string]any {
	return map[string]any{
		"users":              bucketToAnyMap(s.Users),
		"workspaces":         bucketToAnyMap(s.Workspaces),
		"memberships":        bucketToAnyMap(s.Memberships),
		"invites":            bucketToAnyMap(s.Invites),
		"workspace_settings": bucketToAnyMap(s.WorkspaceSettings),
		"workspace_runtime":  bucketToAnyMap(s.WorkspaceRuntime),
	}
}

func stateFromMap(payload map[string]any) stateSnapshot {
	if payload == nil {
		return emptyStateSnapshot()
	}
	return stateSnapshot{
		Users:             normalizeBucket(payload["users"]),
		Workspaces:        normalizeBucket(payload["workspaces"]),
		Memberships:       normalizeBucket(payload["memberships"]),
		Invites:           normalizeBucket(payload["invites"]),
		WorkspaceSettings: normalizeBucket(payload["workspace_settings"]),
		WorkspaceRuntime:  normalizeBucket(payload["workspace_runtime"]),
	}
}

func normalizeBucket(raw any) map[string]map[string]any {
	input, ok := raw.(map[string]any)
	if !ok {
		typed, ok := raw.(map[string]map[string]any)
		if !ok {
			return map[string]map[string]any{}
		}
		return cloneBucket(typed)
	}

	normalized := make(map[string]map[string]any, len(input))
	for key, value := range input {
		trimmed := strings.TrimSpace(key)
		record, ok := value.(map[string]any)
		if trimmed == "" || !ok {
			continue
		}
		normalized[trimmed] = cloneMap(record)
	}
	return normalized
}

func cloneBucket(bucket map[string]map[string]any) map[string]map[string]any {
	cloned := make(map[string]map[string]any, len(bucket))
	for key, value := range bucket {
		cloned[key] = cloneMap(value)
	}
	return cloned
}

func bucketToAnyMap(bucket map[string]map[string]any) map[string]any {
	cloned := make(map[string]any, len(bucket))
	for key, value := range bucket {
		cloned[key] = cloneMap(value)
	}
	return cloned
}

func cloneMap(source map[string]any) map[string]any {
	if source == nil {
		return map[string]any{}
	}
	cloned := make(map[string]any, len(source))
	for key, value := range source {
		cloned[key] = cloneValue(value)
	}
	return cloned
}

func cloneValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return cloneMap(typed)
	case []any:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, cloneValue(item))
		}
		return out
	default:
		return typed
	}
}

func normalizeID(raw string) (string, error) {
	normalized := strings.TrimSpace(raw)
	if normalized == "" {
		return "", ErrInvalidID
	}
	return normalized, nil
}

func normalizeRole(raw string, fallback string) string {
	role := strings.ToLower(strings.TrimSpace(raw))
	if _, ok := validRoles[role]; ok {
		return role
	}
	return fallback
}

func membershipID(workspaceID, userID string) string {
	return fmt.Sprintf("%s:%s", workspaceID, userID)
}

func nowISO(now time.Time) string {
	return now.UTC().Format("2006-01-02T15:04:05.999999+00:00")
}

func parseTimestamp(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	if ts, err := time.Parse(time.RFC3339Nano, trimmed); err == nil {
		return nowISO(ts)
	}
	return trimmed
}

func sortedRecords(bucket map[string]map[string]any) []map[string]any {
	items := make([]map[string]any, 0, len(bucket))
	for _, record := range bucket {
		items = append(items, cloneMap(record))
	}
	sort.Slice(items, func(i, j int) bool {
		return asString(items[i]["updated_at"]) > asString(items[j]["updated_at"])
	})
	return items
}

func asString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case json.Number:
		return typed.String()
	default:
		if typed == nil {
			return ""
		}
		return fmt.Sprintf("%v", typed)
	}
}
