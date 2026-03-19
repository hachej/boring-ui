package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/boringdata/boring-ui/bui/config"
	"github.com/spf13/cobra"
)

var runCmd = &cobra.Command{
	Use:   "run <args...>",
	Short: "Execute the child app CLI declared in [cli].name",
	Args:  cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, root := config.MustLoad()

		parts, err := resolveRunCommand(cfg, args)
		if err != nil {
			return err
		}
		return executeRun(parts, root)
	},
}

func resolveRunCommand(cfg *config.AppConfig, args []string) ([]string, error) {
	if name := strings.TrimSpace(cfg.CLI.Name); name != "" {
		return append([]string{name}, args...), nil
	}

	commandName := args[0]
	command, ok := cfg.CLI.Commands[commandName]
	if !ok {
		if len(cfg.CLI.Commands) == 0 {
			return nil, fmt.Errorf("no [cli].name configured and no legacy [cli.commands] declared")
		}
		fmt.Fprintf(os.Stderr, "Unknown legacy command: %s\n\nAvailable commands:\n", commandName)
		for name, candidate := range cfg.CLI.Commands {
			fmt.Fprintf(os.Stderr, "  %-15s %s\n", name, candidate.Description)
		}
		return nil, fmt.Errorf("command %q not found in legacy [cli.commands]", commandName)
	}

	parts := strings.Fields(command.Run)
	if len(parts) == 0 {
		return nil, fmt.Errorf("legacy [cli.commands.%s].run is empty", commandName)
	}
	if len(args) > 1 {
		parts = append(parts, args[1:]...)
	}
	return parts, nil
}

func executeRun(parts []string, root string) error {
	if len(parts) == 0 {
		return fmt.Errorf("no CLI command resolved")
	}

	c := exec.Command(parts[0], parts[1:]...)
	c.Dir = root
	c.Stdin = os.Stdin
	c.Stdout = os.Stdout
	c.Stderr = os.Stderr

	c.Env = os.Environ()
	for k, v := range loadDotEnv(root) {
		c.Env = append(c.Env, k+"="+v)
	}

	return c.Run()
}
