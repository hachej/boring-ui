package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

type LocalRepository struct {
	statePath string
	lockPath  string
	now       func() time.Time
	mu        sync.Mutex
}

func NewLocalRepository(workspaceRoot string) (*LocalRepository, error) {
	root := strings.TrimSpace(workspaceRoot)
	if root == "" {
		return nil, fmt.Errorf("workspace root is required")
	}
	statePath := filepath.Join(root, localStateFilePath)
	return newLocalRepositoryAtPath(statePath), nil
}

func newLocalRepositoryAtPath(statePath string) *LocalRepository {
	return &LocalRepository{
		statePath: statePath,
		lockPath:  statePath + ".lock",
		now:       time.Now,
	}
}

func (r *LocalRepository) Snapshot(ctx context.Context) (map[string]any, error) {
	state, err := r.readState(ctx)
	if err != nil {
		return nil, err
	}
	return state.toMap(), nil
}

func (r *LocalRepository) CreateUser(ctx context.Context, userID string, payload map[string]any) (map[string]any, error) {
	id, err := normalizeID(userID)
	if err != nil {
		return nil, err
	}
	return r.upsertUser(ctx, id, payload)
}

func (r *LocalRepository) GetUser(ctx context.Context, userID string) (map[string]any, error) {
	id, err := normalizeID(userID)
	if err != nil {
		return nil, err
	}
	return r.getRecord(ctx, "users", id)
}

func (r *LocalRepository) CreateWorkspace(ctx context.Context, workspaceID string, payload map[string]any) (map[string]any, error) {
	id, err := normalizeID(workspaceID)
	if err != nil {
		return nil, err
	}

	record, err := r.withState(ctx, true, func(state stateSnapshot) (stateSnapshot, map[string]any, error) {
		now := nowISO(r.now())
		existing := cloneMap(state.Workspaces[id])
		update := cloneMap(payload)
		delete(update, "created_at")

		createdAt := asString(existing["created_at"])
		if createdAt == "" {
			createdAt = now
		}
		record := map[string]any{
			"workspace_id": id,
			"name":         strings.TrimSpace(asString(update["name"])),
			"app_id":       defaultAppID,
			"created_by":   strings.TrimSpace(asString(update["created_by"])),
			"created_at":   createdAt,
			"updated_at":   now,
			"deleted_at":   nil,
		}
		if record["name"] == "" {
			record["name"] = id
		}
		if record["created_by"] == "" {
			record["created_by"] = "system"
		}
		for key, value := range existing {
			record[key] = cloneValue(value)
		}
		for key, value := range update {
			record[key] = cloneValue(value)
		}
		record["workspace_id"] = id
		record["app_id"] = defaultAppID
		record["created_at"] = createdAt
		record["updated_at"] = now
		if _, ok := record["deleted_at"]; !ok {
			record["deleted_at"] = nil
		}

		state.Workspaces[id] = record

		createdBy := strings.TrimSpace(asString(record["created_by"]))
		if createdBy != "" && createdBy != "system" {
			memberID := membershipID(id, createdBy)
			memberExisting := cloneMap(state.Memberships[memberID])
			memberCreatedAt := asString(memberExisting["created_at"])
			if memberCreatedAt == "" {
				memberCreatedAt = now
			}
			state.Memberships[memberID] = map[string]any{
				"membership_id": memberID,
				"workspace_id":  id,
				"user_id":       createdBy,
				"role":          "owner",
				"status":        memberStatusActive,
				"deleted_at":    nil,
				"created_at":    memberCreatedAt,
				"updated_at":    now,
			}
		}

		return state, cloneMap(record), nil
	})
	if err != nil {
		return nil, err
	}
	return record, nil
}

func (r *LocalRepository) GetWorkspace(ctx context.Context, workspaceID string) (map[string]any, error) {
	id, err := normalizeID(workspaceID)
	if err != nil {
		return nil, err
	}
	return r.getRecord(ctx, "workspaces", id)
}

