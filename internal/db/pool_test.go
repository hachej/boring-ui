package db

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
)

func TestConfigFromEnvPrefersDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://primary.example/neondb")
	t.Setenv("SUPABASE_DB_URL", "postgresql://fallback.example/postgres")

	cfg, err := ConfigFromEnv()
	if err != nil {
		t.Fatalf("config from env: %v", err)
	}

	if cfg.URL != "postgresql://primary.example/neondb" {
		t.Fatalf("expected DATABASE_URL to win, got %q", cfg.URL)
	}
	if cfg.MinConns != DefaultMinConns || cfg.MaxConns != DefaultMaxConns {
		t.Fatalf("unexpected defaults: min=%d max=%d", cfg.MinConns, cfg.MaxConns)
	}
}

func TestParsePoolConfigSetsDefaultsAndPoolerMode(t *testing.T) {
	poolConfig, err := ParsePoolConfig(Config{
		URL: "postgresql://user:pass@ep-demo-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require",
	})
	if err != nil {
		t.Fatalf("parse pool config: %v", err)
	}

	if poolConfig.MinConns != DefaultMinConns {
		t.Fatalf("expected min conns %d, got %d", DefaultMinConns, poolConfig.MinConns)
	}
	if poolConfig.MaxConns != DefaultMaxConns {
		t.Fatalf("expected max conns %d, got %d", DefaultMaxConns, poolConfig.MaxConns)
	}
	if got := poolConfig.ConnConfig.RuntimeParams["application_name"]; got != "boring-ui" {
		t.Fatalf("expected application name runtime param, got %q", got)
	}
	if got := poolConfig.ConnConfig.RuntimeParams["pool_mode"]; got != "transaction" {
		t.Fatalf("expected pool_mode=transaction for pooler host, got %q", got)
	}
}

func TestOpenAndCheckSchemaWithTestcontainers(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	container := startPostgresContainer(t, ctx, true)
	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("connection string: %v", err)
	}

	pool, err := Open(ctx, Config{URL: dsn})
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	if pool.Config().MinConns != DefaultMinConns {
		t.Fatalf("expected pool min conns %d, got %d", DefaultMinConns, pool.Config().MinConns)
	}
	if pool.Config().MaxConns != DefaultMaxConns {
		t.Fatalf("expected pool max conns %d, got %d", DefaultMaxConns, pool.Config().MaxConns)
	}

	if err := CheckSchema(ctx, pool); err != nil {
		t.Fatalf("schema check should pass: %v", err)
	}
}

func TestCheckSchemaFailsWhenRequiredTablesMissing(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	container := startPostgresContainer(t, ctx, false)
	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("connection string: %v", err)
	}

	pool, err := Open(ctx, Config{URL: dsn})
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	err = CheckSchema(ctx, pool)
	var missingErr MissingTablesError
	if !errors.As(err, &missingErr) {
		t.Fatalf("expected missing tables error, got %v", err)
	}
	if len(missingErr.Tables) != len(requiredTables) {
		t.Fatalf("expected all required tables missing, got %v", missingErr.Tables)
	}
	if !strings.Contains(err.Error(), "workspaces") {
		t.Fatalf("expected missing table list in error, got %v", err)
	}
}

func startPostgresContainer(t *testing.T, ctx context.Context, withSchema bool) *postgres.PostgresContainer {
	t.Helper()

	options := []testcontainers.ContainerCustomizer{
		postgres.WithDatabase("boring_ui_test"),
		postgres.WithUsername("postgres"),
		postgres.WithPassword("postgres"),
		postgres.BasicWaitStrategies(),
	}
	if withSchema {
		schemaPath, err := filepath.Abs(filepath.Join("testdata", "control_plane_schema.sql"))
		if err != nil {
			t.Fatalf("resolve schema path: %v", err)
		}
		options = append(options, postgres.WithInitScripts(schemaPath))
	}

	container, err := postgres.Run(ctx, "postgres:16-alpine", options...)
	if err != nil {
		t.Fatalf("start postgres container: %v", err)
	}
	t.Cleanup(func() {
		if terminateErr := container.Terminate(context.Background()); terminateErr != nil {
			t.Fatalf("terminate postgres container: %v", terminateErr)
		}
	})

	return container
}
