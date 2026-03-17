package controlplane

import (
	"net/http"

	"github.com/boringdata/boring-ui/internal/app"
)

func (m *Module) handleFoundationHealth(w http.ResponseWriter, req *http.Request) {
	_, repo := m.requireSessionAndRepo(req)
	snapshot, err := repo.Snapshot(req.Context())
	if err != nil {
		panic(err)
	}
	state := stateFromMap(snapshot)

	storage := "local-json"
	if _, ok := repo.(*PostgresRepository); ok {
		storage = "postgres"
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":             true,
		"storage":        storage,
		"state_path":     localStateFilePath,
		"workspace_root": workspaceRoot(m.cfg),
		"counts": map[string]any{
			"users":              len(state.Users),
			"workspaces":         len(state.Workspaces),
			"memberships":        len(state.Memberships),
			"invites":            len(state.Invites),
			"workspace_settings": len(state.WorkspaceSettings),
			"workspace_runtime":  len(state.WorkspaceRuntime),
		},
	})
}

func (m *Module) handleFoundationSnapshot(w http.ResponseWriter, req *http.Request) {
	_, repo := m.requireSessionAndRepo(req)
	snapshot, err := repo.Snapshot(req.Context())
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"snapshot": snapshot,
	})
}

func (m *Module) handleFoundationUsers(w http.ResponseWriter, req *http.Request) {
	m.writeFoundationBucket(w, req, "users")
}

func (m *Module) handleFoundationWorkspaces(w http.ResponseWriter, req *http.Request) {
	m.writeFoundationBucket(w, req, "workspaces")
}

func (m *Module) handleFoundationMemberships(w http.ResponseWriter, req *http.Request) {
	m.writeFoundationBucket(w, req, "memberships")
}

func (m *Module) handleFoundationInvites(w http.ResponseWriter, req *http.Request) {
	m.writeFoundationBucket(w, req, "invites")
}

func (m *Module) writeFoundationBucket(w http.ResponseWriter, req *http.Request, bucket string) {
	_, repo := m.requireSessionAndRepo(req)
	snapshot, err := repo.Snapshot(req.Context())
	if err != nil {
		panic(err)
	}
	state := stateFromMap(snapshot)

	var records []map[string]any
	switch bucket {
	case "users":
		records = sortedRecords(state.Users)
	case "workspaces":
		records = sortedRecords(state.Workspaces)
	case "memberships":
		records = sortedRecords(state.Memberships)
	case "invites":
		records = sortedRecords(state.Invites)
	default:
		panic(app.APIError{Status: http.StatusInternalServerError, Code: "invalid_bucket", Message: "unsupported foundation bucket"})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":    true,
		bucket:  records,
		"count": len(records),
	})
}