func (r *LocalRepository) UpdateWorkspace(ctx context.Context, workspaceID string, patch map[string]any) (map[string]any, error) {
	id, err := normalizeID(workspaceID)
	if err != nil {
		return nil, err
	}

	record, err := r.withState(ctx, true, func(state stateSnapshot) (stateSnapshot, map[string]any, error) {
		existing, ok := state.Workspaces[id]
		if !ok {
			return state, nil, ErrNotFound
		}

		record := cloneMap(existing)
		if name := strings.TrimSpace(asString(patch["name"])); name != "" {
			record["name"] = name
		}
		record["updated_at"] = nowISO(r.now())
		state.Workspaces[id] = record
		return state, cloneMap(record), nil
	})
	if err != nil {
		return nil, err
	}
	return record, nil
}

func (r *LocalRepository) ListWorkspaces(ctx context.Context, userID string) ([]map[string]any, error) {
	state, err := r.readState(ctx)
	if err != nil {
		return nil, err
	}

	filterUser := strings.TrimSpace(userID)
	if filterUser == "" {
		records := make(map[string]map[string]any)
		for id, record := range state.Workspaces {
			if record["deleted_at"] == nil {
				records[id] = record
			}
		}
		return sortedRecords(records), nil
	}

	workspaceIDs := map[string]struct{}{}
	for _, member := range state.Memberships {
		if strings.TrimSpace(asString(member["user_id"])) != filterUser {
			continue
		}
		if member["deleted_at"] != nil {
			continue
		}
		workspaceIDs[asString(member["workspace_id"])] = struct{}{}
	}

	records := make(map[string]map[string]any, len(workspaceIDs))
	for workspaceID := range workspaceIDs {
		record, ok := state.Workspaces[workspaceID]
		if !ok || record["deleted_at"] != nil {
			continue
		}
		records[workspaceID] = record
	}
	return sortedRecords(records), nil
}

func (r *LocalRepository) SoftDeleteWorkspace(ctx context.Context, workspaceID string) (map[string]any, error) {
	id, err := normalizeID(workspaceID)
	if err != nil {
		return nil, err
	}
	record, err := r.withState(ctx, true, func(state stateSnapshot) (stateSnapshot, map[string]any, error) {
		existing, ok := state.Workspaces[id]
		if !ok {
			return state, nil, ErrNotFound
		}
		now := nowISO(r.now())
		record := cloneMap(existing)
		record["deleted_at"] = now
		record["updated_at"] = now
		state.Workspaces[id] = record
		return state, cloneMap(record), nil
	})
	if err != nil {
		return nil, err
	}
	return record, nil
}

func (r *LocalRepository) CreateInvite(ctx context.Context, inviteID string, payload map[string]any) (map[string]any, error) {
	id, err := normalizeID(inviteID)
	if err != nil {
		return nil, err
	}
	record, err := r.withState(ctx, true, func(state stateSnapshot) (stateSnapshot, map[string]any, error) {
		now := nowISO(r.now())
		existing := cloneMap(state.Invites[id])
		update := cloneMap(payload)
		delete(update, "created_at")

		createdAt := asString(existing["created_at"])
		if createdAt == "" {
			createdAt = now
		}
		record := map[string]any{
			"invite_id":           id,
			"workspace_id":        strings.TrimSpace(asString(update["workspace_id"])),
			"email":               strings.ToLower(strings.TrimSpace(asString(update["email"]))),
			"role":                normalizeRole(asString(update["role"]), "editor"),
			"status":              strings.TrimSpace(asString(update["status"])),
			"created_by_user_id":  strings.TrimSpace(asString(update["created_by_user_id"])),
			"accepted_at":         nil,
			"accepted_by_user_id": nil,
			"expires_at":          parseTimestamp(asString(update["expires_at"])),
			"deleted_at":          nil,
			"created_at":          createdAt,
			"updated_at":          now,
		}
		if record["status"] == "" {
			record["status"] = "pending"
		}
		for key, value := range existing {
			record[key] = cloneValue(value)
		}
		for key, value := range update {
			record[key] = cloneValue(value)
		}
		record["invite_id"] = id
		record["email"] = strings.ToLower(strings.TrimSpace(asString(record["email"])))
		record["role"] = normalizeRole(asString(record["role"]), "editor")
		record["created_at"] = createdAt
		record["updated_at"] = now
		if record["accepted_at"] == "" {
			record["accepted_at"] = nil
		}
		if record["accepted_by_user_id"] == "" {
			record["accepted_by_user_id"] = nil
		}
		if record["expires_at"] != nil {
			record["expires_at"] = parseTimestamp(asString(record["expires_at"]))
		}
		if _, ok := record["deleted_at"]; !ok {
			record["deleted_at"] = nil
		}

		state.Invites[id] = record
		return state, cloneMap(record), nil
	})
	if err != nil {
		return nil, err
	}
	return record, nil
}

