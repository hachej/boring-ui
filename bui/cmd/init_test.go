package cmd

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestRunInitGoScaffoldsBuildableChildApp(t *testing.T) {
	origGo := initGo
	origPython := initPython
	t.Cleanup(func() { initGo = origGo })
	t.Cleanup(func() { initPython = origPython })
	initGo = true
	initPython = false

	cwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	goldenRoot := cwd
	frameworkRoot := filepath.Clean(filepath.Join(cwd, "..", ".."))

	root := t.TempDir()
	if err := os.Symlink(frameworkRoot, filepath.Join(root, "boring-ui")); err != nil {
		t.Fatalf("symlink boring-ui: %v", err)
	}

	previous, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd before chdir: %v", err)
	}
	if err := os.Chdir(root); err != nil {
		t.Fatalf("chdir root: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(previous)
	})

	if err := runInit(initCmd, []string{"myapp"}); err != nil {
		t.Fatalf("runInit returned error: %v", err)
	}

	mainGo, err := os.ReadFile(filepath.Join(root, "myapp", "main.go"))
	if err != nil {
		t.Fatalf("read main.go: %v", err)
	}
	assertGoldenFile(t, goldenRoot, filepath.Join(root, "myapp", "main.go"), string(mainGo))

	goMod, err := os.ReadFile(filepath.Join(root, "myapp", "go.mod"))
	if err != nil {
		t.Fatalf("read go.mod: %v", err)
	}
	assertGoldenFile(t, goldenRoot, filepath.Join(root, "myapp", "go.mod"), normalizeGoModForGolden(string(goMod)))

	appToml, err := os.ReadFile(filepath.Join(root, "myapp", "boring.app.toml"))
	if err != nil {
		t.Fatalf("read boring.app.toml: %v", err)
	}
	assertGoldenFile(t, goldenRoot, filepath.Join(root, "myapp", "boring.app.toml"), normalizeGoldenText(string(appToml)))

	flyToml, err := os.ReadFile(filepath.Join(root, "myapp", "deploy", "fly", "fly.toml"))
	if err != nil {
		t.Fatalf("read deploy/fly/fly.toml: %v", err)
	}
	assertGoldenFile(t, goldenRoot, filepath.Join(root, "myapp", "deploy", "fly", "fly.toml"), string(flyToml))

	dockerfile, err := os.ReadFile(filepath.Join(root, "myapp", "deploy", "fly", "Dockerfile"))
	if err != nil {
		t.Fatalf("read deploy/fly/Dockerfile: %v", err)
	}
	assertGoldenFile(t, goldenRoot, filepath.Join(root, "myapp", "deploy", "fly", "Dockerfile"), string(dockerfile))

	assertDockerignore(t, filepath.Join(root, "myapp", ".dockerignore"))

	helloModule, err := os.ReadFile(filepath.Join(root, "myapp", "hello", "module.go"))
	if err != nil {
		t.Fatalf("read hello/module.go: %v", err)
	}
	assertGoldenFile(t, goldenRoot, filepath.Join(root, "myapp", "hello", "module.go"), string(helloModule))

	if _, err := os.Stat(filepath.Join(root, "myapp", "go.sum")); err != nil {
		t.Fatalf("expected go.sum to be generated: %v", err)
	}

	build := exec.Command("go", "build", "-buildvcs=false", "./...")
	build.Dir = filepath.Join(root, "myapp")
	output, err := build.CombinedOutput()
	if err != nil {
		t.Fatalf("go build ./... failed: %v\n%s", err, string(output))
	}
}

