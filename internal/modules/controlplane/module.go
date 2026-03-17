package controlplane

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/boringdata/boring-ui/internal/app"
	"github.com/boringdata/boring-ui/internal/auth"
	"github.com/boringdata/boring-ui/internal/config"
	"github.com/boringdata/boring-ui/internal/db"
)

const modulePrefix = "/api/v1"

type Module struct {
	cfg  config.Config
	now  func() time.Time
	mu   sync.RWMutex
	repo Repository
	pool *pgxpool.Pool
}

func NewModule(cfg config.Config) (*Module, error) {
	repo, err := newRepository(cfg)
	if err != nil {
		return nil, err
	}

	return &Module{
		cfg:  cfg,
		now:  time.Now,
		repo: repo,
	}, nil
}

func (m *Module) Name() string {
	return "control_plane"
}

func (m *Module) Prefix() string {
	return modulePrefix
}

func (m *Module) Start(ctx context.Context) error {
	dbCfg, err := db.ConfigFromEnv()
	if err != nil {
		if errors.Is(err, db.ErrMissingDatabaseURL) {
			if m.currentRepo() != nil {
				return nil
			}
			repo, repoErr := newLocalRepositoryFromConfig(m.cfg)
			if repoErr != nil {
				return repoErr
			}
			m.setRepository(repo, nil)
			return nil
		}
		return err
	}

	if _, ok := m.currentRepo().(*PostgresRepository); ok {
		return nil
	}

	pool, err := db.Open(ctx, dbCfg)
	if err != nil {
		return err
	}
	if err := db.CheckSchema(ctx, pool); err != nil {
		pool.Close()
		return err
	}

	repo, err := NewPostgresRepositoryFromEnv(pool)
	if err != nil {
		pool.Close()
		return err
	}

	m.setRepository(repo, pool)
	return nil
}

func (m *Module) Stop(_ context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.pool != nil {
		m.pool.Close()
		m.pool = nil
		repo, err := newLocalRepositoryFromConfig(m.cfg)
		if err == nil {
			m.repo = repo
		} else {
			m.repo = nil
		}
	}
	return nil
}

