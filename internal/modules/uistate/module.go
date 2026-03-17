package uistate

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/boringdata/boring-ui/internal/app"
	"github.com/boringdata/boring-ui/internal/config"
	"github.com/boringdata/boring-ui/internal/storage"
)

const modulePrefix = "/api/v1/ui"

type Module struct {
	service *Service
}

func NewModule(cfg config.Config, store storage.Storage) (*Module, error) {
	service, err := NewService(cfg, store)
	if err != nil {
		return nil, err
	}
	return &Module{service: service}, nil
}

func (m *Module) Name() string {
	return "ui_state"
}

func (m *Module) Prefix() string {
	return modulePrefix
}

func (m *Module) RegisterRoutes(router app.Router) {
	router.Route(m.Prefix(), func(r app.Router) {
		r.Method(http.MethodPut, "/state", http.HandlerFunc(m.handleUpsertState))
		r.Method(http.MethodPost, "/state", http.HandlerFunc(m.handleUpsertState))
		r.Method(http.MethodGet, "/state", http.HandlerFunc(m.handleListStates))
		r.Method(http.MethodGet, "/state/latest", http.HandlerFunc(m.handleLatestState))
		r.Method(http.MethodGet, "/state/{clientID}", http.HandlerFunc(m.handleGetState))
		r.Method(http.MethodDelete, "/state", http.HandlerFunc(m.handleClearStates))
		r.Method(http.MethodDelete, "/state/{clientID}", http.HandlerFunc(m.handleDeleteState))

		r.Method(http.MethodGet, "/panes", http.HandlerFunc(m.handleLatestPanes))
		r.Method(http.MethodGet, "/panes/{clientID}", http.HandlerFunc(m.handlePanesForClient))

		r.Method(http.MethodPost, "/commands", http.HandlerFunc(m.handleEnqueueCommand))
		r.Method(http.MethodGet, "/commands/next", http.HandlerFunc(m.handleNextCommand))
		r.Method(http.MethodPost, "/focus", http.HandlerFunc(m.handleFocus))
	})
}

func (m *Module) handleUpsertState(w http.ResponseWriter, req *http.Request) {
	body, err := decodeMap(req)
	if err != nil {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_json", Message: err.Error()})
	}
	stored, err := m.service.Upsert(body)
	if err != nil {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_state", Message: err.Error()})
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "state": stored})
}

func (m *Module) handleListStates(w http.ResponseWriter, _ *http.Request) {
	states := m.service.List()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "states": states, "count": len(states)})
}

func (m *Module) handleLatestState(w http.ResponseWriter, _ *http.Request) {
	state := m.service.GetLatest()
	if state == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"detail": "No frontend state has been published"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "state": state})
}

func (m *Module) handleGetState(w http.ResponseWriter, req *http.Request) {
	clientID := app.URLParam(req, "clientID")
	state := m.service.Get(clientID)
	if state == nil {
		panic(app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: "State not found"})
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "state": state})
}

func (m *Module) handleDeleteState(w http.ResponseWriter, req *http.Request) {
	clientID := app.URLParam(req, "clientID")
	deleted, err := m.service.Delete(clientID)
	if err != nil {
		panic(app.APIError{Status: http.StatusInternalServerError, Code: "delete_failed", Message: err.Error()})
	}
	if !deleted {
		panic(app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: "State not found"})
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "deleted": clientID})
}

func (m *Module) handleClearStates(w http.ResponseWriter, _ *http.Request) {
	cleared, err := m.service.Clear()
	if err != nil {
		panic(app.APIError{Status: http.StatusInternalServerError, Code: "clear_failed", Message: err.Error()})
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "cleared": cleared})
}

func (m *Module) handleLatestPanes(w http.ResponseWriter, _ *http.Request) {
	panes := m.service.ListOpenPanels("")
	if panes == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"detail": "No frontend state has been published"})
		return
	}
	response := map[string]any{"ok": true}
	for key, value := range panes {
		response[key] = value
	}
	writeJSON(w, http.StatusOK, response)
}

func (m *Module) handlePanesForClient(w http.ResponseWriter, req *http.Request) {
	clientID := app.URLParam(req, "clientID")
	panes := m.service.ListOpenPanels(clientID)
	if panes == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"detail": "State not found"})
		return
	}
	response := map[string]any{"ok": true}
	for key, value := range panes {
		response[key] = value
	}
	writeJSON(w, http.StatusOK, response)
}

