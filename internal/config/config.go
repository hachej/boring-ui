package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/BurntSushi/toml"
)

const ConfigFile = "boring.app.toml"

// Config mirrors the boring.app.toml contract used by bui and the Python backend.
type Config struct {
	ConfigPath   string              `toml:"-"`
	CORSOrigins  []string            `toml:"-"`
	PTYProviders map[string][]string `toml:"-"`
	App          App                 `toml:"app"`
	Framework    Framework           `toml:"framework"`
	Backend      Backend             `toml:"backend"`
	Frontend     Frontend            `toml:"frontend"`
	CLI          CLI                 `toml:"cli"`
	Auth         Auth                `toml:"auth"`
	Deploy       Deploy              `toml:"deploy"`
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
	Type    string   `toml:"type"`
	Entry   string   `toml:"entry"`
	Host    string   `toml:"host"`
	Port    int      `toml:"port"`
	Routers []string `toml:"routers"`
}

type Frontend struct {
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
	Platform string               `toml:"platform"`
	Env      string               `toml:"env"`
	Secrets  map[string]SecretRef `toml:"secrets"`
	Neon     NeonConfig           `toml:"neon"`
	Modal    ModalConfig          `toml:"modal"`
}

type SecretRef struct {
	Vault string `toml:"vault"`
	Field string `toml:"field"`
}

type NeonConfig struct {
	Project     string `toml:"project"`
	Database    string `toml:"database"`
	AuthURL     string `toml:"auth_url"`
	JWKSURL     string `toml:"jwks_url"`
	DatabaseURL string `toml:"database_url"`
}

type ModalConfig struct {
	AppName       string `toml:"app_name"`
	MinContainers int    `toml:"min_containers"`
	GPU           bool   `toml:"gpu"`
}

// Load reads boring.app.toml from the provided path or project root and applies env overrides.
func Load(path string) (Config, error) {
	configPath, err := resolveConfigPath(path)
	if err != nil {
		return Config{}, err
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		return Config{}, fmt.Errorf("read %s: %w", configPath, err)
	}

	var cfg Config
	if err := toml.Unmarshal(data, &cfg); err != nil {
		return Config{}, fmt.Errorf("parse %s: %w", configPath, err)
	}

	cfg.ConfigPath = configPath
	cfg.applyDefaults()
	if err := cfg.applyEnvOverrides(); err != nil {
		return Config{}, err
	}

	return cfg, nil
}

func (c Config) ListenAddress() string {
	return fmt.Sprintf("%s:%d", c.Backend.Host, c.Backend.Port)
}

func (c *Config) applyDefaults() {
	if len(c.CORSOrigins) == 0 {
		c.CORSOrigins = defaultCORSOrigins()
	}
	if len(c.PTYProviders) == 0 {
		c.PTYProviders = DefaultPTYProviders()
	} else {
		c.PTYProviders = ClonePTYProviders(c.PTYProviders)
	}
	if c.Backend.Type == "" {
		c.Backend.Type = "go"
	}
	if c.Backend.Host == "" {
		c.Backend.Host = "0.0.0.0"
	}
	if c.Backend.Port == 0 {
		c.Backend.Port = 8000
	}
	if c.Frontend.Port == 0 {
		c.Frontend.Port = 5173
	}
	if c.Auth.SessionCookie == "" {
		c.Auth.SessionCookie = "boring_session"
	}
	if c.Auth.SessionTTL == 0 {
		c.Auth.SessionTTL = 7 * 24 * 60 * 60
	}
	if c.Deploy.Env == "" {
		c.Deploy.Env = "prod"
	}
}

func (c *Config) applyEnvOverrides() error {
	if port := os.Getenv("BORING_PORT"); port != "" {
		value, err := strconv.Atoi(port)
		if err != nil {
			return fmt.Errorf("parse BORING_PORT: %w", err)
		}
		c.Backend.Port = value
	}
	if host := os.Getenv("BORING_HOST"); host != "" {
		c.Backend.Host = host
	}
	if raw := strings.TrimSpace(os.Getenv("BORING_UI_PTY_CLAUDE_COMMAND")); raw != "" {
		if len(c.PTYProviders) == 0 {
			c.PTYProviders = DefaultPTYProviders()
		}
		c.PTYProviders["claude"] = strings.Fields(raw)
	}
	return nil
}

func resolveConfigPath(path string) (string, error) {
	if path != "" {
		return path, nil
	}
	if envPath := os.Getenv("BUI_APP_TOML"); envPath != "" {
		return envPath, nil
	}
	root, err := FindProjectRoot()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, ConfigFile), nil
}

func defaultCORSOrigins() []string {
	if raw := strings.TrimSpace(os.Getenv("CORS_ORIGINS")); raw != "" {
		parts := strings.Split(raw, ",")
		origins := make([]string, 0, len(parts))
		for _, part := range parts {
			origin := strings.TrimSpace(part)
			if origin == "" {
				continue
			}
			origins = append(origins, origin)
		}
		if len(origins) > 0 {
			return origins
		}
	}

	return []string{
		"http://localhost:5173",
		"http://localhost:5174",
		"http://localhost:5175",
		"http://localhost:5176",
		"http://localhost:3000",
		"http://127.0.0.1:5173",
		"http://127.0.0.1:5174",
		"http://127.0.0.1:5175",
		"http://127.0.0.1:5176",
		"http://213.32.19.186:3000",
		"http://213.32.19.186:5173",
		"http://213.32.19.186:5174",
		"http://213.32.19.186:5175",
		"http://213.32.19.186:5176",
	}
}

func DefaultPTYProviders() map[string][]string {
	return map[string][]string{
		"shell":  {"bash"},
		"claude": {"claude", "--dangerously-skip-permissions"},
	}
}

func ClonePTYProviders(source map[string][]string) map[string][]string {
	cloned := make(map[string][]string, len(source))
	for name, command := range source {
		copied := make([]string, len(command))
		copy(copied, command)
		cloned[name] = copied
	}
	return cloned
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
