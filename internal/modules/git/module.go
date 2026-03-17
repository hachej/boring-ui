package git

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/boringdata/boring-ui/internal/app"
	"github.com/boringdata/boring-ui/internal/auth"
	"github.com/boringdata/boring-ui/internal/config"
	gitbackend "github.com/boringdata/boring-ui/internal/git"
)

const modulePrefix = "/api/v1/git"

type Module struct {
	service *Service
}

type addRequest struct {
	Paths []string `json:"paths"`
}

type authorRequest struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

type commitRequest struct {
	Message string        `json:"message"`
	Author  authorRequest `json:"author"`
}

type credentialsRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type remoteRequest struct {
	Remote      string              `json:"remote"`
	Branch      string              `json:"branch"`
	Credentials *credentialsRequest `json:"credentials"`
}

type cloneRequest struct {
	URL         string              `json:"url"`
	Branch      string              `json:"branch"`
	Credentials *credentialsRequest `json:"credentials"`
}

type checkoutRequest struct {
	Name string `json:"name"`
}

type createBranchRequest struct {
	Name     string `json:"name"`
	Checkout *bool  `json:"checkout,omitempty"`
}

type mergeRequest struct {
	Source  string `json:"source"`
	Message string `json:"message"`
}

type addRemoteRequest struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

func NewModule(cfg config.Config, backend gitbackend.GitBackend) (*Module, error) {
	service, err := NewService(cfg, backend)
	if err != nil {
		return nil, err
	}
	return &Module{service: service}, nil
}

func (m *Module) Name() string {
	return "git"
}

func (m *Module) Prefix() string {
	return modulePrefix
}

func (m *Module) RegisterRoutes(router app.Router) {
	router.Route(m.Prefix(), func(r app.Router) {
		r.Method(http.MethodGet, "/status", http.HandlerFunc(m.handleStatus))
		r.Method(http.MethodGet, "/diff", http.HandlerFunc(m.handleDiff))
		r.Method(http.MethodGet, "/show", http.HandlerFunc(m.handleShow))
		r.Method(http.MethodPost, "/init", http.HandlerFunc(m.handleInit))
		r.Method(http.MethodPost, "/add", http.HandlerFunc(m.handleAdd))
		r.Method(http.MethodPost, "/commit", http.HandlerFunc(m.handleCommit))
		r.Method(http.MethodPost, "/push", http.HandlerFunc(m.handlePush))
		r.Method(http.MethodPost, "/pull", http.HandlerFunc(m.handlePull))
		r.Method(http.MethodPost, "/clone", http.HandlerFunc(m.handleClone))
		r.Method(http.MethodGet, "/log", http.HandlerFunc(m.handleLog))
		r.Method(http.MethodGet, "/branches", http.HandlerFunc(m.handleBranches))
		r.Method(http.MethodGet, "/branch", http.HandlerFunc(m.handleCurrentBranch))
		r.Method(http.MethodPost, "/branch", http.HandlerFunc(m.handleCreateBranch))
		r.Method(http.MethodPost, "/checkout", http.HandlerFunc(m.handleCheckout))
		r.Method(http.MethodPost, "/merge", http.HandlerFunc(m.handleMerge))
		r.Method(http.MethodPost, "/remote", http.HandlerFunc(m.handleAddRemote))
		r.Method(http.MethodGet, "/remotes", http.HandlerFunc(m.handleRemotes))
	})
}

