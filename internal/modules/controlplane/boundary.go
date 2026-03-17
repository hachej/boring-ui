package controlplane

import (
	"net/http"
	"strings"

	"github.com/boringdata/boring-ui/internal/app"
	"github.com/boringdata/boring-ui/internal/auth"
)

func (m *Module) workspaceBoundaryMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			m.requireWorkspaceMember(req)
			next.ServeHTTP(w, req)
		})
	}
}

func (m *Module) requireWorkspaceMember(req *http.Request) (auth.AuthContext, Repository, string) {
	authCtx, repo := m.requireSessionAndRepo(req)
	workspaceID := strings.TrimSpace(app.URLParam(req, "workspaceID"))
	if workspaceID == "" {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_workspace_id", Message: "workspace_id is required"})
	}
	if !m.userHasMembership(req.Context(), repo, workspaceID, authCtx.UserID) {
		panic(app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: "Workspace not found"})
	}
	return authCtx, repo, workspaceID
}

func (m *Module) AuthorizeWorkspaceBoundary(req *http.Request) error {
	authCtx, repo := m.requireSessionAndRepo(req)
	workspaceID := strings.TrimSpace(app.URLParam(req, "workspaceID"))
	if workspaceID == "" {
		return app.APIError{Status: http.StatusBadRequest, Code: "INVALID_WORKSPACE_ID", Message: "workspace_id is required"}
	}
	if !m.userHasMembership(req.Context(), repo, workspaceID, authCtx.UserID) {
		return app.APIError{Status: http.StatusForbidden, Code: "WORKSPACE_MEMBERSHIP_REQUIRED", Message: "Workspace membership required"}
	}
	return nil
}

func (m *Module) handleBoundaryGetWorkspaceSettings(w http.ResponseWriter, req *http.Request) {
	m.handleGetWorkspaceSettings(w, req)
}

func (m *Module) handleBoundaryGetWorkspaceRuntime(w http.ResponseWriter, req *http.Request) {
	m.handleGetWorkspaceRuntime(w, req)
}

func (m *Module) handleBoundaryPutWorkspaceSettings(w http.ResponseWriter, req *http.Request) {
	m.handlePutWorkspaceSettings(w, req)
}

func (m *Module) handleBoundaryRetryWorkspaceRuntime(w http.ResponseWriter, req *http.Request) {
	m.handleRetryWorkspaceRuntime(w, req)
}
