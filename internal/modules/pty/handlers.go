package pty

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/boringdata/boring-ui/internal/app"
	"github.com/boringdata/boring-ui/internal/ws"
)

type createSessionRequest struct {
	Provider string `json:"provider"`
}

func (m *Module) registerLifecycleRoutes(router app.Router) {
	router.Route("/api/v1/pty", func(r app.Router) {
		r.Method(http.MethodPost, "/sessions", http.HandlerFunc(m.handleCreateSession))
		r.Method(http.MethodGet, "/sessions", http.HandlerFunc(m.handleListSessions))
		r.Method(http.MethodDelete, "/sessions/{id}", http.HandlerFunc(m.handleDeleteSession))
	})
}

func (m *Module) handleCreateSession(w http.ResponseWriter, req *http.Request) {
	body, err := decodeCreateSessionRequest(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	session, err := m.service.Create(body.Provider)
	if err != nil {
		if errors.Is(err, ws.ErrAtCapacity) {
			ws.WriteCapacityError(w)
			return
		}
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session_id": session.ID()})
}

func (m *Module) handleListSessions(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"sessions": m.service.ListSessions()})
}

func (m *Module) handleDeleteSession(w http.ResponseWriter, req *http.Request) {
	sessionID := app.URLParam(req, "id")
	if err := m.service.Delete(sessionID); err != nil {
		if errors.Is(err, ErrSessionNotFound) {
			http.Error(w, "session not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true, "session_id": sessionID})
}

func decodeCreateSessionRequest(req *http.Request) (createSessionRequest, error) {
	defer req.Body.Close()

	var body createSessionRequest
	data, err := io.ReadAll(req.Body)
	if err != nil {
		return body, err
	}
	if len(data) == 0 {
		return body, nil
	}
	if err := json.Unmarshal(data, &body); err != nil {
		return body, err
	}
	return body, nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
