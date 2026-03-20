package cmd

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/boringdata/boring-ui/bui/config"
	"github.com/boringdata/boring-ui/bui/framework"
	"github.com/spf13/cobra"
)

var infoJSON bool

var infoCmd = &cobra.Command{
	Use:   "info",
	Short: "Print app config (agent-readable)",
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, _ := config.MustLoad()

		if infoJSON {
			enc := json.NewEncoder(os.Stdout)
			enc.SetIndent("", "  ")
			return enc.Encode(cfg)
		}

		fmt.Printf("App:        %s (%s)\n", cfg.App.Name, cfg.App.ID)
		fmt.Printf("Logo:       %s\n", cfg.App.Logo)
		fmt.Printf("Framework:  %s @ %s\n", cfg.Framework.Repo, cfg.Framework.Commit)
		fmt.Printf("Backend:    port %d\n", cfg.Backend.Port)
		fmt.Printf("Frontend:   port %d\n", cfg.Frontend.Port)
		fmt.Printf("Auth:       %s\n", cfg.Auth.Provider)
		if cfg.CLI.Name != "" {
			fmt.Printf("CLI:        %s\n", cfg.CLI.Name)
		}

		if len(cfg.Backend.Routers) > 0 {
			fmt.Println("\nRouters:")
			for _, r := range cfg.Backend.Routers {
				fmt.Printf("  - %s\n", r)
			}
		}

		if len(cfg.Frontend.Panels) > 0 {
			fmt.Println("\nPanels:")
			for id, p := range cfg.Frontend.Panels {
				fmt.Printf("  - %-20s %s (%s)\n", id, p.Title, p.Placement)
			}
		}

		if len(cfg.CLI.Commands) > 0 {
			fmt.Println("\nLegacy Commands:")
			for name, c := range cfg.CLI.Commands {
				fmt.Printf("  - %-15s %s\n", name, c.Description)
			}
		}

		// Show framework resolution
		fwPath, err := framework.Resolve(cfg, "dev")
		if err == nil {
			fmt.Printf("\nResolved framework: %s\n", fwPath)
		}

		return nil
	},
}

func init() {
	infoCmd.Flags().BoolVar(&infoJSON, "json", false, "Output as JSON")
}
