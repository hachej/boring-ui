package controlplane

import (
	"errors"
	"io"
	"net/http"

	"github.com/boringdata/boring-ui/internal/app"
)

func (m *Module) handleGetSettings(w http.ResponseWriter, req *http.Request) {
	authCtx, repo := m.requireSessionAndRepo(req)
	settings, err := repo.GetSettings(req.Context(), authCtx.UserID)
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"settings": settings,
	})
}

func (m *Module) handlePutSettings(w http.ResponseWriter, req *http.Request) {
	authCtx, repo := m.requireSessionAndRepo(req)

	var body map[string]any
	if err := decodeJSON(req, &body); err != nil && !errors.Is(err, io.EOF) {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "INVALID_JSON", Message: err.Error()})
	}

	settings, err := repo.SaveSettings(req.Context(), authCtx.UserID, authCtx.Email, body)
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"settings": settings,
	})
}

func (m *Module) handleGetWorkspaceSettings(w http.ResponseWriter, req *http.Request) {
	_, repo, workspaceID := m.requireWorkspaceMember(req)
	settings, err := repo.GetWorkspaceSettings(req.Context(), workspaceID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			panic(app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: "Workspace not found"})
		}
		panic(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"settings": settings,
	})
}

func (m *Module) handlePutWorkspaceSettings(w http.ResponseWriter, req *http.Request) {
	_, repo, workspaceID := m.requireWorkspaceMember(req)

	var body map[string]any
	if err := decodeJSON(req, &body); err != nil && !errors.Is(err, io.EOF) {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "INVALID_JSON", Message: err.Error()})
	}

	settings, err := repo.SaveWorkspaceSettings(req.Context(), workspaceID, body)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			panic(app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: "Workspace not found"})
		}
		panic(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"settings": settings,
	})
}

