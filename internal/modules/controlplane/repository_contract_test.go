package controlplane

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/boringdata/boring-ui/internal/db"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
)

func TestRepositoryContractLocalJSON(t *testing.T) {
	root := t.TempDir()
	repo, err := NewLocalRepository(root)
	if err != nil {
		t.Fatalf("new local repository: %v", err)
	}
	runRepositoryContractSuite(t, repo)

	if _, err := os.Stat(filepath.Join(root, localStateFilePath)); err != nil {
		t.Fatalf("expected local state file: %v", err)
	}
}

func TestRepositoryContractPostgres(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	container := startControlPlanePostgresContainer(t, ctx)
	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("connection string: %v", err)
	}

	pool, err := db.Open(ctx, db.Config{URL: dsn})
	if err != nil {
		t.Fatalf("open db pool: %v", err)
	}
	t.Cleanup(pool.Close)

	repo, err := NewPostgresRepository(pool, "test-settings-key")
	if err != nil {
		t.Fatalf("new postgres repository: %v", err)
	}
	runRepositoryContractSuite(t, repo)

	var ciphertext string
	if err := pool.QueryRow(context.Background(), `SELECT encode(value, 'escape') FROM settings WHERE user_id = 'user-1'`).Scan(&ciphertext); err != nil {
		t.Fatalf("read raw encrypted settings: %v", err)
	}
	if strings.Contains(ciphertext, `"theme":"dark"`) {
		t.Fatalf("expected encrypted settings, found plaintext payload: %s", ciphertext)
	}

	var workspaceCiphertext string
	if err := pool.QueryRow(context.Background(), `SELECT encode(value, 'escape') FROM workspace_settings WHERE workspace_id = 'workspace-1'`).Scan(&workspaceCiphertext); err != nil {
		t.Fatalf("read raw encrypted workspace settings: %v", err)
	}
	if strings.Contains(workspaceCiphertext, `"theme":"light"`) {
		t.Fatalf("expected encrypted workspace settings, found plaintext payload: %s", workspaceCiphertext)
	}
}

func TestNewPostgresRepositoryFromEnv(t *testing.T) {
	t.Setenv("BORING_SETTINGS_KEY", "")
	if _, err := NewPostgresRepositoryFromEnv(nil); !errors.Is(err, ErrMissingSettingsKey) {
		t.Fatalf("expected missing settings key error, got %v", err)
	}

	t.Setenv("BORING_SETTINGS_KEY", "env-settings-key")
	if _, err := NewPostgresRepositoryFromEnv(nil); err == nil || !strings.Contains(err.Error(), "postgres pool is required") {
		t.Fatalf("expected constructor to advance past env lookup and fail on nil pool, got %v", err)
	}
}

func TestLocalRepositoryLoadsPythonFixture(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, localStateFilePath)
	if err := os.MkdirAll(filepath.Dir(statePath), 0o755); err != nil {
		t.Fatalf("mkdir state dir: %v", err)
	}
	fixture, err := os.ReadFile(filepath.Join("testdata", "python_local_db.json"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	if err := os.WriteFile(statePath, fixture, 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	repo, err := NewLocalRepository(root)
	if err != nil {
		t.Fatalf("new local repository: %v", err)
	}
	snapshot, err := repo.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("snapshot fixture: %v", err)
	}

	users := normalizeBucket(snapshot["users"])
	workspaces := normalizeBucket(snapshot["workspaces"])
	settings := normalizeBucket(snapshot["workspace_settings"])
	runtime := normalizeBucket(snapshot["workspace_runtime"])

	if users["user-1"]["email"] != "owner@example.com" {
		t.Fatalf("expected fixture user email, got %#v", users["user-1"])
	}
	if workspaces["workspace-1"]["app_id"] != defaultAppID {
		t.Fatalf("expected fixture workspace app id, got %#v", workspaces["workspace-1"])
	}
	if settings["workspace-1"]["shell"] != "zsh" {
		t.Fatalf("expected fixture workspace setting, got %#v", settings["workspace-1"])
	}
	if runtime["workspace-1"]["state"] != "ready" {
		t.Fatalf("expected fixture runtime state, got %#v", runtime["workspace-1"])
	}
}

func TestLocalRepositoryConcurrentWriters(t *testing.T) {
	root := t.TempDir()
	const writers = 12

	var wg sync.WaitGroup
	errs := make(chan error, writers)
	for i := 0; i < writers; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			repo, err := NewLocalRepository(root)
			if err != nil {
				errs <- err
				return
			}
			userID := "user-" + string(rune('a'+i))
			_, err = repo.CreateUser(context.Background(), userID, map[string]any{
				"email":        userID + "@example.com",
				"display_name": userID,
			})
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent writer error: %v", err)
		}
	}

	repo, err := NewLocalRepository(root)
	if err != nil {
		t.Fatalf("reload local repository: %v", err)
	}
	snapshot, err := repo.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("snapshot after concurrent writes: %v", err)
	}
	users := normalizeBucket(snapshot["users"])
	if len(users) != writers {
		t.Fatalf("expected %d users after concurrent writes, got %d", writers, len(users))
	}
}