func (m *Module) handleStatus(w http.ResponseWriter, req *http.Request) {
	payload, err := m.service.Status(req.Context())
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (m *Module) handleDiff(w http.ResponseWriter, req *http.Request) {
	payload, err := m.service.Diff(req.Context(), req.URL.Query().Get("path"))
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (m *Module) handleShow(w http.ResponseWriter, req *http.Request) {
	payload, err := m.service.Show(req.Context(), req.URL.Query().Get("path"))
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (m *Module) handleInit(w http.ResponseWriter, req *http.Request) {
	payload, err := m.service.Init(req.Context())
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (m *Module) handleAdd(w http.ResponseWriter, req *http.Request) {
	var body addRequest
	if err := decodeJSON(req, &body); err != nil {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_json", Message: err.Error()})
	}
	payload, err := m.service.Add(req.Context(), body.Paths)
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (m *Module) handleCommit(w http.ResponseWriter, req *http.Request) {
	var body commitRequest
	if err := decodeJSON(req, &body); err != nil {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_json", Message: err.Error()})
	}
	payload, err := m.service.Commit(req.Context(), body.Message, body.Author.Name, body.Author.Email)
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (m *Module) handlePush(w http.ResponseWriter, req *http.Request) {
	requireOwner(req)
	var body remoteRequest
	if err := decodeJSON(req, &body); err != nil {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_json", Message: err.Error()})
	}
	payload, err := m.service.Push(req.Context(), body.Remote, body.Branch, body.Credentials.toGitCredentials())
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (m *Module) handlePull(w http.ResponseWriter, req *http.Request) {
	requireOwner(req)
	var body remoteRequest
	if err := decodeJSON(req, &body); err != nil {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_json", Message: err.Error()})
	}
	payload, err := m.service.Pull(req.Context(), body.Remote, body.Branch, body.Credentials.toGitCredentials())
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (m *Module) handleClone(w http.ResponseWriter, req *http.Request) {
	var body cloneRequest
	if err := decodeJSON(req, &body); err != nil {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_json", Message: err.Error()})
	}
	payload, err := m.service.Clone(req.Context(), body.URL, body.Branch, body.Credentials.toGitCredentials())
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (m *Module) handleLog(w http.ResponseWriter, req *http.Request) {
	limit := 50
	if raw := strings.TrimSpace(req.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_limit", Message: "limit must be an integer"})
		}
		if parsed <= 0 {
			panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_limit", Message: "limit must be positive"})
		}
		if parsed > 1000 {
			parsed = 1000
		}
		limit = parsed
	}
	payload, err := m.service.Log(req.Context(), limit)
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (m *Module) handleBranches(w http.ResponseWriter, req *http.Request) {
	payload, err := m.service.Branches(req.Context())
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (m *Module) handleCurrentBranch(w http.ResponseWriter, req *http.Request) {
	payload, err := m.service.CurrentBranch(req.Context())
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (m *Module) handleCreateBranch(w http.ResponseWriter, req *http.Request) {
	var body createBranchRequest
	if err := decodeJSON(req, &body); err != nil {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_json", Message: err.Error()})
	}
	checkout := true
	if body.Checkout != nil {
		checkout = *body.Checkout
	}
	payload, err := m.service.CreateBranch(req.Context(), body.Name, checkout)
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (m *Module) handleCheckout(w http.ResponseWriter, req *http.Request) {
	var body checkoutRequest
	if err := decodeJSON(req, &body); err != nil {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_json", Message: err.Error()})
	}
	payload, err := m.service.Checkout(req.Context(), body.Name)
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (m *Module) handleMerge(w http.ResponseWriter, req *http.Request) {
	var body mergeRequest
	if err := decodeJSON(req, &body); err != nil {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_json", Message: err.Error()})
	}
	payload, err := m.service.Merge(req.Context(), body.Source, body.Message)
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (m *Module) handleAddRemote(w http.ResponseWriter, req *http.Request) {
	var body addRemoteRequest
	if err := decodeJSON(req, &body); err != nil {
		panic(app.APIError{Status: http.StatusBadRequest, Code: "invalid_json", Message: err.Error()})
	}
	payload, err := m.service.AddRemote(req.Context(), body.Name, body.URL)
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (m *Module) handleRemotes(w http.ResponseWriter, req *http.Request) {
	payload, err := m.service.Remotes(req.Context())
	if err != nil {
		panic(err)
	}
	writeJSON(w, http.StatusOK, payload)
}

func (c *credentialsRequest) toGitCredentials() *gitbackend.GitCredentials {
	if c == nil || strings.TrimSpace(c.Username) == "" || strings.TrimSpace(c.Password) == "" {
		return nil
	}
	return &gitbackend.GitCredentials{
		Username: c.Username,
		Password: c.Password,
	}
}

func requireOwner(req *http.Request) {
	authCtx, ok := auth.ContextFromRequest(req)
	if !ok || !authCtx.IsOwner {
		panic(app.APIError{Status: http.StatusForbidden, Code: "forbidden", Message: "owner access required"})
	}
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