func (m *Module) RegisterRoutes(router app.Router) {
	router.Route(m.Prefix(), func(r app.Router) {
		r.Method(http.MethodGet, "/control-plane/health", http.HandlerFunc(m.handleFoundationHealth))
		r.Method(http.MethodGet, "/control-plane/snapshot", http.HandlerFunc(m.handleFoundationSnapshot))
		r.Method(http.MethodGet, "/control-plane/users", http.HandlerFunc(m.handleFoundationUsers))
		r.Method(http.MethodGet, "/control-plane/workspaces", http.HandlerFunc(m.handleFoundationWorkspaces))
		r.Method(http.MethodGet, "/control-plane/memberships", http.HandlerFunc(m.handleFoundationMemberships))
		r.Method(http.MethodGet, "/control-plane/invites", http.HandlerFunc(m.handleFoundationInvites))
		r.Method(http.MethodGet, "/workspaces", http.HandlerFunc(m.handleListWorkspaces))
		r.Method(http.MethodPost, "/workspaces", http.HandlerFunc(m.handleCreateWorkspace))
		r.Method(http.MethodGet, "/workspaces/{workspaceID}", http.HandlerFunc(m.handleGetWorkspace))
		r.Method(http.MethodPatch, "/workspaces/{workspaceID}", http.HandlerFunc(m.handleUpdateWorkspace))
		r.Method(http.MethodDelete, "/workspaces/{workspaceID}", http.HandlerFunc(m.handleDeleteWorkspace))
		r.Method(http.MethodGet, "/me/settings", http.HandlerFunc(m.handleGetSettings))
		r.Method(http.MethodPut, "/me/settings", http.HandlerFunc(m.handlePutSettings))
		r.Method(http.MethodGet, "/workspaces/{workspaceID}/runtime", http.HandlerFunc(m.handleGetWorkspaceRuntime))
		r.Method(http.MethodPost, "/workspaces/{workspaceID}/runtime/retry", http.HandlerFunc(m.handleRetryWorkspaceRuntime))
		r.Method(http.MethodGet, "/workspaces/{workspaceID}/settings", http.HandlerFunc(m.handleGetWorkspaceSettings))
		r.Method(http.MethodPut, "/workspaces/{workspaceID}/settings", http.HandlerFunc(m.handlePutWorkspaceSettings))
		r.Method(http.MethodGet, "/workspaces/{workspaceID}/members", http.HandlerFunc(m.handleListMembers))
		r.Method(http.MethodPut, "/workspaces/{workspaceID}/members/{userID}/role", http.HandlerFunc(m.handleUpdateMemberRole))
		r.Method(http.MethodDelete, "/workspaces/{workspaceID}/members/{userID}", http.HandlerFunc(m.handleRemoveMember))
		r.Method(http.MethodPost, "/workspaces/{workspaceID}/invites", http.HandlerFunc(m.handleCreateInvite))
		r.Method(http.MethodPost, "/workspaces/{workspaceID}/invites/{inviteID}/accept", http.HandlerFunc(m.handleAcceptInviteScoped))
		r.Method(http.MethodPost, "/workspaces/{workspaceID}/invites/{inviteID}/decline", http.HandlerFunc(m.handleDeclineInviteScoped))
		r.Method(http.MethodPost, "/invites/{inviteID}/accept", http.HandlerFunc(m.handleAcceptInvite))
		r.Method(http.MethodPost, "/invites/{inviteID}/decline", http.HandlerFunc(m.handleDeclineInvite))
	})
	router.With(m.workspaceBoundaryMiddleware()).Method(http.MethodGet, "/w/{workspaceID}/runtime", http.HandlerFunc(m.handleBoundaryGetWorkspaceRuntime))
	router.With(m.workspaceBoundaryMiddleware()).Method(http.MethodPost, "/w/{workspaceID}/runtime/retry", http.HandlerFunc(m.handleBoundaryRetryWorkspaceRuntime))
	router.With(m.workspaceBoundaryMiddleware()).Method(http.MethodGet, "/w/{workspaceID}/settings", http.HandlerFunc(m.handleBoundaryGetWorkspaceSettings))
	router.With(m.workspaceBoundaryMiddleware()).Method(http.MethodPut, "/w/{workspaceID}/settings", http.HandlerFunc(m.handleBoundaryPutWorkspaceSettings))
}

func (m *Module) OnAuthenticated(ctx context.Context, user auth.User) error {
	_, err := m.ensureUserAndDefaultWorkspace(ctx, auth.AuthContext{
		UserID:  strings.TrimSpace(user.ID),
		Email:   strings.TrimSpace(user.Email),
		IsOwner: user.IsOwner,
	}, false)
	return err
}

func (m *Module) BuildMePayload(ctx context.Context, authCtx auth.AuthContext) (map[string]any, error) {
	user, err := m.ensureUserAndDefaultWorkspace(ctx, authCtx, true)
	if err != nil {
		return nil, err
	}

	payload := map[string]any{
		"user_id":      strings.TrimSpace(asString(user["user_id"])),
		"email":        strings.ToLower(strings.TrimSpace(asString(user["email"]))),
		"display_name": strings.TrimSpace(asString(user["display_name"])),
	}
	return map[string]any{
		"ok":           true,
		"user":         cloneMap(payload),
		"me":           cloneMap(payload),
		"data":         cloneMap(payload),
		"user_id":      payload["user_id"],
		"email":        payload["email"],
		"display_name": payload["display_name"],
	}, nil
}

func (m *Module) handleListWorkspaces(w http.ResponseWriter, req *http.Request) {
	authCtx, repo := m.requireSessionAndRepo(req)
	workspaces, err := repo.ListWorkspaces(req.Context(), authCtx.UserID)
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"workspaces": workspaces,
		"count":      len(workspaces),
	})
}