func TestRunInitTypeScriptScaffoldsAppEntrypoint(t *testing.T) {
	origGo := initGo
	origPython := initPython
	t.Cleanup(func() { initGo = origGo })
	t.Cleanup(func() { initPython = origPython })
	initGo = false
	initPython = false

	root := t.TempDir()
	previous, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd before chdir: %v", err)
	}
	if err := os.Chdir(root); err != nil {
		t.Fatalf("chdir root: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(previous)
	})

	if err := runInit(initCmd, []string{"tsapp"}); err != nil {
		t.Fatalf("runInit returned error: %v", err)
	}

	serverEntry, err := os.ReadFile(filepath.Join(root, "tsapp", "src", "server", "index.ts"))
	if err != nil {
		t.Fatalf("read src/server/index.ts: %v", err)
	}
	if !strings.Contains(string(serverEntry), "BUI_FRAMEWORK_ROOT") {
		t.Fatalf("expected TS entry to resolve BUI_FRAMEWORK_ROOT, got %s", string(serverEntry))
	}
	if !strings.Contains(string(serverEntry), "registerExampleRoutes(app)") {
		t.Fatalf("expected TS entry to mount example routes, got %s", string(serverEntry))
	}

	appToml, err := os.ReadFile(filepath.Join(root, "tsapp", "boring.app.toml"))
	if err != nil {
		t.Fatalf("read boring.app.toml: %v", err)
	}
	if !strings.Contains(string(appToml), `type    = "typescript"`) {
		t.Fatalf("expected backend.type to be typescript, got %s", string(appToml))
	}
	if !strings.Contains(string(appToml), `entry   = "src/server/index.ts"`) {
		t.Fatalf("expected backend entry to match generated TS entrypoint, got %s", string(appToml))
	}
	if !strings.Contains(string(appToml), `platform = "fly"`) {
		t.Fatalf("expected boring.app.toml to default to Fly deploys, got %s", string(appToml))
	}
	if !strings.Contains(string(appToml), `[deploy.fly]`) {
		t.Fatalf("expected boring.app.toml to include deploy.fly config, got %s", string(appToml))
	}

	flyToml, err := os.ReadFile(filepath.Join(root, "tsapp", "deploy", "fly", "fly.toml"))
	if err != nil {
		t.Fatalf("read deploy/fly/fly.toml: %v", err)
	}
	if !strings.Contains(string(flyToml), `app = "tsapp"`) {
		t.Fatalf("expected fly.toml app to match scaffolded app id, got %s", string(flyToml))
	}
	if !strings.Contains(string(flyToml), `dockerfile = "Dockerfile"`) {
		t.Fatalf("expected fly.toml to point at the generated Dockerfile, got %s", string(flyToml))
	}
	if !strings.Contains(string(flyToml), `WORKSPACE_BACKEND = "bwrap"`) {
		t.Fatalf("expected fly.toml to pin the hosted workspace backend, got %s", string(flyToml))
	}

	dockerfile, err := os.ReadFile(filepath.Join(root, "tsapp", "deploy", "fly", "Dockerfile"))
	if err != nil {
		t.Fatalf("read deploy/fly/Dockerfile: %v", err)
	}
	if !strings.Contains(string(dockerfile), `BUI_APP_TOML=/workspace/app/boring.app.toml`) {
		t.Fatalf("expected Dockerfile to build with the generated boring.app.toml, got %s", string(dockerfile))
	}
	if !strings.Contains(string(dockerfile), `BUI_FRAMEWORK_ROOT=/opt/boring-ui`) {
		t.Fatalf("expected Dockerfile to pin the framework root for TS entrypoints, got %s", string(dockerfile))
	}
	if !strings.Contains(string(dockerfile), `cd /app && npm install --no-audit --no-fund`) {
		t.Fatalf("expected Dockerfile to install child app runtime dependencies in /app, got %s", string(dockerfile))
	}
	if !strings.Contains(string(dockerfile), `CMD ["node", "--import", "tsx", "src/server/index.ts"]`) {
		t.Fatalf("expected Dockerfile to run the scaffolded TS entrypoint via tsx, got %s", string(dockerfile))
	}

	packageJSON, err := os.ReadFile(filepath.Join(root, "tsapp", "package.json"))
	if err != nil {
		t.Fatalf("read package.json: %v", err)
	}
	if !strings.Contains(string(packageJSON), `"tsx": "^4.19.4"`) {
		t.Fatalf("expected package.json to include tsx, got %s", string(packageJSON))
	}

	assertDockerignore(t, filepath.Join(root, "tsapp", ".dockerignore"))
}

func TestRunInitPythonScaffoldsAppEntrypoint(t *testing.T) {
	origGo := initGo
	origPython := initPython
	t.Cleanup(func() { initGo = origGo })
	t.Cleanup(func() { initPython = origPython })
	initGo = false
	initPython = true

	root := t.TempDir()
	previous, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd before chdir: %v", err)
	}
	if err := os.Chdir(root); err != nil {
		t.Fatalf("chdir root: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(previous)
	})

	if err := runInit(initCmd, []string{"pyapp"}); err != nil {
		t.Fatalf("runInit returned error: %v", err)
	}

	appPy, err := os.ReadFile(filepath.Join(root, "pyapp", "src", "pyapp", "app.py"))
	if err != nil {
		t.Fatalf("read app.py: %v", err)
	}
	if !strings.Contains(string(appPy), "from boring_ui.app_config_loader import create_app_from_toml") {
		t.Fatalf("expected app.py to use create_app_from_toml, got %s", string(appPy))
	}
	if !strings.Contains(string(appPy), "app.include_router(example_router)") {
		t.Fatalf("expected app.py to mount example router, got %s", string(appPy))
	}

	appToml, err := os.ReadFile(filepath.Join(root, "pyapp", "boring.app.toml"))
	if err != nil {
		t.Fatalf("read boring.app.toml: %v", err)
	}
	if !strings.Contains(string(appToml), `entry   = "pyapp.app:create_app"`) {
		t.Fatalf("expected backend entry to match generated app.py, got %s", string(appToml))
	}

	assertDockerignore(t, filepath.Join(root, "pyapp", ".dockerignore"))
}

