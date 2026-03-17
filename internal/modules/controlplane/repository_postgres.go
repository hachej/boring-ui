package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const defaultQueryTimeout = 5 * time.Second

var ErrMissingSettingsKey = errors.New("BORING_SETTINGS_KEY is required")

type PostgresRepository struct {
	pool        *pgxpool.Pool
	settingsKey string
	timeout     time.Duration
}

func NewPostgresRepository(pool *pgxpool.Pool, settingsKey string) (*PostgresRepository, error) {
	if pool == nil {
		return nil, fmt.Errorf("postgres pool is required")
	}
	if strings.TrimSpace(settingsKey) == "" {
		return nil, fmt.Errorf("settings key is required")
	}
	return &PostgresRepository{
		pool:        pool,
		settingsKey: settingsKey,
		timeout:     defaultQueryTimeout,
	}, nil
}

func NewPostgresRepositoryFromEnv(pool *pgxpool.Pool) (*PostgresRepository, error) {
	settingsKey := strings.TrimSpace(os.Getenv("BORING_SETTINGS_KEY"))
	if settingsKey == "" {
		return nil, ErrMissingSettingsKey
	}
	return NewPostgresRepository(pool, settingsKey)
}

func (r *PostgresRepository) Snapshot(ctx context.Context) (map[string]any, error) {
	users, err := r.snapshotUsers(ctx)
	if err != nil {
		return nil, err
	}
	workspaces, err := r.snapshotBucket(ctx, `
		SELECT jsonb_object_agg(workspace_id, payload)
		FROM (
			SELECT workspace_id,
			       jsonb_build_object(
			           'workspace_id', workspace_id,
			           'name', name,
			           'app_id', app_id,
			           'created_by', created_by,
			           'deleted_at', deleted_at,
			           'created_at', created_at,
			           'updated_at', updated_at
			       ) AS payload
			FROM workspaces
		) rows
	`)
	if err != nil {
		return nil, err
	}
	memberships, err := r.snapshotBucket(ctx, `
		SELECT jsonb_object_agg(workspace_id || ':' || user_id, payload)
		FROM (
			SELECT workspace_id,
			       user_id,
			       jsonb_build_object(
			           'membership_id', workspace_id || ':' || user_id,
			           'workspace_id', workspace_id,
			           'user_id', user_id,
			           'role', role,
			           'status', status,
			           'deleted_at', deleted_at,
			           'created_at', created_at,
			           'updated_at', updated_at
			       ) AS payload
			FROM members
		) rows
	`)
	if err != nil {
		return nil, err
	}
	invites, err := r.snapshotBucket(ctx, `
		SELECT jsonb_object_agg(invite_id, payload)
		FROM (
			SELECT invite_id,
			       jsonb_build_object(
			           'invite_id', invite_id,
			           'workspace_id', workspace_id,
			           'email', email,
			           'role', role,
			           'status', status,
			           'created_by_user_id', created_by_user_id,
			           'accepted_at', accepted_at,
			           'accepted_by_user_id', accepted_by_user_id,
			           'expires_at', expires_at,
			           'deleted_at', deleted_at,
			           'created_at', created_at,
			           'updated_at', updated_at
			       ) AS payload
			FROM invites
		) rows
	`)
	if err != nil {
		return nil, err
	}
	workspaceSettings, err := r.snapshotBucket(ctx, `
		SELECT jsonb_object_agg(workspace_id, payload)
		FROM (
			SELECT workspace_id,
			       COALESCE(pgp_sym_decrypt(value, $1)::jsonb, '{}'::jsonb) AS payload
			FROM workspace_settings
		) rows
	`, r.settingsKey)
	if err != nil {
		return nil, err
	}
	workspaceRuntime, err := r.snapshotBucket(ctx, `
		SELECT jsonb_object_agg(workspace_id, payload)
		FROM (
			SELECT workspace_id,
			       COALESCE(pgp_sym_decrypt(value, $1)::jsonb, '{}'::jsonb) AS payload
			FROM workspace_runtimes
		) rows
	`, r.settingsKey)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"users":              users,
		"workspaces":         workspaces,
		"memberships":        memberships,
		"invites":            invites,
		"workspace_settings": workspaceSettings,
		"workspace_runtime":  workspaceRuntime,
	}, nil
}

