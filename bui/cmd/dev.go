package cmd

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/boringdata/boring-ui/bui/config"
	"github.com/boringdata/boring-ui/bui/framework"
	"github.com/boringdata/boring-ui/bui/process"
	"github.com/spf13/cobra"
)

var (
	backendOnly  bool
	frontendOnly bool
	portBackend  int
	portFrontend int
	lookPath     = exec.LookPath
)

var devCmd = &cobra.Command{
	Use:   "dev",
	Short: "Start dev server (uvicorn + vite)",
	Long: `Start uvicorn + vite with hot-reload. Auto-detects ../boring-ui as framework.

Run 'bui docs dev' for detailed setup guide.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, root := config.MustLoad()
		fwPath, err := framework.Resolve(cfg, "dev")
		if err != nil {
			return fmt.Errorf("resolve framework: %w", err)
		}
		fmt.Printf("[bui] framework: %s\n", fwPath)

		// Determine if self-hosting (framework == project)
		absFw, _ := filepath.Abs(fwPath)
		absRoot, _ := filepath.Abs(root)
		selfHosting := absFw == absRoot

		var venvPy string
		if backendType(cfg) == "python" {
			venvPy, err = ensureVenv(root)
			if err != nil {
				return fmt.Errorf("venv: %w", err)
			}
			if err := installPythonBackend(root, fwPath, selfHosting, venvPy); err != nil {
				return err
			}
		}

		// Symlink frontend (into frontend root if set, else project root)
		frontendRoot := root
		if cfg.Frontend.Root != "" {
			frontendRoot = filepath.Join(root, cfg.Frontend.Root)
		}
		if err := framework.LinkFrontend(fwPath, frontendRoot); err != nil {
			fmt.Printf("[bui] warn: frontend symlink: %v\n", err)
		}

		// Load .env if present
		envVars := loadDotEnv(root)

		// Build process env
		procEnv := os.Environ()
		for k, v := range envVars {
			procEnv = append(procEnv, k+"="+v)
		}

		backendPort := cfg.Backend.Port
		frontendPort := cfg.Frontend.Port
		if portBackend != 0 {
			backendPort = portBackend
		}
		if portFrontend != 0 {
			frontendPort = portFrontend
		}

		sup := &process.Supervisor{}

		if !frontendOnly {
			backendCmd, err := buildBackendCommand(root, cfg, procEnv, backendPort, venvPy)
			if err != nil {
				return err
			}
			sup.Add("backend", backendCmd)
		}

		if !backendOnly {
			vite := exec.Command("npx", "vite",
				"--port", fmt.Sprintf("%d", frontendPort),
				"--host", "0.0.0.0",
			)
			// Run vite from frontend root if set, otherwise framework path
			if cfg.Frontend.Root != "" {
				vite.Dir = frontendRoot
			} else {
				vite.Dir = fwPath
			}
			vite.Env = append(procEnv,
				fmt.Sprintf("VITE_API_URL=http://localhost:%d", backendPort),
				fmt.Sprintf("BUI_APP_TOML=%s", filepath.Join(root, config.ConfigFile)),
			)
			sup.Add("frontend", vite)
		}

		fmt.Printf("[bui] %s → backend :%d, frontend :%d\n", cfg.App.Name, backendPort, frontendPort)
		return sup.Run(context.Background())
	},
}

func init() {
	devCmd.Flags().BoolVar(&backendOnly, "backend-only", false, "Only start backend (uvicorn)")
	devCmd.Flags().BoolVar(&frontendOnly, "frontend-only", false, "Only start frontend (vite)")
	devCmd.Flags().IntVar(&portBackend, "port", 0, "Override backend port")
	devCmd.Flags().IntVar(&portFrontend, "vite-port", 0, "Override frontend port")
}

func backendType(cfg *config.AppConfig) string {
	backendType := strings.TrimSpace(strings.ToLower(cfg.Backend.Type))
	if backendType == "" {
		return "python"
	}
	return backendType
}

func installPythonBackend(root, fwPath string, selfHosting bool, venvPy string) error {
	fmt.Println("[bui] installing boring-ui (editable)...")
	install := exec.Command(venvPy, "-m", "pip", "install", "-e", fwPath, "--quiet", "--break-system-packages")
	install.Stdout = os.Stdout
	install.Stderr = os.Stderr
	if err := install.Run(); err != nil {
		return fmt.Errorf("pip install boring-ui: %w", err)
	}

	if selfHosting {
		return nil
	}
	if _, err := os.Stat(filepath.Join(root, "pyproject.toml")); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}

	fmt.Println("[bui] installing child app (editable)...")
	installApp := exec.Command(venvPy, "-m", "pip", "install", "-e", root, "--quiet", "--break-system-packages")
	installApp.Stdout = os.Stdout
	installApp.Stderr = os.Stderr
	if err := installApp.Run(); err != nil {
		return fmt.Errorf("pip install child app: %w", err)
	}
	return nil
}

func buildBackendCommand(root string, cfg *config.AppConfig, procEnv []string, backendPort int, venvPy string) (*exec.Cmd, error) {
	configPath := filepath.Join(root, config.ConfigFile)
	switch backendType(cfg) {
	case "python":
		entry := cfg.Backend.Entry
		if entry == "" {
			entry = "boring_ui.app_config_loader:app"
		}
		uvicorn := exec.Command(venvPy, "-m", "uvicorn",
			entry,
			"--reload",
			"--host", "0.0.0.0",
			"--port", fmt.Sprintf("%d", backendPort),
		)
		uvicorn.Dir = root
		uvicornEnv := append(procEnv, fmt.Sprintf("BUI_APP_TOML=%s", configPath))
		// Add extra PYTHONPATH entries
		if len(cfg.Backend.PythonPath) > 0 {
			var absPaths []string
			for _, p := range cfg.Backend.PythonPath {
				if filepath.IsAbs(p) {
					absPaths = append(absPaths, p)
				} else {
					absPaths = append(absPaths, filepath.Join(root, p))
				}
			}
			existing := os.Getenv("PYTHONPATH")
			extra := strings.Join(absPaths, ":")
			if existing != "" {
				extra = extra + ":" + existing
			}
			uvicornEnv = append(uvicornEnv, "PYTHONPATH="+extra)
		}
		uvicorn.Env = uvicornEnv
		return uvicorn, nil
	case "go":
		if _, err := lookPath("air"); err != nil {
			return nil, fmt.Errorf("backend.type=go requires `air` in PATH: %w", err)
		}
		airConfigPath, err := writeAirConfig(root)
		if err != nil {
			return nil, err
		}
		air := exec.Command("air", "-c", airConfigPath)
		air.Dir = root
		air.Env = append(procEnv,
			fmt.Sprintf("BUI_APP_TOML=%s", configPath),
			fmt.Sprintf("BORING_PORT=%d", backendPort),
		)
		return air, nil
	default:
		return nil, fmt.Errorf("unsupported backend.type %q", cfg.Backend.Type)
	}
}

func writeAirConfig(root string) (string, error) {
	airDir := filepath.Join(root, ".air")
	if err := os.MkdirAll(airDir, 0o755); err != nil {
		return "", fmt.Errorf("create .air dir: %w", err)
	}

	airConfigPath := filepath.Join(root, ".air.toml")
	contents := strings.Join([]string{
		"root = \".\"",
		"tmp_dir = \".air\"",
		"",
		"[build]",
		"cmd = \"go build -o .air/server ./cmd/server\"",
		"entrypoint = \".air/server\"",
		"include_ext = [\"go\", \"toml\"]",
		"exclude_dir = [\".git\", \".air\", \".venv\", \"node_modules\", \"dist\"]",
		"delay = 1000",
		"",
		"[log]",
		"time = true",
		"",
	}, "\n")

	if err := os.WriteFile(airConfigPath, []byte(contents), 0o644); err != nil {
		return "", fmt.Errorf("write .air.toml: %w", err)
	}
	return airConfigPath, nil
}

func ensureVenv(projectRoot string) (string, error) {
	venvPath := filepath.Join(projectRoot, ".venv")
	pyBin := filepath.Join(venvPath, "bin", "python")
	pipCheck := exec.Command(pyBin, "-m", "pip", "--version")

	// If venv exists and pip works, use it
	if _, err := os.Stat(pyBin); err == nil {
		if pipCheck.Run() == nil {
			return pyBin, nil
		}
		// venv exists but pip is broken — recreate
		fmt.Println("[bui] .venv broken (no pip), recreating...")
		os.RemoveAll(venvPath)
	}

	fmt.Println("[bui] creating .venv...")
	cmd := exec.Command("python3", "-m", "venv", venvPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return "", err
	}

	// Verify pip works
	verify := exec.Command(pyBin, "-m", "pip", "--version")
	if err := verify.Run(); err != nil {
		return "", fmt.Errorf(".venv created but pip not available: %w", err)
	}

	return pyBin, nil
}

func loadDotEnv(root string) map[string]string {
	env := make(map[string]string)
	data, err := os.ReadFile(filepath.Join(root, ".env"))
	if err != nil {
		return env
	}
	for _, line := range splitLines(string(data)) {
		if len(line) == 0 || line[0] == '#' {
			continue
		}
		for i := 0; i < len(line); i++ {
			if line[i] == '=' {
				key := line[:i]
				val := line[i+1:]
				// Strip surrounding quotes
				if len(val) >= 2 && ((val[0] == '"' && val[len(val)-1] == '"') || (val[0] == '\'' && val[len(val)-1] == '\'')) {
					val = val[1 : len(val)-1]
				}
				env[key] = val
				break
			}
		}
	}
	return env
}

func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			line := s[start:i]
			if len(line) > 0 && line[len(line)-1] == '\r' {
				line = line[:len(line)-1]
			}
			lines = append(lines, line)
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}
