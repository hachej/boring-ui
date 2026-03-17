package git

import (
	"context"
	"errors"
	"io"
	"reflect"
	"testing"
)

func TestGitBackendInterfaceIncludesExpectedMethodsWithContextFirst(t *testing.T) {
	t.Parallel()

	backendType := reflect.TypeOf((*GitBackend)(nil)).Elem()
	contextType := reflect.TypeOf((*context.Context)(nil)).Elem()

	expected := []string{
		"IsRepo",
		"Status",
		"Diff",
		"DiffCached",
		"Log",
		"Show",
		"Init",
		"Add",
		"Commit",
		"Push",
		"Pull",
		"Fetch",
		"Clone",
		"BranchList",
		"CurrentBranchName",
		"BranchCreate",
		"BranchDelete",
		"Checkout",
		"Merge",
		"RemoteAdd",
		"RemoteDelete",
		"RemoteList",
		"StashList",
		"StashPush",
		"StashPop",
	}

	for _, name := range expected {
		method, ok := backendType.MethodByName(name)
		if !ok {
			t.Fatalf("expected method %s on GitBackend", name)
		}
		if method.Type.NumIn() == 0 {
			t.Fatalf("expected method %s to accept context.Context as its first parameter", name)
		}
		if method.Type.In(0) != contextType {
			t.Fatalf("expected method %s first parameter to be context.Context, got %s", name, method.Type.In(0))
		}
	}
}

func TestGitErrorHierarchySupportsIsAsAndUnwrap(t *testing.T) {
	t.Parallel()

	rootErr := io.EOF
	commandErr := NewGitCommandError("git commit", "commit failed", 128, "fatal: bad revision", rootErr)

	if !errors.Is(commandErr, &GitCommandError{}) {
		t.Fatal("expected command error to satisfy errors.Is for GitCommandError")
	}
	if !errors.Is(commandErr, &GitBackendError{}) {
		t.Fatal("expected command error to satisfy errors.Is for GitBackendError")
	}
	if !errors.Is(commandErr, io.EOF) {
		t.Fatal("expected command error to unwrap to the underlying cause")
	}

	var asCommand *GitCommandError
	if !errors.As(commandErr, &asCommand) {
		t.Fatal("expected errors.As to find GitCommandError")
	}
	if asCommand.ExitCode != 128 || asCommand.Stderr != "fatal: bad revision" {
		t.Fatalf("unexpected GitCommandError fields: %#v", asCommand)
	}

	var asBackend *GitBackendError
	if !errors.As(commandErr, &asBackend) {
		t.Fatal("expected errors.As to find GitBackendError through unwrap")
	}
	if asBackend.Op != "git commit" || asBackend.Message != "commit failed" {
		t.Fatalf("unexpected GitBackendError fields: %#v", asBackend)
	}

	authErr := NewGitAuthError("git push", "credentials rejected", commandErr)
	if !errors.Is(authErr, &GitAuthError{}) {
		t.Fatal("expected auth error to satisfy errors.Is for GitAuthError")
	}
	if !errors.Is(authErr, &GitBackendError{}) {
		t.Fatal("expected auth error to satisfy errors.Is for GitBackendError")
	}
	if !errors.Is(authErr, &GitCommandError{}) {
		t.Fatal("expected auth error to unwrap through GitCommandError")
	}

	conflictErr := NewGitConflictError("git merge", "merge conflict", rootErr)
	if !errors.Is(conflictErr, &GitConflictError{}) {
		t.Fatal("expected conflict error to satisfy errors.Is for GitConflictError")
	}

	notFoundErr := NewGitNotFoundError("git show", "path not tracked", rootErr)
	if !errors.Is(notFoundErr, &GitNotFoundError{}) {
		t.Fatal("expected not-found error to satisfy errors.Is for GitNotFoundError")
	}
}

func TestGitBackendErrorFormatting(t *testing.T) {
	t.Parallel()

	err := NewGitBackendError("git status", "repository unavailable", nil)
	if got := err.Error(); got != "git status: repository unavailable" {
		t.Fatalf("unexpected error string: %q", got)
	}

	err = NewGitBackendError("", "repository unavailable", nil)
	if got := err.Error(); got != "repository unavailable" {
		t.Fatalf("unexpected message-only error string: %q", got)
	}
}