func (r *PostgresRepository) CreateUser(ctx context.Context, userID string, payload map[string]any) (map[string]any, error) {
	id, err := normalizeID(userID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	_, err = r.pool.Exec(ctx, `
		INSERT INTO users (user_id, email, display_name, last_seen_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NOW(), NOW())
		ON CONFLICT (user_id) DO UPDATE
		SET email = EXCLUDED.email,
		    display_name = EXCLUDED.display_name,
		    last_seen_at = COALESCE(EXCLUDED.last_seen_at, users.last_seen_at),
		    updated_at = NOW()
	`, id, strings.ToLower(strings.TrimSpace(asString(payload["email"]))), strings.TrimSpace(asString(payload["display_name"])), nullableTimestamp(payload["last_seen_at"]))
	if err != nil {
		return nil, fmt.Errorf("upsert user: %w", err)
	}
	return r.GetUser(context.Background(), id)
}

func (r *PostgresRepository) GetUser(ctx context.Context, userID string) (map[string]any, error) {
	id, err := normalizeID(userID)
	if err != nil {
		return nil, err
	}
	return r.fetchJSONObject(ctx, `
		SELECT jsonb_build_object(
			'user_id', u.user_id,
			'email', u.email,
			'display_name', u.display_name,
			'settings', COALESCE((
				SELECT pgp_sym_decrypt(value, $2)::jsonb
				FROM settings
				WHERE user_id = u.user_id
			), '{}'::jsonb),
			'last_seen_at', u.last_seen_at,
			'created_at', u.created_at,
			'updated_at', u.updated_at
		)
		FROM users u
		WHERE u.user_id = $1
	`, id, r.settingsKey)
}

func (r *PostgresRepository) CreateWorkspace(ctx context.Context, workspaceID string, payload map[string]any) (map[string]any, error) {
	id, err := normalizeID(workspaceID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin workspace tx: %w", err)
	}
	defer tx.Rollback(ctx)

	name := strings.TrimSpace(asString(payload["name"]))
	if name == "" {
		name = id
	}
	createdBy := strings.TrimSpace(asString(payload["created_by"]))
	if createdBy == "" {
		createdBy = "system"
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO workspaces (workspace_id, name, app_id, created_by, deleted_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NULL, NOW(), NOW())
		ON CONFLICT (workspace_id) DO UPDATE
		SET name = EXCLUDED.name,
		    app_id = EXCLUDED.app_id,
		    created_by = EXCLUDED.created_by,
		    deleted_at = NULL,
		    updated_at = NOW()
	`, id, name, defaultAppID, createdBy)
	if err != nil {
		return nil, fmt.Errorf("upsert workspace: %w", err)
	}
	if createdBy != "system" {
		_, err = tx.Exec(ctx, `
			INSERT INTO members (workspace_id, user_id, role, status, deleted_at, created_at, updated_at)
			VALUES ($1, $2, 'owner', $3, NULL, NOW(), NOW())
			ON CONFLICT (workspace_id, user_id) DO UPDATE
			SET role = 'owner',
			    status = EXCLUDED.status,
			    deleted_at = NULL,
			    updated_at = NOW()
		`, id, createdBy, memberStatusActive)
		if err != nil {
			return nil, fmt.Errorf("bootstrap owner member: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit workspace tx: %w", err)
	}
	return r.GetWorkspace(context.Background(), id)
}

func (r *PostgresRepository) GetWorkspace(ctx context.Context, workspaceID string) (map[string]any, error) {
	id, err := normalizeID(workspaceID)
	if err != nil {
		return nil, err
	}
	return r.fetchJSONObject(ctx, `
		SELECT jsonb_build_object(
			'workspace_id', workspace_id,
			'name', name,
			'app_id', app_id,
			'created_by', created_by,
			'deleted_at', deleted_at,
			'created_at', created_at,
			'updated_at', updated_at
		)
		FROM workspaces
		WHERE workspace_id = $1
	`, id)
}

func (r *PostgresRepository) UpdateWorkspace(ctx context.Context, workspaceID string, patch map[string]any) (map[string]any, error) {
	id, err := normalizeID(workspaceID)
	if err != nil {
		return nil, err
	}
	name := strings.TrimSpace(asString(patch["name"]))
	if name == "" {
		return r.GetWorkspace(ctx, id)
	}

	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	tag, err := r.pool.Exec(ctx, `
		UPDATE workspaces
		SET name = $2,
		    updated_at = NOW()
		WHERE workspace_id = $1
	`, id, name)
	if err != nil {
		return nil, fmt.Errorf("update workspace: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.GetWorkspace(context.Background(), id)
}

func (r *PostgresRepository) ListWorkspaces(ctx context.Context, userID string) ([]map[string]any, error) {
	var query string
	var args []any
	if strings.TrimSpace(userID) == "" {
		query = `
			SELECT jsonb_build_object(
				'workspace_id', workspace_id,
				'name', name,
				'app_id', app_id,
				'created_by', created_by,
				'deleted_at', deleted_at,
				'created_at', created_at,
				'updated_at', updated_at
			)
			FROM workspaces
			WHERE deleted_at IS NULL
			ORDER BY updated_at DESC
		`
	} else {
		query = `
			SELECT jsonb_build_object(
				'workspace_id', w.workspace_id,
				'name', w.name,
				'app_id', w.app_id,
				'created_by', w.created_by,
				'deleted_at', w.deleted_at,
				'created_at', w.created_at,
				'updated_at', w.updated_at
			)
			FROM workspaces w
			INNER JOIN members m ON m.workspace_id = w.workspace_id
			WHERE w.deleted_at IS NULL
			  AND m.deleted_at IS NULL
			  AND m.user_id = $1
			ORDER BY w.updated_at DESC
		`
		args = []any{strings.TrimSpace(userID)}
	}
	return r.fetchJSONObjectList(ctx, query, args...)
}

func (r *PostgresRepository) SoftDeleteWorkspace(ctx context.Context, workspaceID string) (map[string]any, error) {
	id, err := normalizeID(workspaceID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	tag, err := r.pool.Exec(ctx, `
		UPDATE workspaces
		SET deleted_at = NOW(),
		    updated_at = NOW()
		WHERE workspace_id = $1
	`, id)
	if err != nil {
		return nil, fmt.Errorf("soft delete workspace: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.GetWorkspace(context.Background(), id)
}

func (r *PostgresRepository) CreateInvite(ctx context.Context, inviteID string, payload map[string]any) (map[string]any, error) {
	id, err := normalizeID(inviteID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	_, err = r.pool.Exec(ctx, `
		INSERT INTO invites (invite_id, workspace_id, email, role, status, created_by_user_id, accepted_at, accepted_by_user_id, expires_at, deleted_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, $7, NULL, NOW(), NOW())
		ON CONFLICT (invite_id) DO UPDATE
		SET workspace_id = EXCLUDED.workspace_id,
		    email = EXCLUDED.email,
		    role = EXCLUDED.role,
		    status = EXCLUDED.status,
		    created_by_user_id = EXCLUDED.created_by_user_id,
		    expires_at = EXCLUDED.expires_at,
		    deleted_at = NULL,
		    updated_at = NOW()
	`, id, strings.TrimSpace(asString(payload["workspace_id"])), strings.ToLower(strings.TrimSpace(asString(payload["email"]))), normalizeRole(asString(payload["role"]), "editor"), defaultString(payload["status"], "pending"), strings.TrimSpace(asString(payload["created_by_user_id"])), nullableTimestamp(payload["expires_at"]))
	if err != nil {
		return nil, fmt.Errorf("upsert invite: %w", err)
	}
	return r.fetchInvite(context.Background(), strings.TrimSpace(asString(payload["workspace_id"])), id)
}

func (r *PostgresRepository) AcceptInvite(ctx context.Context, workspaceID, inviteID, userID, email string) (map[string]any, map[string]any, error) {
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

	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, nil, fmt.Errorf("begin accept invite tx: %w", err)
	}
	defer tx.Rollback(ctx)

	invite, err := r.fetchJSONObjectWithQuerier(ctx, tx, `
		SELECT jsonb_build_object(
			'invite_id', invite_id,
			'workspace_id', workspace_id,
			'email', email,
			'role', role,
			'status', status,
			'created_by_user_id', created_by_user_id,
			'accepted_at', accepted_at,
			'accepted_by_user_id', accepted_by_user_id,
			'expires_at', expires_at,
			'deleted_at', deleted_at,
			'created_at', created_at,
			'updated_at', updated_at
		)
		FROM invites
		WHERE invite_id = $1 AND workspace_id = $2
	`, inviteID, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	normalizedEmail := strings.ToLower(strings.TrimSpace(email))
	inviteEmail := strings.ToLower(strings.TrimSpace(asString(invite["email"])))
	if inviteEmail != "" && (normalizedEmail == "" || inviteEmail != normalizedEmail) {
		return nil, nil, ErrInviteEmail
	}

	_, err = tx.Exec(ctx, `
		UPDATE invites
		SET status = 'accepted',
		    accepted_at = NOW(),
		    accepted_by_user_id = $3,
		    deleted_at = NULL,
		    updated_at = NOW()
		WHERE invite_id = $1 AND workspace_id = $2
	`, inviteID, workspaceID, userID)
	if err != nil {
		return nil, nil, fmt.Errorf("accept invite: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO members (workspace_id, user_id, role, status, deleted_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NULL, NOW(), NOW())
		ON CONFLICT (workspace_id, user_id) DO UPDATE
		SET role = EXCLUDED.role,
		    status = EXCLUDED.status,
		    deleted_at = NULL,
		    updated_at = NOW()
	`, workspaceID, userID, normalizeRole(asString(invite["role"]), "viewer"), memberStatusActive)
	if err != nil {
		return nil, nil, fmt.Errorf("upsert accepted member: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("commit accept invite tx: %w", err)
	}
	updatedInvite, err := r.fetchInvite(context.Background(), workspaceID, inviteID)
	if err != nil {
		return nil, nil, err
	}
	member, err := r.fetchMember(context.Background(), workspaceID, userID)
	if err != nil {
		return nil, nil, err
	}
	return updatedInvite, member, nil
}

func (r *PostgresRepository) DeclineInvite(ctx context.Context, workspaceID, inviteID string) (map[string]any, error) {
	workspaceID, err := normalizeID(workspaceID)
	if err != nil {
		return nil, err
	}
	inviteID, err = normalizeID(inviteID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	tag, err := r.pool.Exec(ctx, `
		UPDATE invites
		SET status = 'declined',
		    deleted_at = NOW(),
		    updated_at = NOW()
		WHERE invite_id = $1 AND workspace_id = $2
	`, inviteID, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("decline invite: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.fetchInvite(context.Background(), workspaceID, inviteID)
}

func (r *PostgresRepository) ListMembers(ctx context.Context, workspaceID string) ([]map[string]any, error) {
	id, err := normalizeID(workspaceID)
	if err != nil {
		return nil, err
	}
	return r.fetchJSONObjectList(ctx, `
		SELECT jsonb_build_object(
			'membership_id', workspace_id || ':' || user_id,
			'workspace_id', workspace_id,
			'user_id', user_id,
			'role', role,
			'status', status,
			'deleted_at', deleted_at,
			'created_at', created_at,
			'updated_at', updated_at
		)
		FROM members
		WHERE workspace_id = $1
		  AND deleted_at IS NULL
		ORDER BY updated_at DESC
	`, id)
}

func (r *PostgresRepository) UpdateMemberRole(ctx context.Context, workspaceID, userID, role string) (map[string]any, error) {
	workspaceID, err := normalizeID(workspaceID)
	if err != nil {
		return nil, err
	}
	userID, err = normalizeID(userID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	_, err = r.pool.Exec(ctx, `
		INSERT INTO members (workspace_id, user_id, role, status, deleted_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NULL, NOW(), NOW())
		ON CONFLICT (workspace_id, user_id) DO UPDATE
		SET role = EXCLUDED.role,
		    status = EXCLUDED.status,
		    deleted_at = NULL,
		    updated_at = NOW()
	`, workspaceID, userID, normalizeRole(role, "viewer"), memberStatusActive)
	if err != nil {
		return nil, fmt.Errorf("upsert member role: %w", err)
	}
	return r.fetchMember(context.Background(), workspaceID, userID)
}

func (r *PostgresRepository) RemoveMember(ctx context.Context, workspaceID, userID string) (map[string]any, error) {
	workspaceID, err := normalizeID(workspaceID)
	if err != nil {
		return nil, err
	}
	userID, err = normalizeID(userID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	tag, err := r.pool.Exec(ctx, `
		UPDATE members
		SET deleted_at = NOW(),
		    updated_at = NOW()
		WHERE workspace_id = $1
		  AND user_id = $2
	`, workspaceID, userID)
	if err != nil {
		return nil, fmt.Errorf("remove member: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.fetchMember(context.Background(), workspaceID, userID)
}

func (r *PostgresRepository) GetSettings(ctx context.Context, userID string) (map[string]any, error) {
	id, err := normalizeID(userID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	var payload []byte
	err = r.pool.QueryRow(ctx, `
		SELECT pgp_sym_decrypt(value, $2)::text
		FROM settings
		WHERE user_id = $1
	`, id, r.settingsKey).Scan(&payload)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return map[string]any{}, nil
		}
		return nil, fmt.Errorf("get settings: %w", err)
	}
	settings := map[string]any{}
	if err := json.Unmarshal(payload, &settings); err != nil {
		return nil, fmt.Errorf("decode settings: %w", err)
	}
	return settings, nil
}

func (r *PostgresRepository) SaveSettings(ctx context.Context, userID, email string, patch map[string]any) (map[string]any, error) {
	id, err := normalizeID(userID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin settings tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var existingEmail string
	var existingDisplayName string
	err = tx.QueryRow(ctx, `
		SELECT email, display_name
		FROM users
		WHERE user_id = $1
	`, id).Scan(&existingEmail, &existingDisplayName)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("load existing user for settings: %w", err)
	}

	settings := map[string]any{}
	var rawSettings []byte
	err = tx.QueryRow(ctx, `
		SELECT pgp_sym_decrypt(value, $2)::text
		FROM settings
		WHERE user_id = $1
	`, id, r.settingsKey).Scan(&rawSettings)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("load existing settings: %w", err)
	}
	if len(rawSettings) > 0 {
		if err := json.Unmarshal(rawSettings, &settings); err != nil {
			return nil, fmt.Errorf("decode existing settings: %w", err)
		}
	}
	for key, value := range patch {
		settings[key] = cloneValue(value)
	}

	displayName := strings.TrimSpace(asString(settings["display_name"]))
	if displayName == "" {
		displayName = strings.TrimSpace(existingDisplayName)
	}
	normalizedEmail := strings.ToLower(strings.TrimSpace(email))
	if normalizedEmail == "" {
		normalizedEmail = strings.ToLower(strings.TrimSpace(existingEmail))
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO users (user_id, email, display_name, last_seen_at, created_at, updated_at)
		VALUES ($1, $2, $3, NOW(), NOW(), NOW())
		ON CONFLICT (user_id) DO UPDATE
		SET email = EXCLUDED.email,
		    display_name = EXCLUDED.display_name,
		    last_seen_at = NOW(),
		    updated_at = NOW()
	`, id, normalizedEmail, displayName)
	if err != nil {
		return nil, fmt.Errorf("upsert settings user: %w", err)
	}

	encoded, err := json.Marshal(settings)
	if err != nil {
		return nil, fmt.Errorf("marshal settings: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO settings (user_id, value, created_at, updated_at)
		VALUES ($1, pgp_sym_encrypt($2, $3), NOW(), NOW())
		ON CONFLICT (user_id) DO UPDATE
		SET value = pgp_sym_encrypt($2, $3),
		    updated_at = NOW()
	`, id, string(encoded), r.settingsKey)
	if err != nil {
		return nil, fmt.Errorf("save encrypted settings: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit settings tx: %w", err)
	}
	return settings, nil
}

func (r *PostgresRepository) GetWorkspaceRuntime(ctx context.Context, workspaceID string) (map[string]any, error) {
	id, err := normalizeID(workspaceID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	var payload []byte
	err = r.pool.QueryRow(ctx, `
		SELECT pgp_sym_decrypt(value, $2)::text
		FROM workspace_runtimes
		WHERE workspace_id = $1
	`, id, r.settingsKey).Scan(&payload)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			if _, lookupErr := r.GetWorkspace(context.Background(), id); lookupErr != nil {
				return nil, lookupErr
			}
			return nil, nil
		}
		return nil, fmt.Errorf("get workspace runtime: %w", err)
	}
	runtime := map[string]any{}
	if err := json.Unmarshal(payload, &runtime); err != nil {
		return nil, fmt.Errorf("decode workspace runtime: %w", err)
	}
	return runtime, nil
}

func (r *PostgresRepository) SaveWorkspaceRuntime(ctx context.Context, workspaceID string, patch map[string]any) (map[string]any, error) {
	id, err := normalizeID(workspaceID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	if _, err := r.GetWorkspace(context.Background(), id); err != nil {
		return nil, err
	}

	runtime := map[string]any{}
	var rawRuntime []byte
	err = r.pool.QueryRow(ctx, `
		SELECT pgp_sym_decrypt(value, $2)::text
		FROM workspace_runtimes
		WHERE workspace_id = $1
	`, id, r.settingsKey).Scan(&rawRuntime)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("load workspace runtime: %w", err)
	}
	if len(rawRuntime) > 0 {
		if err := json.Unmarshal(rawRuntime, &runtime); err != nil {
			return nil, fmt.Errorf("decode existing workspace runtime: %w", err)
		}
	}
	for key, value := range patch {
		runtime[key] = cloneValue(value)
	}

	encoded, err := json.Marshal(runtime)
	if err != nil {
		return nil, fmt.Errorf("marshal workspace runtime: %w", err)
	}
	_, err = r.pool.Exec(ctx, `
		INSERT INTO workspace_runtimes (workspace_id, value, created_at, updated_at)
		VALUES ($1, pgp_sym_encrypt($2, $3), NOW(), NOW())
		ON CONFLICT (workspace_id) DO UPDATE
		SET value = pgp_sym_encrypt($2, $3),
		    updated_at = NOW()
	`, id, string(encoded), r.settingsKey)
	if err != nil {
		return nil, fmt.Errorf("save workspace runtime: %w", err)
	}
	return runtime, nil
}

func (r *PostgresRepository) GetWorkspaceSettings(ctx context.Context, workspaceID string) (map[string]any, error) {
	id, err := normalizeID(workspaceID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	var payload []byte
	err = r.pool.QueryRow(ctx, `
		SELECT pgp_sym_decrypt(value, $2)::text
		FROM workspace_settings
		WHERE workspace_id = $1
	`, id, r.settingsKey).Scan(&payload)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			if _, lookupErr := r.GetWorkspace(context.Background(), id); lookupErr != nil {
				return nil, lookupErr
			}
			return map[string]any{}, nil
		}
		return nil, fmt.Errorf("get workspace settings: %w", err)
	}
	settings := map[string]any{}
	if err := json.Unmarshal(payload, &settings); err != nil {
		return nil, fmt.Errorf("decode workspace settings: %w", err)
	}
	return settings, nil
}

func (r *PostgresRepository) SaveWorkspaceSettings(ctx context.Context, workspaceID string, patch map[string]any) (map[string]any, error) {
	id, err := normalizeID(workspaceID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	if _, err := r.GetWorkspace(context.Background(), id); err != nil {
		return nil, err
	}

	settings := map[string]any{}
	var rawSettings []byte
	err = r.pool.QueryRow(ctx, `
		SELECT pgp_sym_decrypt(value, $2)::text
		FROM workspace_settings
		WHERE workspace_id = $1
	`, id, r.settingsKey).Scan(&rawSettings)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("load workspace settings: %w", err)
	}
	if len(rawSettings) > 0 {
		if err := json.Unmarshal(rawSettings, &settings); err != nil {
			return nil, fmt.Errorf("decode existing workspace settings: %w", err)
		}
	}
	for key, value := range patch {
		settings[key] = cloneValue(value)
	}

	encoded, err := json.Marshal(settings)
	if err != nil {
		return nil, fmt.Errorf("marshal workspace settings: %w", err)
	}
	_, err = r.pool.Exec(ctx, `
		INSERT INTO workspace_settings (workspace_id, value, created_at, updated_at)
		VALUES ($1, pgp_sym_encrypt($2, $3), NOW(), NOW())
		ON CONFLICT (workspace_id) DO UPDATE
		SET value = pgp_sym_encrypt($2, $3),
		    updated_at = NOW()
	`, id, string(encoded), r.settingsKey)
	if err != nil {
		return nil, fmt.Errorf("save workspace settings: %w", err)
	}
	return settings, nil
}

func (r *PostgresRepository) withTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithTimeout(ctx, r.timeout)
}

func (r *PostgresRepository) fetchInvite(ctx context.Context, workspaceID, inviteID string) (map[string]any, error) {
	return r.fetchJSONObject(ctx, `
		SELECT jsonb_build_object(
			'invite_id', invite_id,
			'workspace_id', workspace_id,
			'email', email,
			'role', role,
			'status', status,
			'created_by_user_id', created_by_user_id,
			'accepted_at', accepted_at,
			'accepted_by_user_id', accepted_by_user_id,
			'expires_at', expires_at,
			'deleted_at', deleted_at,
			'created_at', created_at,
			'updated_at', updated_at
		)
		FROM invites
		WHERE invite_id = $1 AND workspace_id = $2
	`, inviteID, workspaceID)
}

func (r *PostgresRepository) fetchMember(ctx context.Context, workspaceID, userID string) (map[string]any, error) {
	return r.fetchJSONObject(ctx, `
		SELECT jsonb_build_object(
			'membership_id', workspace_id || ':' || user_id,
			'workspace_id', workspace_id,
			'user_id', user_id,
			'role', role,
			'status', status,
			'deleted_at', deleted_at,
			'created_at', created_at,
			'updated_at', updated_at
		)
		FROM members
		WHERE workspace_id = $1 AND user_id = $2
	`, workspaceID, userID)
}

func (r *PostgresRepository) fetchJSONObject(ctx context.Context, query string, args ...any) (map[string]any, error) {
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()
	return r.fetchJSONObjectWithQuerier(ctx, r.pool, query, args...)
}

type rowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func (r *PostgresRepository) fetchJSONObjectWithQuerier(ctx context.Context, querier rowQuerier, query string, args ...any) (map[string]any, error) {
	var payload []byte
	if err := querier.QueryRow(ctx, query, args...).Scan(&payload); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("fetch json object: %w", err)
	}
	record := map[string]any{}
	if err := json.Unmarshal(payload, &record); err != nil {
		return nil, fmt.Errorf("decode json object: %w", err)
	}
	return record, nil
}

func (r *PostgresRepository) fetchJSONObjectList(ctx context.Context, query string, args ...any) ([]map[string]any, error) {
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query json objects: %w", err)
	}
	defer rows.Close()

	records := []map[string]any{}
	for rows.Next() {
		var payload []byte
		if err := rows.Scan(&payload); err != nil {
			return nil, fmt.Errorf("scan json object: %w", err)
		}
		record := map[string]any{}
		if err := json.Unmarshal(payload, &record); err != nil {
			return nil, fmt.Errorf("decode json object: %w", err)
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate json objects: %w", err)
	}
	return records, nil
}

func (r *PostgresRepository) snapshotUsers(ctx context.Context) (map[string]any, error) {
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	rows, err := r.pool.Query(ctx, `
		SELECT u.user_id,
		       jsonb_build_object(
		           'user_id', u.user_id,
		           'email', u.email,
		           'display_name', u.display_name,
		           'settings', COALESCE(s.settings, '{}'::jsonb),
		           'last_seen_at', u.last_seen_at,
		           'created_at', u.created_at,
		           'updated_at', u.updated_at
		       )
		FROM users u
		LEFT JOIN (
			SELECT user_id, pgp_sym_decrypt(value, $1)::jsonb AS settings
			FROM settings
		) s ON s.user_id = u.user_id
	`, r.settingsKey)
	if err != nil {
		return nil, fmt.Errorf("query snapshot users: %w", err)
	}
	defer rows.Close()

	bucket := map[string]any{}
	for rows.Next() {
		var userID string
		var payload []byte
		if err := rows.Scan(&userID, &payload); err != nil {
			return nil, fmt.Errorf("scan snapshot user: %w", err)
		}
		record := map[string]any{}
		if err := json.Unmarshal(payload, &record); err != nil {
			return nil, fmt.Errorf("decode snapshot user: %w", err)
		}
		bucket[userID] = record
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate snapshot users: %w", err)
	}
	return bucket, nil
}

func (r *PostgresRepository) snapshotBucket(ctx context.Context, query string, args ...any) (map[string]any, error) {
	ctx, cancel := r.withTimeout(ctx)
	defer cancel()

	var payload []byte
	if err := r.pool.QueryRow(ctx, query, args...).Scan(&payload); err != nil {
		return nil, fmt.Errorf("scan snapshot bucket: %w", err)
	}
	if len(payload) == 0 {
		return map[string]any{}, nil
	}
	bucket := map[string]any{}
	if err := json.Unmarshal(payload, &bucket); err != nil {
		return nil, fmt.Errorf("decode snapshot bucket: %w", err)
	}
	if bucket == nil {
		return map[string]any{}, nil
	}
	return bucket, nil
}

func nullableTimestamp(value any) any {
	raw := strings.TrimSpace(asString(value))
	if raw == "" {
		return nil
	}
	if ts, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return ts.UTC()
	}
	return raw
}

func defaultString(value any, fallback string) string {
	text := strings.TrimSpace(asString(value))
	if text == "" {
		return fallback
	}
	return text
}
