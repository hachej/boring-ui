package cmd

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunCmdDelegatesToConfiguredCLIBinary(t *testing.T) {
	root := t.TempDir()
	binDir := filepath.Join(root, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("mkdir bin: %v", err)
	}

	argsFile := filepath.Join(root, "args.txt")
	cwdFile := filepath.Join(root, "cwd.txt")
	if err := os.WriteFile(filepath.Join(root, "boring.app.toml"), []byte(`
[app]
name = "Child App"
id = "child-app"
logo = "C"

[cli]
name = "fakecli"
`), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"" + argsFile + "\"\npwd > \"" + cwdFile + "\"\n"
	if err := os.WriteFile(filepath.Join(binDir, "fakecli"), []byte(script), 0o755); err != nil {
		t.Fatalf("write fake CLI: %v", err)
	}

	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	previousWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	defer func() {
		_ = os.Chdir(previousWD)
	}()
	if err := os.Chdir(root); err != nil {
		t.Fatalf("chdir: %v", err)
	}

	if err := runCmd.RunE(runCmd, []string{"help", "--json"}); err != nil {
		t.Fatalf("run command: %v", err)
	}

	argsData, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	cwdData, err := os.ReadFile(cwdFile)
	if err != nil {
		t.Fatalf("read cwd: %v", err)
	}

	gotArgs := strings.Fields(string(argsData))
	if strings.Join(gotArgs, " ") != "help --json" {
		t.Fatalf("expected delegated args 'help --json', got %q", strings.Join(gotArgs, " "))
	}
	if strings.TrimSpace(string(cwdData)) != root {
		t.Fatalf("expected CLI to run in %q, got %q", root, strings.TrimSpace(string(cwdData)))
	}
}

func TestRunCmdFallsBackToLegacyCommands(t *testing.T) {
	root := t.TempDir()
	binDir := filepath.Join(root, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("mkdir bin: %v", err)
	}

	argsFile := filepath.Join(root, "legacy-args.txt")
	if err := os.WriteFile(filepath.Join(root, "boring.app.toml"), []byte(`
[app]
name = "Child App"
id = "child-app"
logo = "C"

[cli.commands.echo]
run = "legacycli --from-config"
description = "Legacy helper"
`), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"" + argsFile + "\"\n"
	if err := os.WriteFile(filepath.Join(binDir, "legacycli"), []byte(script), 0o755); err != nil {
		t.Fatalf("write legacy CLI: %v", err)
	}

	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	previousWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	defer func() {
		_ = os.Chdir(previousWD)
	}()
	if err := os.Chdir(root); err != nil {
		t.Fatalf("chdir: %v", err)
	}

	if err := runCmd.RunE(runCmd, []string{"echo", "payload"}); err != nil {
		t.Fatalf("run legacy command: %v", err)
	}

	argsData, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}

	gotArgs := strings.Fields(string(argsData))
	if strings.Join(gotArgs, " ") != "--from-config payload" {
		t.Fatalf("expected legacy args '--from-config payload', got %q", strings.Join(gotArgs, " "))
	}
}