func (r *LocalRepository) AcceptInvite(ctx context.Context, workspaceID, inviteID, userID, email string) (map[string]any, map[string]any, error) {
	workspaceID, err := normalizeID(workspaceID)
	if err != nil {
		return nil, nil, err
	}
	inviteID, err = normalizeID(inviteID)
	if err != nil {
		return nil, nil, err
	}
	userID, err = normalizeID(userID)
	if err != nil {
		return nil, nil, err
	}

	result, err := r.withState(ctx, true, func(state stateSnapshot) (stateSnapshot, map[string]any, error) {
		invite, ok := state.Invites[inviteID]
		if !ok || strings.TrimSpace(asString(invite["workspace_id"])) != workspaceID {
			return state, nil, ErrNotFound
		}
		normalizedEmail := strings.ToLower(strings.TrimSpace(email))
		inviteEmail := strings.ToLower(strings.TrimSpace(asString(invite["email"])))
		if inviteEmail != "" && (normalizedEmail == "" || inviteEmail != normalizedEmail) {
			return state, nil, ErrInviteEmail
		}

		now := nowISO(r.now())
		updatedInvite := cloneMap(invite)
		updatedInvite["status"] = "accepted"
		updatedInvite["accepted_at"] = now
		updatedInvite["accepted_by_user_id"] = userID
		updatedInvite["updated_at"] = now
		state.Invites[inviteID] = updatedInvite

		memberID := membershipID(workspaceID, userID)
		existingMember := cloneMap(state.Memberships[memberID])
		memberCreatedAt := asString(existingMember["created_at"])
		if memberCreatedAt == "" {
			memberCreatedAt = now
		}
		member := map[string]any{
			"membership_id": memberID,
			"workspace_id":  workspaceID,
			"user_id":       userID,
			"role":          normalizeRole(asString(updatedInvite["role"]), "viewer"),
			"status":        memberStatusActive,
			"deleted_at":    nil,
			"created_at":    memberCreatedAt,
			"updated_at":    now,
		}
		state.Memberships[memberID] = member

		return state, map[string]any{
			"invite":     cloneMap(updatedInvite),
			"membership": cloneMap(member),
		}, nil
	})
	if err != nil {
		return nil, nil, err
	}
	return cloneMap(result["invite"].(map[string]any)), cloneMap(result["membership"].(map[string]any)), nil
}

func (r *LocalRepository) DeclineInvite(ctx context.Context, workspaceID, inviteID string) (map[string]any, error) {
	workspaceID, err := normalizeID(workspaceID)
	if err != nil {
		return nil, err
	}
	inviteID, err = normalizeID(inviteID)
	if err != nil {
		return nil, err
	}
	record, err := r.withState(ctx, true, func(state stateSnapshot) (stateSnapshot, map[string]any, error) {
		existing, ok := state.Invites[inviteID]
		if !ok || strings.TrimSpace(asString(existing["workspace_id"])) != workspaceID {
			return state, nil, ErrNotFound
		}
		now := nowISO(r.now())
		record := cloneMap(existing)
		record["status"] = "declined"
		record["deleted_at"] = now
		record["updated_at"] = now
		state.Invites[inviteID] = record
		return state, cloneMap(record), nil
	})
	if err != nil {
		return nil, err
	}
	return record, nil
}

func (r *LocalRepository) ListMembers(ctx context.Context, workspaceID string) ([]map[string]any, error) {
	workspaceID, err := normalizeID(workspaceID)
	if err != nil {
		return nil, err
	}
	state, err := r.readState(ctx)
	if err != nil {
		return nil, err
	}

	records := map[string]map[string]any{}
	for id, member := range state.Memberships {
		if strings.TrimSpace(asString(member["workspace_id"])) != workspaceID {
			continue
		}
		if member["deleted_at"] != nil {
			continue
		}
		records[id] = member
	}
	return sortedRecords(records), nil
}

