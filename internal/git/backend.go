package git

import (
	"context"
	"time"
)

// StatusEntry is a single file status entry from git status.
type StatusEntry struct {
	Path   string `json:"path"`
	Status string `json:"status"`
}

// RemoteInfo is a configured git remote.
type RemoteInfo struct {
	Remote string `json:"remote"`
	URL    string `json:"url"`
}

// GitCredentials is an opaque credential object passed through to the backend.
type GitCredentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// LogEntry is a single commit entry from git log.
type LogEntry struct {
	OID         string    `json:"oid"`
	Subject     string    `json:"subject"`
	AuthorName  string    `json:"author_name"`
	AuthorEmail string    `json:"author_email"`
	AuthoredAt  time.Time `json:"authored_at"`
}

// StashEntry is a single stash reference and summary.
type StashEntry struct {
	Name    string `json:"name"`
	Branch  string `json:"branch"`
	Message string `json:"message"`
}

// GitBackend defines the pluggable git operations surface used by the Go backend.
//
// The interface intentionally covers the current Python backend contract plus the
// additional methods required by the phase beads that follow this contract bead.
// All path arguments are repo-relative strings that have already been validated
// by higher-level services.
type GitBackend interface {
	IsRepo(ctx context.Context) (bool, error)
	Status(ctx context.Context) ([]StatusEntry, error)
	Diff(ctx context.Context, path string) (string, error)
	DiffCached(ctx context.Context, path string) (string, error)
	Log(ctx context.Context, limit int) ([]LogEntry, error)
	Show(ctx context.Context, path string) (string, error)

	Init(ctx context.Context) error
	Add(ctx context.Context, paths []string) error
	Commit(ctx context.Context, message string, authorName string, authorEmail string) (string, error)
	Push(ctx context.Context, remote string, branch string, credentials *GitCredentials) error
	Pull(ctx context.Context, remote string, branch string, credentials *GitCredentials) error
	Fetch(ctx context.Context, remote string, credentials *GitCredentials) error
	Clone(ctx context.Context, url string, branch string, credentials *GitCredentials) error

	BranchList(ctx context.Context) ([]string, string, error)
	CurrentBranchName(ctx context.Context) (string, error)
	BranchCreate(ctx context.Context, name string, checkout bool) error
	BranchDelete(ctx context.Context, name string, force bool) error
	Checkout(ctx context.Context, name string) error
	Merge(ctx context.Context, source string, message string) error

	RemoteAdd(ctx context.Context, name string, url string) error
	RemoteDelete(ctx context.Context, name string) error
	RemoteList(ctx context.Context) ([]RemoteInfo, error)

	StashList(ctx context.Context) ([]StashEntry, error)
	StashPush(ctx context.Context, message string, includeUntracked bool) (string, error)
	StashPop(ctx context.Context, name string) error
}