func (m *Module) handleEnqueueCommand(w http.ResponseWriter, req *http.Request) {
	body, err := decodeMap(req)
	if err != nil {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_json", Message: err.Error()})
	}

	commandValue, ok := body["command"].(map[string]any)
	if !ok {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_command", Message: "command is required"})
	}
	targetClientID, err := m.resolveClientOr404(asString(body["client_id"]))
	if err != nil {
		panic(err)
	}
	command, err := m.validateCommand(commandValue, targetClientID)
	if err != nil {
		panic(err)
	}
	queued, err := m.service.EnqueueCommand(command, targetClientID)
	if err != nil {
		panic(app.APIError{Status: http.StatusInternalServerError, Code: "enqueue_failed", Message: err.Error()})
	}
	if queued == nil {
		panic(app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: "State not found"})
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "command": queued})
}

func (m *Module) handleNextCommand(w http.ResponseWriter, req *http.Request) {
	targetClientID, err := m.resolveClientOr404(req.URL.Query().Get("client_id"))
	if err != nil {
		panic(err)
	}
	command, err := m.service.PopNextCommand(targetClientID)
	if err != nil {
		panic(app.APIError{Status: http.StatusInternalServerError, Code: "queue_failed", Message: err.Error()})
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "command": command})
}

func (m *Module) handleFocus(w http.ResponseWriter, req *http.Request) {
	body, err := decodeMap(req)
	if err != nil {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_json", Message: err.Error()})
	}
	panelID := strings.TrimSpace(asString(body["panel_id"]))
	if panelID == "" {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_command", Message: "panel_id is required"})
	}
	targetClientID, err := m.resolveClientOr404(asString(body["client_id"]))
	if err != nil {
		panic(err)
	}
	command, err := m.validateCommand(map[string]any{"kind": "focus_panel", "panel_id": panelID}, targetClientID)
	if err != nil {
		panic(err)
	}
	queued, err := m.service.EnqueueCommand(command, targetClientID)
	if err != nil {
		panic(app.APIError{Status: http.StatusInternalServerError, Code: "enqueue_failed", Message: err.Error()})
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "command": queued})
}

func (m *Module) resolveClientOr404(clientID string) (string, error) {
	resolved := m.service.ResolveClientID(clientID)
	if resolved == "" {
		return "", app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: "No frontend state client is available"}
	}
	return resolved, nil
}

func (m *Module) validateCommand(command map[string]any, targetClientID string) (map[string]any, error) {
	normalized := cloneMap(command)
	kind := strings.TrimSpace(asString(normalized["kind"]))
	switch kind {
	case "focus_panel":
		panelID := strings.TrimSpace(asString(normalized["panel_id"]))
		if panelID == "" {
			return nil, app.APIError{Status: http.StatusBadRequest, Code: "invalid_command", Message: "focus_panel requires panel_id"}
		}
		panes := m.service.ListOpenPanels(targetClientID)
		panelIDs := map[string]struct{}{}
		if panes != nil {
			if openPanels, ok := panes["open_panels"].([]any); ok {
				for _, panel := range openPanels {
					if panelMap, ok := panel.(map[string]any); ok {
						id := strings.TrimSpace(asString(panelMap["id"]))
						if id != "" {
							panelIDs[id] = struct{}{}
						}
					}
				}
			}
		}
		if _, ok := panelIDs[panelID]; !ok {
			return nil, app.APIError{Status: http.StatusConflict, Code: "panel_not_open", Message: "panel is not currently open"}
		}
		normalized["panel_id"] = panelID
	case "open_panel":
		component := strings.TrimSpace(asString(normalized["component"]))
		if component == "" {
			return nil, app.APIError{Status: http.StatusBadRequest, Code: "invalid_command", Message: "open_panel requires component"}
		}
		normalized["component"] = component
	default:
		return nil, app.APIError{Status: http.StatusBadRequest, Code: "invalid_command", Message: "Unsupported command kind. Supported: focus_panel, open_panel"}
	}
	normalized["kind"] = kind
	return normalized, nil
}

func decodeMap(req *http.Request) (map[string]any, error) {
	defer req.Body.Close()
	var out map[string]any
	if err := json.NewDecoder(req.Body).Decode(&out); err != nil {
		return nil, err
	}
	if out == nil {
		return nil, errors.New("request body is required")
	}
	return out, nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	var buffer bytes.Buffer
	if err := json.NewEncoder(&buffer).Encode(payload); err != nil {
		http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(buffer.Bytes())
}
