package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
)

var initCmd = &cobra.Command{
	Use:   "init <name>",
	Short: "Scaffold a new boring-ui child app",
	Long: `Scaffold boring.app.toml and starter backend files for a boring-ui child app.

Run 'bui docs init' for the full child app guide.`,
	Args: cobra.ExactArgs(1),
	RunE: runInit,
}

var initGo bool

func init() {
	initCmd.Flags().BoolVar(&initGo, "go", false, "Scaffold a Go child app instead of the default Python app")
	rootCmd.AddCommand(initCmd)
}

func runInit(cmd *cobra.Command, args []string) error {
	name := args[0]

	// Validate name (alphanumeric + hyphens)
	for _, c := range name {
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-') {
			return fmt.Errorf("app name must be lowercase alphanumeric with hyphens, got %q", name)
		}
	}

	// Create directory
	if _, err := os.Stat(name); err == nil {
		return fmt.Errorf("directory %q already exists", name)
	}

	fmt.Printf("[bui] creating %s/\n", name)

	siblingBUI, fwCommit := detectFrameworkRepo()
	if initGo {
		return scaffoldGoApp(name, siblingBUI, fwCommit)
	}
	return scaffoldPythonApp(name, fwCommit)
}

func scaffoldPythonApp(name, fwCommit string) error {
	pyName := strings.ReplaceAll(name, "-", "_")

	dirs := []string{
		name,
		filepath.Join(name, "src", pyName, "routers"),
		filepath.Join(name, "panels"),
	}
	for _, d := range dirs {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return fmt.Errorf("mkdir %s: %w", d, err)
		}
	}

	fwSection := frameworkSection(fwCommit)
	toml := fmt.Sprintf(`# boring.app.toml — Configuration for %s

[app]
name = %q
logo = %q
id   = %q
%s
# ─── Backend ───────────────────────────────────────────────
[backend]
entry   = "%s.app:create_app"
port    = 8000
routers = []

# ─── Frontend ──────────────────────────────────────────────
[frontend]
port = 5173

[frontend.branding]
name = %q

[frontend.features]
agentRailMode = "all"

[frontend.data]
backend = "http"

[frontend.panels]

# ─── CLI binary (agent-discoverable) ──────────────────────
[cli]
# Child app CLI on PATH. bui run <args...> delegates here.
name = %q

# Optional legacy aliases:
# [cli.commands]
# hello = { run = %q, description = "Run the hello command" }

# ─── Auth ─────────────────────────────────────────────────
[auth]
provider       = "local"
session_cookie = "boring_session"
session_ttl    = 86400

# ─── Deploy ──────────────────────────────────────────────
[deploy]
platform = "modal"
env      = "prod"

[deploy.secrets]
ANTHROPIC_API_KEY = { vault = "secret/agent/anthropic", field = "api_key" }

# [deploy.env_vars]
# App-specific static env vars (non-secret, baked into container)
# MY_SETTING = "value"

[deploy.neon]
# Populated by 'bui neon setup'

[deploy.modal]
app_name       = %q
min_containers = 0
`, name, name, strings.ToUpper(name[:1]), name, fwSection, pyName, name, name, fmt.Sprintf("%s hello", name), name)

	writeFile(filepath.Join(name, "boring.app.toml"), toml)

	pyproject := fmt.Sprintf(`[build-system]
requires = ["setuptools>=68.0"]
build-backend = "setuptools.backends._legacy:_Backend"

[project]
name = %q
version = "0.1.0"
requires-python = ">=3.11"
dependencies = []

[tool.setuptools.packages.find]
where = ["src"]
`, name)
	writeFile(filepath.Join(name, "pyproject.toml"), pyproject)

	writeFile(filepath.Join(name, "src", pyName, "__init__.py"), "")
	appPy := `"""Application entrypoint for the child app."""
from boring_ui.app_config_loader import create_app_from_toml

from .routers.example import router as example_router


def create_app():
    app = create_app_from_toml()
    app.include_router(example_router)
    return app
`
	writeFile(filepath.Join(name, "src", pyName, "app.py"), appPy)
	writeFile(filepath.Join(name, "src", pyName, "routers", "__init__.py"), "")

	exampleRouter := fmt.Sprintf(`"""Example router for %s."""
from fastapi import APIRouter

router = APIRouter(prefix="/api/v1/%s", tags=[%q])


@router.get("/health")
async def health():
    return {"ok": True, "app": %q}
`, name, pyName, name, name)
	writeFile(filepath.Join(name, "src", pyName, "routers", "example.py"), exampleRouter)

	writeCommonFiles(name)
	printInitNextSteps(name)
	return nil
}