func TestRunInitRejectsMultipleRuntimeFlags(t *testing.T) {
	origGo := initGo
	origPython := initPython
	t.Cleanup(func() { initGo = origGo })
	t.Cleanup(func() { initPython = origPython })
	initGo = true
	initPython = true

	root := t.TempDir()
	previous, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd before chdir: %v", err)
	}
	if err := os.Chdir(root); err != nil {
		t.Fatalf("chdir root: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(previous)
	})

	if err := runInit(initCmd, []string{"invalid"}); err == nil {
		t.Fatal("expected conflicting runtime flags to fail")
	}
}

func TestRunInitGoWithoutSiblingSkipsModulePinning(t *testing.T) {
	origGo := initGo
	origPython := initPython
	t.Cleanup(func() { initGo = origGo })
	t.Cleanup(func() { initPython = origPython })
	initGo = true
	initPython = false

	root := t.TempDir()
	previous, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd before chdir: %v", err)
	}
	if err := os.Chdir(root); err != nil {
		t.Fatalf("chdir root: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(previous)
	})

	if err := runInit(initCmd, []string{"soloapp"}); err != nil {
		t.Fatalf("runInit returned error: %v", err)
	}

	goMod, err := os.ReadFile(filepath.Join(root, "soloapp", "go.mod"))
	if err != nil {
		t.Fatalf("read go.mod: %v", err)
	}
	if strings.Contains(string(goMod), "github.com/boringdata/boring-ui v0.0.0") {
		t.Fatalf("expected no placeholder boring-ui requirement without sibling repo, got %s", string(goMod))
	}
	if strings.Contains(string(goMod), "replace github.com/boringdata/boring-ui =>") {
		t.Fatalf("expected no local replace without sibling repo, got %s", string(goMod))
	}
	if _, err := os.Stat(filepath.Join(root, "soloapp", "go.sum")); !os.IsNotExist(err) {
		t.Fatalf("expected go.sum to be absent when go mod tidy is skipped, got err=%v", err)
	}
}

func assertGoldenFile(t *testing.T, goldenRoot string, path string, actual string) {
	t.Helper()

	parts := []string{goldenRoot, "testdata", "init-go"}
	switch filepath.Base(path) {
	case "main.go":
		parts = append(parts, "main.go.golden")
	case "go.mod":
		parts = append(parts, "go.mod.golden")
	case "boring.app.toml":
		parts = append(parts, "boring.app.toml.golden")
	case "fly.toml":
		parts = append(parts, "deploy_fly_fly.toml.golden")
	case "Dockerfile":
		parts = append(parts, "deploy_fly_Dockerfile.golden")
	case "module.go":
		parts = append(parts, "hello_module.go.golden")
	default:
		t.Fatalf("no golden mapping for %s", path)
	}

	expected, err := os.ReadFile(filepath.Join(parts...))
	if err != nil {
		t.Fatalf("read golden file: %v", err)
	}

	expectedText := strings.TrimSpace(string(expected))
	actualText := strings.TrimSpace(actual)
	if expectedText != actualText {
		t.Fatalf("golden mismatch for %s\nexpected:\n%s\nactual:\n%s", path, expectedText, actualText)
	}
}

func normalizeGoldenText(input string) string {
	commitLine := regexp.MustCompile(`(?m)^commit = ".*"$`)
	return commitLine.ReplaceAllString(strings.TrimSpace(input), `commit = "<commit>"`)
}

func normalizeGoModForGolden(input string) string {
	lines := strings.Split(strings.TrimSpace(input), "\n")
	normalized := make([]string, 0, 4)
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(trimmed, "module "):
			normalized = append(normalized, trimmed)
		case strings.HasPrefix(trimmed, "go "):
			normalized = append(normalized, "go 1.24")
		case trimmed == "require github.com/boringdata/boring-ui v0.0.0":
			normalized = append(normalized, trimmed)
		case trimmed == "replace github.com/boringdata/boring-ui => ../boring-ui":
			normalized = append(normalized, trimmed)
		}
	}
	return strings.Join(normalized, "\n\n")
}

func assertDockerignore(t *testing.T, path string) {
	t.Helper()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read .dockerignore: %v", err)
	}

	expected := strings.TrimSpace(`.git
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
.env`)
	if strings.TrimSpace(string(data)) != expected {
		t.Fatalf(".dockerignore mismatch for %s\nexpected:\n%s\nactual:\n%s", path, expected, strings.TrimSpace(string(data)))
	}
}