func (r *LocalRepository) UpdateMemberRole(ctx context.Context, workspaceID, userID, role string) (map[string]any, error) {
	workspaceID, err := normalizeID(workspaceID)
	if err != nil {
		return nil, err
	}
	userID, err = normalizeID(userID)
	if err != nil {
		return nil, err
	}
	memberID := membershipID(workspaceID, userID)
	record, err := r.withState(ctx, true, func(state stateSnapshot) (stateSnapshot, map[string]any, error) {
		now := nowISO(r.now())
		existing := cloneMap(state.Memberships[memberID])
		createdAt := asString(existing["created_at"])
		if createdAt == "" {
			createdAt = now
		}
		record := map[string]any{
			"membership_id": memberID,
			"workspace_id":  workspaceID,
			"user_id":       userID,
			"role":          normalizeRole(role, "viewer"),
			"status":        memberStatusActive,
			"deleted_at":    nil,
			"created_at":    createdAt,
			"updated_at":    now,
		}
		state.Memberships[memberID] = record
		return state, cloneMap(record), nil
	})
	if err != nil {
		return nil, err
	}
	return record, nil
}

func (r *LocalRepository) RemoveMember(ctx context.Context, workspaceID, userID string) (map[string]any, error) {
	workspaceID, err := normalizeID(workspaceID)
	if err != nil {
		return nil, err
	}
	userID, err = normalizeID(userID)
	if err != nil {
		return nil, err
	}
	memberID := membershipID(workspaceID, userID)
	record, err := r.withState(ctx, true, func(state stateSnapshot) (stateSnapshot, map[string]any, error) {
		existing, ok := state.Memberships[memberID]
		if !ok {
			return state, nil, ErrNotFound
		}
		now := nowISO(r.now())
		record := cloneMap(existing)
		record["deleted_at"] = now
		record["updated_at"] = now
		state.Memberships[memberID] = record
		return state, cloneMap(record), nil
	})
	if err != nil {
		return nil, err
	}
	return record, nil
}

func (r *LocalRepository) GetSettings(ctx context.Context, userID string) (map[string]any, error) {
	user, err := r.GetUser(ctx, userID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return map[string]any{}, nil
		}
		return nil, err
	}
	settings, ok := user["settings"].(map[string]any)
	if !ok {
		return map[string]any{}, nil
	}
	return cloneMap(settings), nil
}

func (r *LocalRepository) SaveSettings(ctx context.Context, userID, email string, patch map[string]any) (map[string]any, error) {
	id, err := normalizeID(userID)
	if err != nil {
		return nil, err
	}
	settings, err := r.withState(ctx, true, func(state stateSnapshot) (stateSnapshot, map[string]any, error) {
		now := nowISO(r.now())
		existing := cloneMap(state.Users[id])
		currentSettings := map[string]any{}
		if existingState, ok := existing["settings"].(map[string]any); ok {
			currentSettings = cloneMap(existingState)
		}
		for key, value := range patch {
			currentSettings[key] = cloneValue(value)
		}

		createdAt := asString(existing["created_at"])
		if createdAt == "" {
			createdAt = now
		}
		displayName := strings.TrimSpace(asString(currentSettings["display_name"]))
		if displayName == "" {
			displayName = strings.TrimSpace(asString(existing["display_name"]))
		}
		record := map[string]any{
			"user_id":      id,
			"email":        strings.ToLower(strings.TrimSpace(email)),
			"display_name": displayName,
			"settings":     currentSettings,
			"last_seen_at": now,
			"created_at":   createdAt,
			"updated_at":   now,
		}
		if record["email"] == "" {
			record["email"] = strings.ToLower(strings.TrimSpace(asString(existing["email"])))
		}
		state.Users[id] = record
		return state, cloneMap(currentSettings), nil
	})
	if err != nil {
		return nil, err
	}
	return settings, nil
}

