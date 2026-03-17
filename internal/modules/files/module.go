package files

import (
	"encoding/json"
	"net/http"

	"github.com/boringdata/boring-ui/internal/app"
	"github.com/boringdata/boring-ui/internal/config"
	"github.com/boringdata/boring-ui/internal/storage"
)

const modulePrefix = "/api/v1/files"

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
	return "files"
}

func (m *Module) Prefix() string {
	return modulePrefix
}

func (m *Module) RegisterRoutes(router app.Router) {
	router.Route(m.Prefix(), func(r app.Router) {
		r.Method(http.MethodGet, "/tree", http.HandlerFunc(m.handleList))
		r.Method(http.MethodGet, "/list", http.HandlerFunc(m.handleList))
		r.Method(http.MethodGet, "/content", http.HandlerFunc(m.handleRead))
		r.Method(http.MethodGet, "/read", http.HandlerFunc(m.handleRead))
		r.Method(http.MethodPut, "/content", http.HandlerFunc(m.handleWrite))
		r.Method(http.MethodPut, "/write", http.HandlerFunc(m.handleWrite))
		r.Method(http.MethodDelete, "/", http.HandlerFunc(m.handleDelete))
		r.Method(http.MethodDelete, "/delete", http.HandlerFunc(m.handleDelete))
		r.Method(http.MethodPost, "/search", http.HandlerFunc(m.handleSearch))
		r.Method(http.MethodGet, "/search", http.HandlerFunc(m.handleSearch))
		r.Method(http.MethodPost, "/mkdir", http.HandlerFunc(m.handleMkdir))
		r.Method(http.MethodPost, "/rename", http.HandlerFunc(m.handleRename))
		r.Method(http.MethodPost, "/move", http.HandlerFunc(m.handleMove))
	})
}

type contentRequest struct {
	Content string `json:"content"`
}

type searchRequest struct {
	Query   string `json:"q"`
	Pattern string `json:"pattern"`
	Path    string `json:"path"`
}

type mkdirRequest struct {
	Path string `json:"path"`
}

type renameRequest struct {
	OldPath string `json:"old_path"`
	NewPath string `json:"new_path"`
}

type moveRequest struct {
	SrcPath string `json:"src_path"`
	DestDir string `json:"dest_dir"`
}

func (m *Module) handleList(w http.ResponseWriter, req *http.Request) {
	payload, err := m.service.List(req.URL.Query().Get("path"))
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (m *Module) handleRead(w http.ResponseWriter, req *http.Request) {
	payload, err := m.service.Read(req.URL.Query().Get("path"))
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (m *Module) handleWrite(w http.ResponseWriter, req *http.Request) {
	var body contentRequest
	if err := decodeJSON(req, &body); err != nil {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_json", Message: err.Error()})
	}

	payload, err := m.service.Write(req.URL.Query().Get("path"), body.Content)
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (m *Module) handleDelete(w http.ResponseWriter, req *http.Request) {
	payload, err := m.service.Delete(req.URL.Query().Get("path"))
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (m *Module) handleSearch(w http.ResponseWriter, req *http.Request) {
	query := req.URL.Query().Get("q")
	path := req.URL.Query().Get("path")

	if req.Method == http.MethodPost {
		var body searchRequest
		if err := decodeJSON(req, &body); err != nil {
			panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_json", Message: err.Error()})
		}
		if body.Query != "" {
			query = body.Query
		}
		if body.Pattern != "" {
			query = body.Pattern
		}
		if body.Path != "" {
			path = body.Path
		}
	}

	payload, err := m.service.Search(req.Context(), query, path)
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (m *Module) handleMkdir(w http.ResponseWriter, req *http.Request) {
	var body mkdirRequest
	if err := decodeJSON(req, &body); err != nil {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_json", Message: err.Error()})
	}

	payload, err := m.service.Mkdir(body.Path)
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (m *Module) handleRename(w http.ResponseWriter, req *http.Request) {
	var body renameRequest
	if err := decodeJSON(req, &body); err != nil {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_json", Message: err.Error()})
	}

	payload, err := m.service.Rename(body.OldPath, body.NewPath)
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (m *Module) handleMove(w http.ResponseWriter, req *http.Request) {
	var body moveRequest
	if err := decodeJSON(req, &body); err != nil {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_json", Message: err.Error()})
	}

	payload, err := m.service.Move(body.SrcPath, body.DestDir)
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
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
