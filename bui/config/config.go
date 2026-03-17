// Package config parses boring.app.toml — the single config file
// that defines a boring-ui child app.
package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
)

const ConfigFile = "boring.app.toml"

type AppConfig struct {
	App       App       `toml:"app"`
	Framework Framework `toml:"framework"`
	Backend   Backend   `toml:"backend"`
	Frontend  Frontend  `toml:"frontend"`
	CLI       CLI       `toml:"cli"`
	Auth      Auth      `toml:"auth"`
	Deploy    Deploy    `toml:"deploy"`
}

type Framework struct {
	Repo   string `toml:"repo"`
	Commit string `toml:"commit"`
}

type App struct {
	Name string `toml:"name"`
	Logo string `toml:"logo"`
	ID   string `toml:"id"`
}

type Backend struct {
	Type         string   `toml:"type"`
	Entry        string   `toml:"entry"`
	Port         int      `toml:"port"`
	Routers      []string `toml:"routers"`
	PythonPath   []string `toml:"pythonpath"`
	Dependencies []string `toml:"dependencies"`
}

type Frontend struct {
	Root     string           `toml:"root"`
	Port     int              `toml:"port"`
	Branding Branding         `toml:"branding"`
	Features map[string]any   `toml:"features"`
	Data     map[string]any   `toml:"data"`
	Panels   map[string]Panel `toml:"panels"`
}

type Branding struct {
	Name        string `toml:"name"`
	TitleFormat string `toml:"titleFormat"`
}

type Panel struct {
	Component string `toml:"component"`
	Title     string `toml:"title"`
	Placement string `toml:"placement"`
}

type CLI struct {
	Commands map[string]Command `toml:"commands"`
}

type Command struct {
	Run         string `toml:"run"`
	Description string `toml:"description"`
}

type Auth struct {
	Provider      string `toml:"provider"`
	SessionCookie string `toml:"session_cookie"`
	SessionTTL    int    `toml:"session_ttl"`
}

type Deploy struct {
	Platform   string               `toml:"platform"`
	Env        string               `toml:"env"`
	Secrets    map[string]SecretRef `toml:"secrets"`
	DeployEnv  map[string]string    `toml:"env_vars"`
	BootModule string               `toml:"boot_module"`
	Neon       NeonConfig           `toml:"neon"`
	Modal      ModalConfig          `toml:"modal"`
}

type SecretRef struct {
	Vault string `toml:"vault"`
	Field string `toml:"field"`
}

type NeonConfig struct {
	Project  string `toml:"project"`
	Database string `toml:"database"`
	AuthURL  string `toml:"auth_url"`
	JWKSURL  string `toml:"jwks_url"`
}

type ModalConfig struct {
	AppName       string `toml:"app_name"`
	MinContainers int    `toml:"min_containers"`
	GPU           bool   `toml:"gpu"`
}

// Load reads boring.app.toml from the given directory (or current dir).
func Load(dir string) (*AppConfig, error) {
	path := filepath.Join(dir, ConfigFile)

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("cannot read %s: %w", path, err)
	}

	var cfg AppConfig
	if err := toml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}

	// Defaults
	if cfg.Backend.Type == "" {
		cfg.Backend.Type = "go"
	}
	if cfg.Backend.Port == 0 {
		cfg.Backend.Port = 8000
	}
	if cfg.Frontend.Port == 0 {
		cfg.Frontend.Port = 5173
	}
	if cfg.Auth.SessionCookie == "" {
		cfg.Auth.SessionCookie = "boring_session"
	}
	if cfg.Auth.SessionTTL == 0 {
		cfg.Auth.SessionTTL = 86400
	}
	if cfg.Deploy.Env == "" {
		cfg.Deploy.Env = "prod"
	}

	return &cfg, nil
}

// AppVaultPath returns the Vault KV path for per-app, per-env secrets.
// Pattern: secret/agent/app/{app-id}/{env}
func (c *AppConfig) AppVaultPath() string {
	return fmt.Sprintf("secret/agent/app/%s/%s", c.App.ID, c.Deploy.Env)
}

// FindProjectRoot walks up from cwd looking for boring.app.toml.
func FindProjectRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}

	for {
		if _, err := os.Stat(filepath.Join(dir, ConfigFile)); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("%s not found in any parent directory", ConfigFile)
		}
		dir = parent
	}
}

// MustLoad finds and loads the config or exits.
func MustLoad() (*AppConfig, string) {
	root, err := FindProjectRoot()
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	cfg, err := Load(root)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	return cfg, root
}
