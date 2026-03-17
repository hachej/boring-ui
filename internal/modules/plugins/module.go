package plugins

import (
	"context"
	"net/http"
	"os"
	"path/filepath"

	"github.com/boringdata/boring-ui/internal/app"
	"github.com/boringdata/boring-ui/internal/config"
	pluginpkg "github.com/boringdata/boring-ui/internal/plugins"
	"github.com/gorilla/websocket"
)

const (
	apiPrefix = "/api/x"
	wsPath    = "/ws/plugins"
)

type Module struct {
	manager  *pluginpkg.Manager
	proxy    *pluginpkg.Proxy
	upgrader websocket.Upgrader
}

func NewModule(cfg config.Config) (*Module, error) {
	root, err := workspaceRoot(cfg)
	if err != nil {
		return nil, err
	}
	manager, err := pluginpkg.NewManager(root)
	if err != nil {
		return nil, err
	}
	return &Module{
		manager:  manager,
		proxy:    pluginpkg.NewProxy(manager, pluginpkg.WithRequestSigner(manager.Signer())),
		upgrader: websocket.Upgrader{},
	}, nil
}

func (m *Module) Name() string {
	return "workspace_plugins"
}

func (m *Module) RegisterRoutes(router app.Router) {
	for _, method := range []string{
		http.MethodGet,
		http.MethodHead,
		http.MethodPost,
		http.MethodPut,
		http.MethodPatch,
		http.MethodDelete,
		http.MethodOptions,
	} {
		router.Method(method, apiPrefix+"/*", http.HandlerFunc(m.handleProxy))
	}
	router.HandleWebSocket(wsPath, http.HandlerFunc(m.handleEvents))
}

func (m *Module) Start(ctx context.Context) error {
	return m.manager.Start(ctx)
}

func (m *Module) Stop(ctx context.Context) error {
	return m.manager.Stop(ctx)
}

func (m *Module) handleProxy(w http.ResponseWriter, req *http.Request) {
	m.proxy.ServeHTTP(w, req)
}

func (m *Module) handleEvents(w http.ResponseWriter, req *http.Request) {
	conn, err := m.upgrader.Upgrade(w, req, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	events, unsubscribe := m.manager.Subscribe(8)
	defer unsubscribe()

	for event := range events {
		if err := conn.WriteJSON(event); err != nil {
			return
		}
	}
}

func workspaceRoot(cfg config.Config) (string, error) {
	if cfg.ConfigPath != "" {
		return filepath.Dir(cfg.ConfigPath), nil
	}
	root, err := config.FindProjectRoot()
	if err == nil {
		return root, nil
	}
	dir, cwdErr := os.Getwd()
	if cwdErr != nil {
		return ".", cwdErr
	}
	return dir, nil
}