func (m *Module) handleCreateWorkspace(w http.ResponseWriter, req *http.Request) {
	authCtx, repo := m.requireSessionAndRepo(req)

	var body map[string]any
	if err := decodeJSON(req, &body); err != nil && !errors.Is(err, io.EOF) {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_json", Message: err.Error()})
	}

	existing, err := repo.ListWorkspaces(req.Context(), authCtx.UserID)
	if err != nil {
		panic(err)
	}

	name := strings.TrimSpace(asString(body["name"]))
	if name == "" {
		name = fmt.Sprintf("Workspace %d", len(existing)+1)
	}

	workspaceID := "ws-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:8]
	workspace, err := repo.CreateWorkspace(req.Context(), workspaceID, map[string]any{
		"name":       name,
		"created_by": authCtx.UserID,
	})
	if err != nil {
		panic(err)
	}
	if err := m.seedWorkspaceSettings(req.Context(), repo, authCtx.UserID, workspaceID); err != nil {
		panic(err)
	}
	if err := m.seedWorkspaceRuntime(req.Context(), repo, workspaceID); err != nil {
		panic(err)
	}

	response := map[string]any{
		"ok":        true,
		"workspace": workspace,
		"id":        workspaceID,
	}
	for key, value := range workspace {
		response[key] = value
	}
	writeJSON(w, http.StatusCreated, response)
}

func (m *Module) seedWorkspaceSettings(ctx context.Context, repo Repository, userID, workspaceID string) error {
	settings, err := repo.GetSettings(ctx, userID)
	if err != nil {
		return err
	}
	defaultInstallationID := strings.TrimSpace(asString(settings["github_default_installation_id"]))
	if defaultInstallationID == "" {
		return nil
	}
	_, err = repo.SaveWorkspaceSettings(ctx, workspaceID, map[string]any{
		"github_installation_id": defaultInstallationID,
	})
	return err
}

func (m *Module) seedWorkspaceRuntime(ctx context.Context, repo Repository, workspaceID string) error {
	_, err := repo.SaveWorkspaceRuntime(ctx, workspaceID, map[string]any{
		"state":                     "pending",
		"retryable":                 true,
		"retry_count":               0,
		"provisioning_requested_at": nil,
	})
	return err
}

func (m *Module) handleGetWorkspace(w http.ResponseWriter, req *http.Request) {
	authCtx, repo := m.requireSessionAndRepo(req)
	workspaceID := strings.TrimSpace(app.URLParam(req, "workspaceID"))
	if workspaceID == "" {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_workspace_id", Message: "workspace_id is required"})
	}

	if !m.userHasMembership(req.Context(), repo, workspaceID, authCtx.UserID) {
		panic(app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: "Workspace not found"})
	}

	workspace, err := repo.GetWorkspace(req.Context(), workspaceID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			panic(app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: "Workspace not found"})
		}
		panic(err)
	}

	response := map[string]any{
		"ok":        true,
		"workspace": workspace,
	}
	for key, value := range workspace {
		response[key] = value
	}
	writeJSON(w, http.StatusOK, response)
}

func (m *Module) handleUpdateWorkspace(w http.ResponseWriter, req *http.Request) {
	authCtx, repo := m.requireSessionAndRepo(req)
	workspaceID := strings.TrimSpace(app.URLParam(req, "workspaceID"))
	if workspaceID == "" {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_workspace_id", Message: "workspace_id is required"})
	}

	role, found, err := m.workspaceRoleForUser(req.Context(), repo, workspaceID, authCtx.UserID)
	if err != nil {
		panic(err)
	}
	if !found {
		panic(app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: "Workspace not found"})
	}
	if role != "owner" {
		panic(app.APIError{Status: http.StatusForbidden, Code: "forbidden", Message: "Only workspace owners can update workspace details"})
	}

	var body map[string]any
	if err := decodeJSON(req, &body); err != nil {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_json", Message: err.Error()})
	}

	name := strings.TrimSpace(asString(body["name"]))
	if name == "" {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_name", Message: "name is required"})
	}

	workspace, err := repo.UpdateWorkspace(req.Context(), workspaceID, map[string]any{
		"name": name,
	})
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			panic(app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: "Workspace not found"})
		}
		panic(err)
	}

	response := map[string]any{
		"ok":        true,
		"workspace": workspace,
	}
	for key, value := range workspace {
		response[key] = value
	}
	writeJSON(w, http.StatusOK, response)
}