func (r *LocalRepository) GetWorkspaceRuntime(ctx context.Context, workspaceID string) (map[string]any, error) {
	id, err := normalizeID(workspaceID)
	if err != nil {
		return nil, err
	}
	state, err := r.readState(ctx)
	if err != nil {
		return nil, err
	}
	if _, ok := state.Workspaces[id]; !ok {
		return nil, ErrNotFound
	}
	runtime, ok := state.WorkspaceRuntime[id]
	if !ok {
		return nil, nil
	}
	return cloneMap(runtime), nil
}

func (r *LocalRepository) SaveWorkspaceRuntime(ctx context.Context, workspaceID string, patch map[string]any) (map[string]any, error) {
	id, err := normalizeID(workspaceID)
	if err != nil {
		return nil, err
	}
	runtime, err := r.withState(ctx, true, func(state stateSnapshot) (stateSnapshot, map[string]any, error) {
		workspace, ok := state.Workspaces[id]
		if !ok || workspace["deleted_at"] != nil {
			return state, nil, ErrNotFound
		}

		currentRuntime := cloneMap(state.WorkspaceRuntime[id])
		for key, value := range patch {
			currentRuntime[key] = cloneValue(value)
		}
		state.WorkspaceRuntime[id] = currentRuntime
		return state, cloneMap(currentRuntime), nil
	})
	if err != nil {
		return nil, err
	}
	return runtime, nil
}

func (r *LocalRepository) GetWorkspaceSettings(ctx context.Context, workspaceID string) (map[string]any, error) {
	id, err := normalizeID(workspaceID)
	if err != nil {
		return nil, err
	}
	state, err := r.readState(ctx)
	if err != nil {
		return nil, err
	}
	if _, ok := state.Workspaces[id]; !ok {
		return nil, ErrNotFound
	}
	settings, ok := state.WorkspaceSettings[id]
	if !ok {
		return map[string]any{}, nil
	}
	return cloneMap(settings), nil
}

func (r *LocalRepository) SaveWorkspaceSettings(ctx context.Context, workspaceID string, patch map[string]any) (map[string]any, error) {
	id, err := normalizeID(workspaceID)
	if err != nil {
		return nil, err
	}
	settings, err := r.withState(ctx, true, func(state stateSnapshot) (stateSnapshot, map[string]any, error) {
		workspace, ok := state.Workspaces[id]
		if !ok || workspace["deleted_at"] != nil {
			return state, nil, ErrNotFound
		}

		currentSettings := cloneMap(state.WorkspaceSettings[id])
		for key, value := range patch {
			currentSettings[key] = cloneValue(value)
		}
		state.WorkspaceSettings[id] = currentSettings
		return state, cloneMap(currentSettings), nil
	})
	if err != nil {
		return nil, err
	}
	return settings, nil
}

func (r *LocalRepository) upsertUser(ctx context.Context, userID string, payload map[string]any) (map[string]any, error) {
	record, err := r.withState(ctx, true, func(state stateSnapshot) (stateSnapshot, map[string]any, error) {
		now := nowISO(r.now())
		existing := cloneMap(state.Users[userID])
		update := cloneMap(payload)
		delete(update, "created_at")

		createdAt := asString(existing["created_at"])
		if createdAt == "" {
			createdAt = now
		}
		record := map[string]any{
			"user_id":      userID,
			"email":        strings.ToLower(strings.TrimSpace(asString(update["email"]))),
			"display_name": strings.TrimSpace(asString(update["display_name"])),
			"settings":     map[string]any{},
			"created_at":   createdAt,
			"updated_at":   now,
		}
		for key, value := range existing {
			record[key] = cloneValue(value)
		}
		for key, value := range update {
			record[key] = cloneValue(value)
		}
		record["user_id"] = userID
		record["email"] = strings.ToLower(strings.TrimSpace(asString(record["email"])))
		record["display_name"] = strings.TrimSpace(asString(record["display_name"]))
		record["created_at"] = createdAt
		record["updated_at"] = now
		if settings, ok := record["settings"].(map[string]any); ok {
			record["settings"] = cloneMap(settings)
		} else {
			record["settings"] = map[string]any{}
		}

		state.Users[userID] = record
		return state, cloneMap(record), nil
	})
	if err != nil {
		return nil, err
	}
	return record, nil
}

