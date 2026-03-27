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
var initPython bool

func init() {
	initCmd.Flags().BoolVar(&initGo, "go", false, "Scaffold a Go child app instead of the default TypeScript app")
	initCmd.Flags().BoolVar(&initPython, "python", false, "Scaffold a Python child app instead of the default TypeScript app")
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

	if initGo && initPython {
		return fmt.Errorf("choose at most one scaffold runtime flag (--go or --python)")
	}

	siblingBUI, fwCommit := detectFrameworkRepo()
	if initGo {
		return scaffoldGoApp(name, siblingBUI, fwCommit)
	}
	if initPython {
		return scaffoldPythonApp(name, fwCommit)
	}
	return scaffoldTypeScriptApp(name, fwCommit)
}

func scaffoldPythonApp(name, fwCommit string) error {
	pyName := strings.ReplaceAll(name, "-", "_")

	dirs := []string{
		name,
		filepath.Join(name, "deploy", "fly"),
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
platform = "fly"
env      = "prod"

[deploy.secrets]
ANTHROPIC_API_KEY = { vault = "secret/agent/anthropic", field = "api_key" }

# [deploy.env_vars]
# App-specific static env vars (non-secret, baked into container)
# MY_SETTING = "value"

[deploy.neon]
# Populated by 'bui neon setup'

[deploy.fly]
org               = ""
control_plane_app = %q
region            = "cdg"
`, name, name, strings.ToUpper(name[:1]), name, fwSection, pyName, name, name, fmt.Sprintf("%s hello", name), name)

	writeFile(filepath.Join(name, "boring.app.toml"), toml)

	pyproject := fmt.Sprintf(`[build-system]
requires = ["setuptools>=68.0"]
build-backend = "setuptools.build_meta"

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
	appPy := `"""Application entrypoint — mounts custom routers before the SPA catch-all.

The framework registers /health and a static /{path:path} catch-all.
Custom routes must be inserted between these so they take priority.
This module handles that automatically.
"""
from boring_ui.app_config_loader import create_app_from_toml

from .routers.example import router as example_router


def create_app():
    app = create_app_from_toml()

    # -- Route reordering: custom routes BEFORE the SPA catch-all ----------
    # The framework adds: /health (default) + /{full_path:path} (SPA).
    # We need: custom /health first, then other custom routes, then SPA last.

    # 1. Remove the framework's default /health and the SPA catch-all
    keep = []
    spa_routes = []
    for route in app.routes:
        path = getattr(route, "path", "")
        if path == "/health":
            continue  # drop framework /health — we provide our own
        if "{" in path and path.count("/") <= 1:
            spa_routes.append(route)  # save SPA catch-all for re-append
            continue
        keep.append(route)

    # 2. Rebuild: kept routes → custom routers → SPA catch-all (last)
    app.routes[:] = keep
    app.include_router(example_router)
    app.routes.extend(spa_routes)

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

	writeFlyPythonFiles(name, pyName)
	writeCommonFiles(name)
	printInitNextSteps(name, "python")
	return nil
}

func scaffoldTypeScriptApp(name, fwCommit string) error {
	dirs := []string{
		name,
		filepath.Join(name, "deploy", "fly"),
		filepath.Join(name, "src", "server", "routes"),
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
[workspace]
backend = "bwrap"

[agent]
runtime   = "pi"
placement = "browser"

# ─── Backend ───────────────────────────────────────────────
[backend]
type    = "typescript"
entry   = "src/server/index.ts"
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
name = %q

# ─── Auth ─────────────────────────────────────────────────
[auth]
provider       = "local"
session_cookie = "boring_session"
session_ttl    = 86400

# ─── Deploy ──────────────────────────────────────────────
[deploy]
platform = "fly"
env      = "prod"

[deploy.secrets]
ANTHROPIC_API_KEY = { vault = "secret/agent/anthropic", field = "api_key" }

# [deploy.env_vars]
# App-specific static env vars (non-secret, baked into container)
# MY_SETTING = "value"

[deploy.neon]
# Populated by 'bui neon setup'

[deploy.fly]
org               = ""
control_plane_app = %q
region            = "cdg"
`, name, name, strings.ToUpper(name[:1]), name, fwSection, name, name, name)
	writeFile(filepath.Join(name, "boring.app.toml"), toml)

	packageJSON := fmt.Sprintf(`{
  "name": %q,
  "private": true,
  "type": "module",
  "scripts": {
    "dev:server": "tsx watch src/server/index.ts"
  },
  "dependencies": {
    "tsx": "^4.19.4"
  }
}
`, name)
	writeFile(filepath.Join(name, "package.json"), packageJSON)

	serverEntry := fmt.Sprintf(`import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { registerExampleRoutes } from './routes/example.js'

function resolveFrameworkRoot() {
  const explicit = process.env.BUI_FRAMEWORK_ROOT?.trim()
  if (explicit) return path.resolve(explicit)
  return path.resolve(process.cwd(), '..', 'boring-ui')
}

async function importFrameworkModule(relativePath) {
  const href = pathToFileURL(path.join(resolveFrameworkRoot(), relativePath)).href
  return import(href)
}

const [{ createApp }, { loadConfig, validateConfig }] = await Promise.all([
  importFrameworkModule('src/server/app.ts'),
  importFrameworkModule('src/server/config.ts'),
])

const config = loadConfig()

try {
  validateConfig(config)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}

const app = createApp({ config, logger: true, skipValidation: true })

app.get('/info', async () => ({
  name: %q,
  version: '0.1.0',
}))

registerExampleRoutes(app)

app.listen({ port: config.port, host: config.host }, (err, address) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
  app.log.info('Server listening at ' + address)
})
`, name)
	writeFile(filepath.Join(name, "src", "server", "index.ts"), serverEntry)

	exampleRoutes := fmt.Sprintf(`export function registerExampleRoutes(app) {
  app.get('/api/x/example/ping', async () => ({
    ok: true,
    app: %q,
  }))
}
`, name)
	writeFile(filepath.Join(name, "src", "server", "routes", "example.ts"), exampleRoutes)

	writeFlyTypeScriptFiles(name)
	writeCommonFiles(name)
	printInitNextSteps(name, "typescript")
	return nil
}