func runRepositoryContractSuite(t *testing.T, repo Repository) {
	t.Helper()

	ctx := context.Background()

	user, err := repo.CreateUser(ctx, "user-1", map[string]any{
		"email":        "owner@example.com",
		"display_name": "Owner",
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	if user["user_id"] != "user-1" {
		t.Fatalf("expected created user id, got %#v", user)
	}
	createdAt := asString(user["created_at"])

	user, err = repo.CreateUser(ctx, "user-1", map[string]any{
		"email":        "owner@example.com",
		"display_name": "Owner Updated",
	})
	if err != nil {
		t.Fatalf("update user: %v", err)
	}
	if asString(user["created_at"]) != createdAt {
		t.Fatalf("expected created_at to stay stable, got before=%s after=%s", createdAt, asString(user["created_at"]))
	}

	settings, err := repo.SaveSettings(ctx, "user-1", "owner@example.com", map[string]any{
		"display_name": "Owner Updated",
		"theme":        "dark",
	})
	if err != nil {
		t.Fatalf("save settings: %v", err)
	}
	if settings["theme"] != "dark" {
		t.Fatalf("expected saved theme, got %#v", settings)
	}
	settings, err = repo.SaveSettings(ctx, "user-1", "owner@example.com", map[string]any{
		"shell": "zsh",
	})
	if err != nil {
		t.Fatalf("merge settings: %v", err)
	}
	if settings["theme"] != "dark" || settings["shell"] != "zsh" {
		t.Fatalf("expected merged settings, got %#v", settings)
	}
	settings, err = repo.GetSettings(ctx, "user-1")
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}
	if settings["display_name"] != "Owner Updated" {
		t.Fatalf("expected display_name in settings, got %#v", settings)
	}

	workspace, err := repo.CreateWorkspace(ctx, "workspace-1", map[string]any{
		"name":       "Primary",
		"created_by": "user-1",
	})
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	if workspace["app_id"] != defaultAppID {
		t.Fatalf("expected default app id, got %#v", workspace)
	}
	workspaceCreatedAt := asString(workspace["created_at"])
	workspace, err = repo.UpdateWorkspace(ctx, "workspace-1", map[string]any{
		"name": "Renamed",
	})
	if err != nil {
		t.Fatalf("update workspace: %v", err)
	}
	if workspace["name"] != "Renamed" {
		t.Fatalf("expected renamed workspace, got %#v", workspace)
	}
	if asString(workspace["created_at"]) != workspaceCreatedAt {
		t.Fatalf("expected workspace created_at to stay stable, got before=%s after=%s", workspaceCreatedAt, asString(workspace["created_at"]))
	}
	workspaceSettings, err := repo.SaveWorkspaceSettings(ctx, "workspace-1", map[string]any{
		"theme": "light",
	})
	if err != nil {
		t.Fatalf("save workspace settings: %v", err)
	}
	if workspaceSettings["theme"] != "light" {
		t.Fatalf("expected saved workspace theme, got %#v", workspaceSettings)
	}
	workspaceSettings, err = repo.SaveWorkspaceSettings(ctx, "workspace-1", map[string]any{
		"layout": "compact",
	})
	if err != nil {
		t.Fatalf("merge workspace settings: %v", err)
	}
	if workspaceSettings["theme"] != "light" || workspaceSettings["layout"] != "compact" {
		t.Fatalf("expected merged workspace settings, got %#v", workspaceSettings)
	}
	workspaceSettings, err = repo.GetWorkspaceSettings(ctx, "workspace-1")
	if err != nil {
		t.Fatalf("get workspace settings: %v", err)
	}
	if workspaceSettings["layout"] != "compact" {
		t.Fatalf("expected workspace layout in settings, got %#v", workspaceSettings)
	}
	workspaceRuntime, err := repo.SaveWorkspaceRuntime(ctx, "workspace-1", map[string]any{
		"state":       "ready",
		"retry_count": 1,
	})
	if err != nil {
		t.Fatalf("save workspace runtime: %v", err)
	}
	if workspaceRuntime["state"] != "ready" {
		t.Fatalf("expected saved workspace runtime, got %#v", workspaceRuntime)
	}
	workspaceRuntime, err = repo.GetWorkspaceRuntime(ctx, "workspace-1")
	if err != nil {
		t.Fatalf("get workspace runtime: %v", err)
	}
	if asString(workspaceRuntime["retry_count"]) != "1" {
		t.Fatalf("expected runtime retry_count, got %#v", workspaceRuntime)
	}

	workspaces, err := repo.ListWorkspaces(ctx, "user-1")
	if err != nil {
		t.Fatalf("list workspaces for member: %v", err)
	}
	if len(workspaces) != 1 || workspaces[0]["workspace_id"] != "workspace-1" {
		t.Fatalf("expected workspace in member listing, got %#v", workspaces)
	}

	_, err = repo.CreateUser(ctx, "user-2", map[string]any{
		"email":        "editor@example.com",
		"display_name": "Editor",
	})
	if err != nil {
		t.Fatalf("create invited user: %v", err)
	}

	invite, err := repo.CreateInvite(ctx, "invite-1", map[string]any{
		"workspace_id":       "workspace-1",
		"email":              "editor@example.com",
		"role":               "editor",
		"status":             "pending",
		"created_by_user_id": "user-1",
		"expires_at":         "2026-03-20T00:00:00+00:00",
	})
	if err != nil {
		t.Fatalf("create invite: %v", err)
	}
	if invite["role"] != "editor" {
		t.Fatalf("expected normalized invite role, got %#v", invite)
	}

	if _, _, err := repo.AcceptInvite(ctx, "workspace-1", "invite-1", "user-2", "wrong@example.com"); !errors.Is(err, ErrInviteEmail) {
		t.Fatalf("expected invite email mismatch, got %v", err)
	}
	if _, _, err := repo.AcceptInvite(ctx, "workspace-1", "invite-1", "user-2", ""); !errors.Is(err, ErrInviteEmail) {
		t.Fatalf("expected invite email mismatch for empty email, got %v", err)
	}

	acceptedInvite, membership, err := repo.AcceptInvite(ctx, "workspace-1", "invite-1", "user-2", "editor@example.com")
	if err != nil {
		t.Fatalf("accept invite: %v", err)
	}
	if acceptedInvite["status"] != "accepted" {
		t.Fatalf("expected accepted invite, got %#v", acceptedInvite)
	}
	if membership["role"] != "editor" {
		t.Fatalf("expected editor membership, got %#v", membership)
	}

	members, err := repo.ListMembers(ctx, "workspace-1")
	if err != nil {
		t.Fatalf("list members: %v", err)
	}
	if len(members) != 2 {
		t.Fatalf("expected two members after invite acceptance, got %#v", members)
	}

	member, err := repo.UpdateMemberRole(ctx, "workspace-1", "user-2", "viewer")
	if err != nil {
		t.Fatalf("update member role: %v", err)
	}
	if member["role"] != "viewer" {
		t.Fatalf("expected updated role viewer, got %#v", member)
	}

	removed, err := repo.RemoveMember(ctx, "workspace-1", "user-2")
	if err != nil {
		t.Fatalf("remove member: %v", err)
	}
	if asString(removed["deleted_at"]) == "" {
		t.Fatalf("expected deleted_at on removed member, got %#v", removed)
	}
	members, err = repo.ListMembers(ctx, "workspace-1")
	if err != nil {
		t.Fatalf("list members after remove: %v", err)
	}
	if len(members) != 1 || members[0]["user_id"] != "user-1" {
		t.Fatalf("expected owner only after remove, got %#v", members)
	}

	invite, err = repo.CreateInvite(ctx, "invite-2", map[string]any{
		"workspace_id":       "workspace-1",
		"email":              "viewer@example.com",
		"role":               "viewer",
		"status":             "pending",
		"created_by_user_id": "user-1",
	})
	if err != nil {
		t.Fatalf("create decline invite: %v", err)
	}
	if invite["status"] != "pending" {
		t.Fatalf("expected pending invite, got %#v", invite)
	}
	declined, err := repo.DeclineInvite(ctx, "workspace-1", "invite-2")
	if err != nil {
		t.Fatalf("decline invite: %v", err)
	}
	if declined["status"] != "declined" {
		t.Fatalf("expected declined invite, got %#v", declined)
	}

	softDeleted, err := repo.SoftDeleteWorkspace(ctx, "workspace-1")
	if err != nil {
		t.Fatalf("soft delete workspace: %v", err)
	}
	if asString(softDeleted["deleted_at"]) == "" {
		t.Fatalf("expected deleted_at on workspace, got %#v", softDeleted)
	}
	workspaces, err = repo.ListWorkspaces(ctx, "")
	if err != nil {
		t.Fatalf("list workspaces after delete: %v", err)
	}
	if len(workspaces) != 0 {
		t.Fatalf("expected no active workspaces after soft delete, got %#v", workspaces)
	}

	snapshot, err := repo.Snapshot(ctx)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if snapshot["users"] == nil || snapshot["workspaces"] == nil || snapshot["memberships"] == nil || snapshot["invites"] == nil {
		t.Fatalf("expected populated snapshot buckets, got %#v", snapshot)
	}
}

func startControlPlanePostgresContainer(t *testing.T, ctx context.Context) *postgres.PostgresContainer {
	t.Helper()

	schemaPath, err := filepath.Abs(filepath.Join("testdata", "controlplane_schema.sql"))
	if err != nil {
		t.Fatalf("resolve controlplane schema path: %v", err)
	}
	container, err := postgres.Run(ctx, "postgres:16-alpine",
		postgres.WithDatabase("boring_ui_test"),
		postgres.WithUsername("postgres"),
		postgres.WithPassword("postgres"),
		postgres.WithInitScripts(schemaPath),
		postgres.BasicWaitStrategies(),
	)
	if err != nil {
		t.Fatalf("start postgres container: %v", err)
	}
	t.Cleanup(func() {
		if terminateErr := container.Terminate(context.Background()); terminateErr != nil {
			t.Fatalf("terminate postgres container: %v", terminateErr)
		}
	})
	return container
}