func (m *Module) handleDeleteWorkspace(w http.ResponseWriter, req *http.Request) {
	authCtx, repo := m.requireSessionAndRepo(req)
	workspaceID := strings.TrimSpace(app.URLParam(req, "workspaceID"))
	if workspaceID == "" {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_workspace_id", Message: "workspace_id is required"})
	}

	role, found, err := m.workspaceRoleForUser(req.Context(), repo, workspaceID, authCtx.UserID)
	if err != nil {
		panic(err)
	}
	if !found {
		panic(app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: "Workspace not found"})
	}
	if role != "owner" {
		panic(app.APIError{Status: http.StatusForbidden, Code: "forbidden", Message: "Only workspace owners can delete workspaces"})
	}

	if _, err := repo.SoftDeleteWorkspace(req.Context(), workspaceID); err != nil {
		if errors.Is(err, ErrNotFound) {
			panic(app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: "Workspace not found"})
		}
		panic(err)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"deleted": true,
	})
}

func (m *Module) handleGetWorkspaceRuntime(w http.ResponseWriter, req *http.Request) {
	authCtx, repo := m.requireSessionAndRepo(req)
	workspaceID := strings.TrimSpace(app.URLParam(req, "workspaceID"))
	if workspaceID == "" {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_workspace_id", Message: "workspace_id is required"})
	}
	if !m.userHasMembership(req.Context(), repo, workspaceID, authCtx.UserID) {
		panic(app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: "Workspace not found"})
	}

	runtime, err := repo.GetWorkspaceRuntime(req.Context(), workspaceID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			panic(app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: "Workspace not found"})
		}
		panic(err)
	}
	if runtime == nil {
		runtime, err = repo.SaveWorkspaceRuntime(req.Context(), workspaceID, map[string]any{
			"state":                     "pending",
			"retryable":                 true,
			"retry_count":               0,
			"provisioning_requested_at": nil,
		})
		if err != nil {
			panic(err)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"runtime": runtime,
	})
}

func (m *Module) handleRetryWorkspaceRuntime(w http.ResponseWriter, req *http.Request) {
	authCtx, repo := m.requireSessionAndRepo(req)
	workspaceID := strings.TrimSpace(app.URLParam(req, "workspaceID"))
	if workspaceID == "" {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_workspace_id", Message: "workspace_id is required"})
	}
	if !m.userHasMembership(req.Context(), repo, workspaceID, authCtx.UserID) {
		panic(app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: "Workspace not found"})
	}

	runtime, err := repo.GetWorkspaceRuntime(req.Context(), workspaceID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			panic(app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: "Workspace not found"})
		}
		panic(err)
	}
	if runtime == nil {
		runtime, err = repo.SaveWorkspaceRuntime(req.Context(), workspaceID, map[string]any{
			"state":                     "provisioning",
			"retryable":                 false,
			"retry_count":               1,
			"provisioning_requested_at": nowISO(m.now()),
		})
		if err != nil {
			panic(err)
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"runtime": runtime,
			"retried": true,
		})
		return
	}

	currentState := strings.ToLower(strings.TrimSpace(asString(runtime["state"])))
	if currentState == "ready" || currentState == "provisioning" {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"runtime": runtime,
			"retried": false,
		})
		return
	}

	currentRetryCount := 0
	switch value := runtime["retry_count"].(type) {
	case int:
		currentRetryCount = value
	case int64:
		currentRetryCount = int(value)
	case float64:
		currentRetryCount = int(value)
	}

	runtime["state"] = "provisioning"
	runtime["retryable"] = false
	runtime["retry_count"] = currentRetryCount + 1
	runtime["provisioning_requested_at"] = nowISO(m.now())

	updated, err := repo.SaveWorkspaceRuntime(req.Context(), workspaceID, runtime)
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"runtime": updated,
		"retried": true,
	})
}

