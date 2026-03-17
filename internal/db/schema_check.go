package db

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
)

var requiredTables = []string{
	"workspaces",
	"members",
	"invites",
	"settings",
	"workspace_settings",
	"workspace_runtimes",
	"users",
}

var ErrNilQueryer = errors.New("schema queryer is nil")

type Queryer interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

type MissingTablesError struct {
	Tables []string
}

func (e MissingTablesError) Error() string {
	return fmt.Sprintf("missing required tables: %s", strings.Join(e.Tables, ", "))
}

func CheckSchema(ctx context.Context, queryer Queryer) error {
	if queryer == nil {
		return ErrNilQueryer
	}

	rows, err := queryer.Query(ctx, `
		SELECT table_name
		FROM information_schema.tables
		WHERE table_schema = current_schema()
		  AND table_type = 'BASE TABLE'
		  AND table_name = ANY($1)
	`, requiredTables)
	if err != nil {
		return fmt.Errorf("query schema tables: %w", err)
	}
	defer rows.Close()

	found := make([]string, 0, len(requiredTables))
	for rows.Next() {
		var table string
		if err := rows.Scan(&table); err != nil {
			return fmt.Errorf("scan schema table: %w", err)
		}
		found = append(found, table)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate schema tables: %w", err)
	}

	missing := make([]string, 0, len(requiredTables))
	for _, table := range requiredTables {
		if !slices.Contains(found, table) {
			missing = append(missing, table)
		}
	}
	if len(missing) > 0 {
		return MissingTablesError{Tables: missing}
	}

	return nil
}

// MustCheckSchema is the startup guard that exits the process on schema drift.
func MustCheckSchema(ctx context.Context, queryer Queryer, logger *slog.Logger) {
	if err := CheckSchema(ctx, queryer); err != nil {
		if logger == nil {
			logger = slog.Default()
		}
		logger.Error("database schema check failed", "error", err)
		os.Exit(1)
	}
}