func (r *LocalRepository) getRecord(ctx context.Context, bucketName, id string) (map[string]any, error) {
	state, err := r.readState(ctx)
	if err != nil {
		return nil, err
	}

	var bucket map[string]map[string]any
	switch bucketName {
	case "users":
		bucket = state.Users
	case "workspaces":
		bucket = state.Workspaces
	default:
		return nil, ErrNotFound
	}
	record, ok := bucket[id]
	if !ok {
		return nil, ErrNotFound
	}
	return cloneMap(record), nil
}

func (r *LocalRepository) withState(
	ctx context.Context,
	write bool,
	fn func(stateSnapshot) (stateSnapshot, map[string]any, error),
) (map[string]any, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}

	release, err := r.lockFile()
	if err != nil {
		return nil, err
	}
	defer release()

	state, err := r.loadState()
	if err != nil {
		return nil, err
	}
	next, result, err := fn(state)
	if err != nil {
		return nil, err
	}
	if write {
		if err := r.writeState(next); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func (r *LocalRepository) readState(ctx context.Context) (stateSnapshot, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	select {
	case <-ctx.Done():
		return stateSnapshot{}, ctx.Err()
	default:
	}

	release, err := r.lockFile()
	if err != nil {
		return stateSnapshot{}, err
	}
	defer release()

	return r.loadState()
}

func (r *LocalRepository) lockFile() (func(), error) {
	if err := os.MkdirAll(filepath.Dir(r.lockPath), 0o755); err != nil {
		return nil, fmt.Errorf("create local repository lock dir: %w", err)
	}
	lockFile, err := os.OpenFile(r.lockPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open local repository lock file: %w", err)
	}
	if err := syscall.Flock(int(lockFile.Fd()), syscall.LOCK_EX); err != nil {
		lockFile.Close()
		return nil, fmt.Errorf("flock local repository: %w", err)
	}
	return func() {
		_ = syscall.Flock(int(lockFile.Fd()), syscall.LOCK_UN)
		_ = lockFile.Close()
	}, nil
}

func (r *LocalRepository) loadState() (stateSnapshot, error) {
	data, err := os.ReadFile(r.statePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return emptyStateSnapshot(), nil
		}
		return stateSnapshot{}, fmt.Errorf("read local repository state: %w", err)
	}
	if len(data) == 0 {
		return emptyStateSnapshot(), nil
	}

	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		backupPath := fmt.Sprintf("%s.corrupt-%s", r.statePath, r.now().UTC().Format("20060102T150405Z"))
		if moveErr := os.Rename(r.statePath, backupPath); moveErr != nil {
			return stateSnapshot{}, fmt.Errorf("decode local repository state: %w", err)
		}
		return emptyStateSnapshot(), nil
	}
	return stateFromMap(payload), nil
}

func (r *LocalRepository) writeState(state stateSnapshot) error {
	if err := os.MkdirAll(filepath.Dir(r.statePath), 0o755); err != nil {
		return fmt.Errorf("create local repository dir: %w", err)
	}
	data, err := json.MarshalIndent(state.toMap(), "", "  ")
	if err != nil {
		return fmt.Errorf("marshal local repository state: %w", err)
	}
	tmpPath := r.statePath + ".tmp"
	file, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("open local repository temp state: %w", err)
	}
	if _, err := file.Write(data); err != nil {
		file.Close()
		return fmt.Errorf("write local repository temp state: %w", err)
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return fmt.Errorf("sync local repository temp state: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close local repository temp state: %w", err)
	}
	if err := os.Rename(tmpPath, r.statePath); err != nil {
		return fmt.Errorf("replace local repository state: %w", err)
	}
	dir, err := os.Open(filepath.Dir(r.statePath))
	if err != nil {
		return fmt.Errorf("open local repository dir for sync: %w", err)
	}
	if err := dir.Sync(); err != nil {
		dir.Close()
		return fmt.Errorf("sync local repository dir: %w", err)
	}
	if err := dir.Close(); err != nil {
		return fmt.Errorf("close local repository dir after sync: %w", err)
	}
	return nil
}