func (m *Module) ensureUserAndDefaultWorkspace(ctx context.Context, authCtx auth.AuthContext, touchLastSeen bool) (map[string]any, error) {
	repo := m.currentRepo()
	if repo == nil {
		return nil, fmt.Errorf("control-plane repository is not configured")
	}

	userID, err := normalizeID(authCtx.UserID)
	if err != nil {
		return nil, err
	}

	userPatch := map[string]any{
		"email":        strings.ToLower(strings.TrimSpace(authCtx.Email)),
		"display_name": "",
	}
	if touchLastSeen {
		userPatch["last_seen_at"] = nowISO(m.now())
	}
	user, err := repo.CreateUser(ctx, userID, userPatch)
	if err != nil {
		return nil, err
	}

	workspaces, err := repo.ListWorkspaces(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(workspaces) == 0 {
		if _, err := repo.CreateWorkspace(ctx, defaultWorkspaceID(userID), map[string]any{
			"name":       "Workspace",
			"created_by": userID,
		}); err != nil {
			return nil, err
		}
	}

	return user, nil
}

func (m *Module) userHasMembership(ctx context.Context, repo Repository, workspaceID, userID string) bool {
	_, found, err := m.workspaceRoleForUser(ctx, repo, workspaceID, userID)
	return err == nil && found
}

func (m *Module) workspaceRoleForUser(ctx context.Context, repo Repository, workspaceID, userID string) (string, bool, error) {
	members, err := repo.ListMembers(ctx, workspaceID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return "", false, nil
		}
		return "", false, err
	}
	for _, member := range members {
		if strings.TrimSpace(asString(member["user_id"])) == strings.TrimSpace(userID) {
			return strings.TrimSpace(asString(member["role"])), true, nil
		}
	}
	return "", false, nil
}

func (m *Module) requireSessionAndRepo(req *http.Request) (auth.AuthContext, Repository) {
	authCtx, ok := auth.ContextFromRequest(req)
	if !ok {
		panic(app.APIError{Status: http.StatusUnauthorized, Code: "unauthorized", Message: "No active session"})
	}

	repo := m.currentRepo()
	if repo == nil {
		panic(app.APIError{Status: http.StatusInternalServerError, Code: "control_plane_unavailable", Message: "Control plane repository is not configured"})
	}
	return authCtx, repo
}

func (m *Module) currentRepo() Repository {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.repo
}

func (m *Module) setRepository(repo Repository, pool *pgxpool.Pool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.repo = repo
	m.pool = pool
}

func newRepository(cfg config.Config) (Repository, error) {
	return newLocalRepositoryFromConfig(cfg)
}

func newLocalRepositoryFromConfig(cfg config.Config) (Repository, error) {
	root := workspaceRoot(cfg)
	return NewLocalRepository(root)
}

func workspaceRoot(cfg config.Config) string {
	if strings.TrimSpace(cfg.ConfigPath) != "" {
		return filepath.Dir(cfg.ConfigPath)
	}
	root, err := config.FindProjectRoot()
	if err == nil {
		return root
	}
	dir, err := os.Getwd()
	if err == nil {
		return dir
	}
	return "."
}

func defaultWorkspaceID(userID string) string {
	sum := sha1.Sum([]byte("default-workspace:" + strings.TrimSpace(userID)))
	return "ws-" + hex.EncodeToString(sum[:])
}

func decodeJSON(req *http.Request, target any) error {
	defer req.Body.Close()
	return json.NewDecoder(req.Body).Decode(target)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
