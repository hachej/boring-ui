package cmd

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/boringdata/boring-ui/bui/config"
	"github.com/boringdata/boring-ui/bui/framework"
	"github.com/spf13/cobra"
)

var doctorCmd = &cobra.Command{
	Use:   "doctor",
	Short: "Check that everything is wired correctly",
	Long:  `Validate Python, Node, config, framework, venv, symlinks, ports, and more.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		issues := 0
		pass := func(msg string) { fmt.Printf("  ✓ %s\n", msg) }
		fail := func(msg string) { fmt.Printf("  ✗ %s\n", msg); issues++ }
		warn := func(msg string) { fmt.Printf("  ! %s\n", msg) }

		fmt.Printf("\nbui doctor\n\n")

		// 1. Python
		if pyVer, err := cmdOutput("python3", "--version"); err == nil {
			pass(fmt.Sprintf("Python: %s", strings.TrimSpace(pyVer)))
		} else {
			fail("Python3 not found")
		}

		// 2. Node
		if nodeVer, err := cmdOutput("node", "--version"); err == nil {
			pass(fmt.Sprintf("Node: %s", strings.TrimSpace(nodeVer)))
		} else {
			fail("Node not found")
		}

		// 3. boring.app.toml
		cfg, root := config.MustLoad()
		pass(fmt.Sprintf("boring.app.toml: %s (%s)", cfg.App.Name, cfg.App.ID))

		// 4. Framework
		fwPath, err := framework.Resolve(cfg, "dev")
		if err != nil {
			fail(fmt.Sprintf("Framework: %v", err))
		} else {
			isLocal := !strings.Contains(fwPath, ".bui/cache")
			if isLocal {
				head := gitHeadShort(fwPath)
				pinned := cfg.Framework.Commit
				if len(pinned) > 7 {
					pinned = pinned[:7]
				}
				if head == pinned || pinned == "" {
					pass(fmt.Sprintf("Framework: %s (local, HEAD: %s)", fwPath, head))
				} else {
					warn(fmt.Sprintf("Framework: %s (local HEAD: %s, pinned: %s)", fwPath, head, pinned))
				}
			} else {
				pass(fmt.Sprintf("Framework: %s (cached)", fwPath))
			}
		}

		// 5. .venv
		venvPy := filepath.Join(root, ".venv", "bin", "python")
		if _, err := os.Stat(venvPy); err == nil {
			// Check if boring-ui is installed
			out, err := exec.Command(venvPy, "-c", "import boring_ui; print(boring_ui.__file__)").Output()
			if err == nil {
				pass(fmt.Sprintf(".venv: boring-ui installed (%s)", strings.TrimSpace(string(out))))
			} else {
				warn(".venv exists but boring-ui not installed (run bui dev)")
			}
		} else {
			warn(".venv not found (bui dev will create it)")
		}

		// 6. node_modules/boring-ui symlink
		nmLink := filepath.Join(root, "node_modules", "boring-ui")
		if target, err := os.Readlink(nmLink); err == nil {
			if _, err := os.Stat(target); err == nil {
				pass(fmt.Sprintf("node_modules/boring-ui → %s", target))
			} else {
				fail(fmt.Sprintf("node_modules/boring-ui → %s (broken symlink)", target))
			}
		} else {
			warn("node_modules/boring-ui not linked (bui dev will create it)")
		}

		// 7. .env
		envPath := filepath.Join(root, ".env")
		if _, err := os.Stat(envPath); err == nil {
			envVars := loadDotEnv(root)
			pass(fmt.Sprintf(".env: %d variables", len(envVars)))
		} else {
			warn(".env not found (optional, for local dev secrets)")
		}

		// 8. Routers (check importability if .venv exists)
		if len(cfg.Backend.Routers) > 0 {
			if _, err := os.Stat(venvPy); err == nil {
				allImport := true
				for _, r := range cfg.Backend.Routers {
					// "boring_macro.routers.api:router" → import "boring_macro.routers.api"
					modPath := strings.SplitN(r, ":", 2)[0]
					chk := exec.Command(venvPy, "-c", fmt.Sprintf("import %s", modPath))
					chk.Dir = root
					if err := chk.Run(); err != nil {
						fail(fmt.Sprintf("Router %q: import %s failed", r, modPath))
						allImport = false
					}
				}
				if allImport {
					pass(fmt.Sprintf("Routers: %d declared, all importable", len(cfg.Backend.Routers)))
				}
			} else {
				pass(fmt.Sprintf("Routers: %d declared (skipped import check — no .venv)", len(cfg.Backend.Routers)))
			}
		} else {
			pass("Routers: none (using boring-ui defaults)")
		}

		// 9. Panels
		if len(cfg.Frontend.Panels) > 0 {
			allExist := true
			for id, p := range cfg.Frontend.Panels {
				compPath := filepath.Join(root, p.Component)
				if _, err := os.Stat(compPath); err != nil {
					fail(fmt.Sprintf("Panel %q: %s not found", id, p.Component))
					allExist = false
				}
			}
			if allExist {
				pass(fmt.Sprintf("Panels: %d declared, all components found", len(cfg.Frontend.Panels)))
			}
		} else {
			pass("Panels: none (using boring-ui defaults)")
		}

		// 10. Child CLI
		if cfg.CLI.Name != "" {
			if _, err := exec.LookPath(cfg.CLI.Name); err != nil {
				warn(fmt.Sprintf("CLI binary %q: not in PATH", cfg.CLI.Name))
			} else {
				pass(fmt.Sprintf("CLI binary %q: found on PATH", cfg.CLI.Name))
			}
		}

		if len(cfg.CLI.Commands) > 0 {
			pass(fmt.Sprintf("Legacy commands: %d declared", len(cfg.CLI.Commands)))
			for name, c := range cfg.CLI.Commands {
				fields := strings.Fields(c.Run)
				if len(fields) == 0 {
					warn(fmt.Sprintf("  Legacy command %q: empty run string", name))
					continue
				}
				bin := fields[0]
				if _, err := exec.LookPath(bin); err != nil {
					warn(fmt.Sprintf("  Legacy command %q: %q not in PATH", name, bin))
				}
			}
		} else if cfg.CLI.Name == "" {
			warn("CLI: no [cli].name configured")
		}

		// 11. Ports
		checkPort(cfg.Backend.Port, "Backend", pass, warn)
		checkPort(cfg.Frontend.Port, "Frontend", pass, warn)

		fmt.Println()
		if issues > 0 {
			fmt.Printf("%d issue(s) found.\n\n", issues)
			return fmt.Errorf("%d issue(s)", issues)
		}
		fmt.Println("All checks passed.")
		fmt.Println()
		return nil
	},
}

func init() {
	rootCmd.AddCommand(doctorCmd)
}

func cmdOutput(name string, args ...string) (string, error) {
	out, err := exec.Command(name, args...).Output()
	return string(out), err
}

func gitHeadShort(dir string) string {
	cmd := exec.Command("git", "rev-parse", "--short", "HEAD")
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(out))
}

func checkPort(port int, label string, pass, warn func(string)) {
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		warn(fmt.Sprintf("%s port %d: in use", label, port))
	} else {
		ln.Close()
		pass(fmt.Sprintf("%s port %d: available", label, port))
	}
}