func scaffoldGoApp(name, siblingBUI, fwCommit string) error {
	dirs := []string{
		name,
		filepath.Join(name, "deploy", "fly"),
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

# ─── Deploy ──────────────────────────────────────────────
[deploy]
platform = "fly"
env      = "prod"

[deploy.secrets]
ANTHROPIC_API_KEY = { vault = "secret/agent/anthropic", field = "api_key" }

# [deploy.env_vars]
# App-specific static env vars (non-secret, baked into container)
# MY_SETTING = "value"

[deploy.neon]
# Populated by 'bui neon setup'

[deploy.fly]
org               = ""
control_plane_app = %q
region            = "cdg"
`, name, name, strings.ToUpper(name[:1]), name, fwSection, name, name)
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

	writeFlyGoFiles(name)
	writeCommonFiles(name)
	if siblingBUI == "" {
		fmt.Println("[bui] warn: no local boring-ui sibling detected; skipping go mod tidy.")
		fmt.Println("[bui] warn: once the framework module is reachable, run: go get github.com/boringdata/boring-ui@latest && go mod tidy")
		printInitNextSteps(name, "go")
		return nil
	}
	if err := finalizeGoModule(name); err != nil {
		fmt.Printf("[bui] warn: %v\n", err)
		fmt.Println("[bui] warn: run 'go mod tidy' after installing Go or fixing framework resolution.")
	}
	printInitNextSteps(name, "go")
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

	dockerignore := `.git
.venv
.air
dist
node_modules
__pycache__
*.pyc
.pytest_cache
.ruff_cache
*.egg-info
.boring
.env
`
	writeFile(filepath.Join(name, ".dockerignore"), dockerignore)

	// .env.example
	envExample := `# Local dev secrets — copy to .env and fill in
ANTHROPIC_API_KEY=sk-ant-...
BORING_UI_SESSION_SECRET=dev-only-local-secret
`
	writeFile(filepath.Join(name, ".env.example"), envExample)
}

func writeFlyPythonFiles(name, pyName string) {
	writeFile(filepath.Join(name, "deploy", "fly", "fly.toml"), flyTomlTemplate(name))
	writeFile(filepath.Join(name, "deploy", "fly", "Dockerfile"), pythonFlyDockerfileTemplate(pyName))
}

func writeFlyTypeScriptFiles(name string) {
	writeFile(filepath.Join(name, "deploy", "fly", "fly.toml"), flyTomlTemplate(name))
	writeFile(filepath.Join(name, "deploy", "fly", "Dockerfile"), typeScriptFlyDockerfileTemplate())
}

func writeFlyGoFiles(name string) {
	writeFile(filepath.Join(name, "deploy", "fly", "fly.toml"), flyTomlTemplate(name))
	writeFile(filepath.Join(name, "deploy", "fly", "Dockerfile"), goFlyDockerfileTemplate())
}

func flyTomlTemplate(name string) string {
	return fmt.Sprintf(`app = %q
primary_region = "cdg"

[build]
  dockerfile = "Dockerfile"

[env]
  APP_ENV = "production"
  AUTH_SESSION_SECURE_COOKIE = "true"
  AGENT_PLACEMENT = "browser"
  AGENT_RUNTIME = "pi"
  BORING_UI_STATIC_DIR = "/app/dist/web"
  BUI_APP_TOML = "/app/boring.app.toml"
  CORS_ORIGINS = "https://`+name+`.fly.dev"
  WORKSPACE_BACKEND = "bwrap"

[http_service]
  internal_port = 8000
  force_https = true
  auto_start_machines = true
  auto_stop_machines = "off"
  min_machines_running = 1
  processes = ["app"]

  [[http_service.checks]]
    grace_period = "10s"
    interval = "15s"
    method = "GET"
    timeout = "5s"
    path = "/health"

[vm]
  cpu_kind = "shared"
  cpus = 1
  memory = "512mb"
`, name)
}

func pythonFlyDockerfileTemplate(pyName string) string {
	return fmt.Sprintf(`# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS frontend-build

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/app
COPY . .

RUN set -eux; \
    FRAMEWORK_REPO="$(awk -F'"' '/^repo[[:space:]]*=/{print $2; exit}' boring.app.toml)"; \
    FRAMEWORK_COMMIT="$(awk -F'"' '/^commit[[:space:]]*=/{print $2; exit}' boring.app.toml)"; \
    if [ -z "$FRAMEWORK_REPO" ]; then FRAMEWORK_REPO="github.com/boringdata/boring-ui"; fi; \
    git clone "https://${FRAMEWORK_REPO}.git" /opt/boring-ui; \
    if [ -n "$FRAMEWORK_COMMIT" ]; then git -C /opt/boring-ui checkout "$FRAMEWORK_COMMIT"; fi; \
    cd /opt/boring-ui; \
    npm install --no-audit --no-fund; \
    BUI_APP_TOML=/workspace/app/boring.app.toml npx vite build --outDir /workspace/app/dist/web

FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    BORING_UI_STATIC_DIR=/app/dist/web \
    BUI_APP_TOML=/app/boring.app.toml

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

COPY . .
COPY --from=frontend-build /opt/boring-ui /opt/boring-ui
COPY --from=frontend-build /workspace/app/dist ./dist

RUN pip install --no-cache-dir /opt/boring-ui && \
    pip install --no-cache-dir .

EXPOSE 8000

CMD ["uvicorn", "%s.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
`, pyName)
}

func typeScriptFlyDockerfileTemplate() string {
	return `# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS frontend-build

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/app
COPY . .

RUN set -eux; \
    FRAMEWORK_REPO="$(awk -F'"' '/^repo[[:space:]]*=/{print $2; exit}' boring.app.toml)"; \
    FRAMEWORK_COMMIT="$(awk -F'"' '/^commit[[:space:]]*=/{print $2; exit}' boring.app.toml)"; \
    if [ -z "$FRAMEWORK_REPO" ]; then FRAMEWORK_REPO="github.com/boringdata/boring-ui"; fi; \
    git clone "https://${FRAMEWORK_REPO}.git" /opt/boring-ui; \
    if [ -n "$FRAMEWORK_COMMIT" ]; then git -C /opt/boring-ui checkout "$FRAMEWORK_COMMIT"; fi; \
    cd /opt/boring-ui; \
    npm install --no-audit --no-fund; \
    BUI_APP_TOML=/workspace/app/boring.app.toml npx vite build --outDir /workspace/app/dist/web

FROM node:20-bookworm-slim

ENV BORING_UI_STATIC_DIR=/app/dist/web \
    BUI_APP_TOML=/app/boring.app.toml \
    BUI_FRAMEWORK_ROOT=/opt/boring-ui \
    NODE_ENV=production

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    bubblewrap \
    ca-certificates \
    curl \
    git \
    jq \
    python3 \
    python3-venv \
    ripgrep \
    tree \
    && rm -rf /var/lib/apt/lists/*

COPY . .
COPY --from=frontend-build /opt/boring-ui /opt/boring-ui
COPY --from=frontend-build /workspace/app/dist ./dist

RUN cd /opt/boring-ui && npm install --no-audit --no-fund && \
    cd /app && npm install --no-audit --no-fund

EXPOSE 8000

CMD ["node", "--import", "tsx", "src/server/index.ts"]
`
}

func goFlyDockerfileTemplate() string {
	return `# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS frontend-build

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/app
COPY . .

RUN set -eux; \
    FRAMEWORK_REPO="$(awk -F'"' '/^repo[[:space:]]*=/{print $2; exit}' boring.app.toml)"; \
    FRAMEWORK_COMMIT="$(awk -F'"' '/^commit[[:space:]]*=/{print $2; exit}' boring.app.toml)"; \
    if [ -z "$FRAMEWORK_REPO" ]; then FRAMEWORK_REPO="github.com/boringdata/boring-ui"; fi; \
    git clone "https://${FRAMEWORK_REPO}.git" /opt/boring-ui; \
    if [ -n "$FRAMEWORK_COMMIT" ]; then git -C /opt/boring-ui checkout "$FRAMEWORK_COMMIT"; fi; \
    cd /opt/boring-ui; \
    npm install --no-audit --no-fund; \
    BUI_APP_TOML=/workspace/app/boring.app.toml npx vite build --outDir /workspace/app/dist/web

FROM golang:1.24-bookworm AS app-build

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/app
COPY . .
COPY --from=frontend-build /opt/boring-ui /opt/boring-ui

RUN set -eux; \
    go mod edit -replace github.com/boringdata/boring-ui=/opt/boring-ui; \
    go mod tidy; \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/app .

FROM debian:bookworm-slim

ENV BORING_UI_STATIC_DIR=/app/dist/web \
    BUI_APP_TOML=/app/boring.app.toml

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=app-build /out/app ./app
COPY --from=frontend-build /workspace/app/dist ./dist
COPY boring.app.toml ./boring.app.toml

EXPOSE 8000

CMD ["/app/app"]
`
}

func printInitNextSteps(name string, runtime string) {
	pyName := strings.ReplaceAll(name, "-", "_")
	fmt.Println()
	fmt.Printf("[bui] %s created!\n\n", name)
	fmt.Println("Files:")
	fmt.Println("  boring.app.toml                 # app config (routers, panels, deploy)")
	switch runtime {
	case "python":
		fmt.Println("  pyproject.toml                  # Python package")
		fmt.Printf("  src/%s/app.py              # app entry (custom routes mounted here)\n", pyName)
		fmt.Printf("  src/%s/routers/example.py  # example router → /api/x/example/*\n", pyName)
	case "go":
		fmt.Println("  go.mod                         # Go module")
		fmt.Println("  main.go                        # Go app entry")
		fmt.Println("  hello/module.go                # example module → /api/v1/hello/ping")
	default:
		fmt.Println("  package.json                   # TS runtime dependency (tsx)")
		fmt.Println("  src/server/index.ts            # TS app entry")
		fmt.Println("  src/server/routes/example.ts   # example route → /api/x/example/ping")
	}
	fmt.Println("  panels/                         # custom React panels")
	fmt.Println("  .dockerignore                  # keeps local build junk out of Fly builds")
	fmt.Println("  deploy/fly/Dockerfile           # Fly.io deploy config")
	fmt.Println("  deploy/fly/fly.toml")
	fmt.Println()
	fmt.Println("Workflow:")
	fmt.Printf("  cd %s\n", name)
	fmt.Println("  bui docs quickstart        # full walkthrough (read this first)")
	fmt.Println("  bui dev                    # start dev server")
	fmt.Println("  bui doctor                 # validate config")
	fmt.Println("  bui neon setup             # provision auth + database")
	fmt.Println("  bui deploy                 # build + deploy to Fly.io")
}

func writeFile(path, content string) {
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "warn: write %s: %v\n", path, err)
	}
}