func scaffoldGoApp(name, siblingBUI, fwCommit string) error {
	dirs := []string{
		name,
		filepath.Join(name, "hello"),
	}
	for _, d := range dirs {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return fmt.Errorf("mkdir %s: %w", d, err)
		}
	}

	fwSection := frameworkSection(fwCommit)
	toml := fmt.Sprintf(`# boring.app.toml — Configuration for %s

[app]
name = %q
logo = %q
id   = %q
%s
[backend]
type  = "go"
entry = "."
port  = 8000

[frontend]
port = 5173

[frontend.branding]
name = %q

[frontend.features]
agentRailMode = "all"

[frontend.data]
backend = "http"

[auth]
provider       = "local"
session_cookie = "boring_session"
session_ttl    = 86400
`, name, name, strings.ToUpper(name[:1]), name, fwSection, name)
	writeFile(filepath.Join(name, "boring.app.toml"), toml)

	goMod := fmt.Sprintf(`module %s

go 1.24
`, name)
	if siblingBUI != "" {
		goMod += "\nrequire github.com/boringdata/boring-ui v0.0.0\n"
		goMod += fmt.Sprintf("\nreplace github.com/boringdata/boring-ui => %s\n", filepath.Clean(filepath.Join("..", filepath.Base(siblingBUI))))
	}
	writeFile(filepath.Join(name, "go.mod"), goMod)

	mainGo := fmt.Sprintf(`package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	boringui "github.com/boringdata/boring-ui"
	"%s/hello"
)

func main() {
	cfg, err := boringui.LoadConfig("")
	if err != nil {
		slog.Error("load config", "error", err)
		os.Exit(1)
	}

	application, err := boringui.BuildApp(cfg)
	if err != nil {
		slog.Error("build application", "error", err)
		os.Exit(1)
	}
	application.AddModule(hello.NewModule())

	if err := application.Start(context.Background()); err != nil {
		slog.Error("start application modules", "error", err)
		os.Exit(1)
	}
	defer func() {
		stopCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := application.Stop(stopCtx); err != nil {
			slog.Error("stop application modules", "error", err)
		}
	}()

	server := &http.Server{
		Addr:              cfg.ListenAddress(),
		Handler:           application.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			slog.Error("shutdown server", "error", err)
		}
	}()

	slog.Info("starting child app go backend", "addr", server.Addr, "config", cfg.ConfigPath)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server exited", "error", err)
		os.Exit(1)
	}
}
`, name)
	writeFile(filepath.Join(name, "main.go"), mainGo)

	helloModule := `package hello

import (
	"net/http"

	boringui "github.com/boringdata/boring-ui"
)

type Module struct{}

func NewModule() *Module {
	return &Module{}
}

func (m *Module) Name() string {
	return "hello"
}

func (m *Module) RegisterRoutes(router boringui.Router) {
	router.Route("/api/v1/hello", func(r boringui.Router) {
		r.Method(http.MethodGet, "/ping", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(` + "`" + `{"ok":true,"message":"hello from go child app"}` + "`" + `))
		}))
	})
}
`
	writeFile(filepath.Join(name, "hello", "module.go"), helloModule)

	writeCommonFiles(name)
	if siblingBUI == "" {
		fmt.Println("[bui] warn: no local boring-ui sibling detected; skipping go mod tidy.")
		fmt.Println("[bui] warn: once the framework module is reachable, run: go get github.com/boringdata/boring-ui@latest && go mod tidy")
		printInitNextSteps(name)
		return nil
	}
	if err := finalizeGoModule(name); err != nil {
		fmt.Printf("[bui] warn: %v\n", err)
		fmt.Println("[bui] warn: run 'go mod tidy' after installing Go or fixing framework resolution.")
	}
	printInitNextSteps(name)
	return nil
}

func finalizeGoModule(projectRoot string) error {
	if _, err := lookPath("go"); err != nil {
		return fmt.Errorf("resolve go toolchain for generated app: %w", err)
	}

	fmt.Println("[bui] resolving Go module dependencies...")
	tidy := exec.Command("go", "mod", "tidy")
	tidy.Dir = projectRoot
	output, err := tidy.CombinedOutput()
	if err != nil {
		return fmt.Errorf("go mod tidy for %s: %w\n%s", projectRoot, err, strings.TrimSpace(string(output)))
	}
	return nil
}

func detectFrameworkRepo() (string, string) {
	siblingBUI := filepath.Join(".", "boring-ui")
	if _, err := os.Stat(filepath.Join(siblingBUI, "boring.app.toml")); err != nil {
		siblingBUI = filepath.Join("..", "boring-ui")
	}
	fwCommit := ""
	if _, err := os.Stat(filepath.Join(siblingBUI, ".git")); err == nil {
		headCmd := exec.Command("git", "rev-parse", "HEAD")
		headCmd.Dir = siblingBUI
		if out, err := headCmd.Output(); err == nil {
			fwCommit = strings.TrimSpace(string(out))
		}
	}
	if _, err := os.Stat(filepath.Join(siblingBUI, "go.mod")); err != nil {
		siblingBUI = ""
	}
	return siblingBUI, fwCommit
}

func frameworkSection(fwCommit string) string {
	if fwCommit != "" {
		return fmt.Sprintf(`
[framework]
repo   = "github.com/boringdata/boring-ui"
commit = %q
`, fwCommit)
	}
	return `
# [framework]
# repo   = "github.com/boringdata/boring-ui"
# commit = ""  # set with 'bui upgrade'
`
}

func writeCommonFiles(name string) {
	gitignore := `.boring/
.venv/
.air/
dist/
node_modules/
__pycache__/
*.pyc
.env
`
	writeFile(filepath.Join(name, ".gitignore"), gitignore)

	// .env.example
	envExample := `# Local dev secrets — copy to .env and fill in
ANTHROPIC_API_KEY=sk-ant-...
BORING_UI_SESSION_SECRET=dev-only-local-secret
`
	writeFile(filepath.Join(name, ".env.example"), envExample)
}

func printInitNextSteps(name string) {
	fmt.Println()
	fmt.Printf("[bui] %s created!\n\n", name)
	fmt.Println("Next steps:")
	fmt.Printf("  cd %s\n", name)
	fmt.Println("  cp .env.example .env       # add your API keys")
	fmt.Println("  bui dev                    # start dev server")
	fmt.Println()
	fmt.Println("For production:")
	fmt.Println("  bui neon setup             # provision database + auth")
	fmt.Println("  bui deploy                 # build + deploy to Modal")
}

func writeFile(path, content string) {
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "warn: write %s: %v\n", path, err)
	}
}
