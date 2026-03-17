package db

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	DefaultMinConns int32 = 2
	DefaultMaxConns int32 = 10
	defaultPingWait       = 5 * time.Second
)

var ErrMissingDatabaseURL = errors.New("database url not configured")

// Config is the narrow DB bootstrap config the current Go backend needs.
type Config struct {
	URL      string
	MinConns int32
	MaxConns int32
}

// ConfigFromEnv mirrors the current Python control-plane env contract.
func ConfigFromEnv() (Config, error) {
	dbURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dbURL == "" {
		dbURL = strings.TrimSpace(os.Getenv("SUPABASE_DB_URL"))
	}
	if dbURL == "" {
		return Config{}, ErrMissingDatabaseURL
	}

	return Config{
		URL:      dbURL,
		MinConns: DefaultMinConns,
		MaxConns: DefaultMaxConns,
	}, nil
}

// UsesConnectionPooler keeps Neon and Supabase pooler hosts on the pooler path.
func UsesConnectionPooler(dbURL string) bool {
	parsed, err := url.Parse(dbURL)
	if err != nil {
		return false
	}

	host := strings.ToLower(parsed.Hostname())
	if strings.HasSuffix(host, ".pooler.supabase.com") {
		return true
	}
	if strings.Contains(host, "-pooler") {
		return true
	}

	query := parsed.Query()
	return isTruthy(query.Get("pgbouncer"))
}

func ParsePoolConfig(cfg Config) (*pgxpool.Config, error) {
	normalized, err := normalizeConfig(cfg)
	if err != nil {
		return nil, err
	}

	poolConfig, err := pgxpool.ParseConfig(normalized.URL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}

	poolConfig.MinConns = normalized.MinConns
	poolConfig.MaxConns = normalized.MaxConns
	if poolConfig.ConnConfig.RuntimeParams == nil {
		poolConfig.ConnConfig.RuntimeParams = map[string]string{}
	}
	poolConfig.ConnConfig.RuntimeParams["application_name"] = "boring-ui"
	if UsesConnectionPooler(normalized.URL) {
		poolConfig.ConnConfig.RuntimeParams["pool_mode"] = "transaction"
	}

	return poolConfig, nil
}

func Open(ctx context.Context, cfg Config) (*pgxpool.Pool, error) {
	poolConfig, err := ParsePoolConfig(cfg)
	if err != nil {
		return nil, err
	}

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("open database pool: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, defaultPingWait)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	return pool, nil
}

func normalizeConfig(cfg Config) (Config, error) {
	cfg.URL = strings.TrimSpace(cfg.URL)
	if cfg.URL == "" {
		return Config{}, ErrMissingDatabaseURL
	}
	if cfg.MinConns <= 0 {
		cfg.MinConns = DefaultMinConns
	}
	if cfg.MaxConns <= 0 {
		cfg.MaxConns = DefaultMaxConns
	}
	if cfg.MaxConns < cfg.MinConns {
		return Config{}, fmt.Errorf("invalid pool config: max connections %d is below min connections %d", cfg.MaxConns, cfg.MinConns)
	}

	return cfg, nil
}

func isTruthy(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}
