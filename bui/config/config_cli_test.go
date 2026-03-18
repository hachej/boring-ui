package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadParsesCLINameAndLegacyCommands(t *testing.T) {
	t.Helper()

	root := t.TempDir()
	configPath := filepath.Join(root, ConfigFile)
	if err := os.WriteFile(configPath, []byte(`
[app]
name = "Child App"
id = "child-app"
logo = "C"

[cli]
name = "bm"

[cli.commands.hello]
run = "python3 -m hello"
description = "Legacy helper"
`), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.CLI.Name != "bm" {
		t.Fatalf("expected CLI name bm, got %q", cfg.CLI.Name)
	}
	if got := cfg.CLI.Commands["hello"].Run; got != "python3 -m hello" {
		t.Fatalf("expected legacy command to be preserved, got %q", got)
	}
}

func TestLoadParsesDockerDeployConfig(t *testing.T) {
	t.Helper()

	root := t.TempDir()
	configPath := filepath.Join(root, ConfigFile)
	if err := os.WriteFile(configPath, []byte(`
[app]
name = "Boring UI"
id = "boring-ui"
logo = "B"

[deploy]
platform = "docker"
env = "prod"

[deploy.docker]
registry = "ghcr.io/hachej"
compose_file = "deploy/docker-compose.prod.yml"
host = "46.225.19.111.sslip.io"
ssh_key_vault = "secret/agent/hetzner-ssh"
remote_dir = "/opt/boring-ui"
`), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := Load(root)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.Deploy.Platform != "docker" {
		t.Fatalf("expected docker platform, got %q", cfg.Deploy.Platform)
	}
	if cfg.Deploy.Docker.Registry != "ghcr.io/hachej" {
		t.Fatalf("expected docker registry, got %q", cfg.Deploy.Docker.Registry)
	}
	if cfg.Deploy.Docker.ComposeFile != "deploy/docker-compose.prod.yml" {
		t.Fatalf("expected compose file, got %q", cfg.Deploy.Docker.ComposeFile)
	}
	if cfg.Deploy.Docker.Host != "46.225.19.111.sslip.io" {
		t.Fatalf("expected host, got %q", cfg.Deploy.Docker.Host)
	}
	if cfg.Deploy.Docker.SSHKeyVault != "secret/agent/hetzner-ssh" {
		t.Fatalf("expected ssh key vault, got %q", cfg.Deploy.Docker.SSHKeyVault)
	}
}
