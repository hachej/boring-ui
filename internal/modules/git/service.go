package git

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/boringdata/boring-ui/internal/app"
	"github.com/boringdata/boring-ui/internal/config"
	gitbackend "github.com/boringdata/boring-ui/internal/git"
)

var (
	safeNamePattern = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9._\-/]*$`)
	scpStylePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._\-]*@[A-Za-z0-9][A-Za-z0-9._\-]*:.+$`)
	errorPatterns   = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(https?://)[^\s@]+@`),
		regexp.MustCompile(`\bghp_[A-Za-z0-9_]+\b`),
		regexp.MustCompile(`\bghs_[A-Za-z0-9_]+\b`),
		regexp.MustCompile(`\bgithub_pat_[A-Za-z0-9_]+\b`),
		regexp.MustCompile(`(?i)\bBearer\s+[A-Za-z0-9._\-]+\b`),
	}
)

type Service struct {
	root    string
	backend gitbackend.GitBackend
}

func NewService(cfg config.Config, backend gitbackend.GitBackend) (*Service, error) {
	root, err := workspaceRoot(cfg)
	if err != nil {
		return nil, err
	}
	if backend == nil {
		backend = gitbackend.NewSubprocessGitBackend(gitbackend.SubprocessGitBackendConfig{
			WorkspaceRoot: root,
		})
	}
	return &Service{
		root:    root,
		backend: backend,
	}, nil
}

func (s *Service) Status(ctx context.Context) (map[string]any, error) {
	isRepo, err := s.backend.IsRepo(ctx)
	if err != nil {
		return nil, s.mapError(err)
	}
	if !isRepo {
		return map[string]any{
			"is_repo":   false,
			"available": true,
			"files":     []gitbackend.StatusEntry{},
		}, nil
	}
	files, err := s.backend.Status(ctx)
	if err != nil {
		return nil, s.mapError(err)
	}
	return map[string]any{
		"is_repo":   true,
		"available": true,
		"files":     files,
	}, nil
}

func (s *Service) Diff(ctx context.Context, path string) (map[string]any, error) {
	displayPath, relPath, err := s.validatePath(path)
	if err != nil {
		return nil, err
	}
	diff, err := s.backend.Diff(ctx, relPath)
	if err != nil {
		return nil, s.mapError(err)
	}
	return map[string]any{
		"diff": diff,
		"path": displayPath,
	}, nil
}

func (s *Service) Show(ctx context.Context, path string) (map[string]any, error) {
	displayPath, relPath, err := s.validatePath(path)
	if err != nil {
		return nil, err
	}
	content, err := s.backend.Show(ctx, relPath)
	if err != nil {
		var notFound *gitbackend.GitNotFoundError
		if errors.As(err, &notFound) {
			return map[string]any{
				"content": nil,
				"path":    displayPath,
				"error":   "Not in HEAD",
			}, nil
		}
		return nil, s.mapError(err)
	}
	return map[string]any{
		"content": content,
		"path":    displayPath,
	}, nil
}

func (s *Service) Init(ctx context.Context) (map[string]any, error) {
	if err := s.backend.Init(ctx); err != nil {
		return nil, s.mapError(err)
	}
	return map[string]any{"initialized": true}, nil
}

func (s *Service) Add(ctx context.Context, paths []string) (map[string]any, error) {
	if len(paths) == 0 {
		return map[string]any{"staged": false}, nil
	}
	validated := make([]string, 0, len(paths))
	for _, path := range paths {
		_, relPath, err := s.validatePath(path)
		if err != nil {
			return nil, err
		}
		validated = append(validated, relPath)
	}
	if err := s.backend.Add(ctx, validated); err != nil {
		return nil, s.mapError(err)
	}
	return map[string]any{"staged": true}, nil
}

func (s *Service) Commit(ctx context.Context, message string, authorName string, authorEmail string) (map[string]any, error) {
	if strings.TrimSpace(message) == "" {
		message = "auto commit"
	}
	oid, err := s.backend.Commit(ctx, message, authorName, authorEmail)
	if err != nil {
		return nil, s.mapError(err)
	}
	return map[string]any{"oid": oid}, nil
}

func (s *Service) Push(ctx context.Context, remote string, branch string, credentials *gitbackend.GitCredentials) (map[string]any, error) {
	if strings.TrimSpace(remote) == "" {
		remote = "origin"
	}
	if err := validateGitRef(remote, "remote"); err != nil {
		return nil, err
	}
	if strings.TrimSpace(branch) != "" {
		if err := validateGitRef(branch, "branch"); err != nil {
			return nil, err
		}
	}
	if err := s.backend.Push(ctx, remote, branch, credentials); err != nil {
		return nil, s.mapError(err)
	}
	return map[string]any{"pushed": true}, nil
}

func (s *Service) Pull(ctx context.Context, remote string, branch string, credentials *gitbackend.GitCredentials) (map[string]any, error) {
	if strings.TrimSpace(remote) == "" {
		remote = "origin"
	}
	if err := validateGitRef(remote, "remote"); err != nil {
		return nil, err
	}
	if strings.TrimSpace(branch) != "" {
		if err := validateGitRef(branch, "branch"); err != nil {
			return nil, err
		}
	}
	if err := s.backend.Pull(ctx, remote, branch, credentials); err != nil {
		return nil, s.mapError(err)
	}
	return map[string]any{"pulled": true}, nil
}

func (s *Service) Clone(ctx context.Context, url string, branch string, credentials *gitbackend.GitCredentials) (map[string]any, error) {
	if strings.TrimSpace(url) == "" {
		return nil, app.APIError{Status: http.StatusBadRequest, Code: "invalid_url", Message: "url is required"}
	}
	if err := validateGitURL(url); err != nil {
		return nil, err
	}
	if strings.TrimSpace(branch) != "" {
		if err := validateGitRef(branch, "branch"); err != nil {
			return nil, err
		}
	}
	if err := s.backend.Clone(ctx, url, branch, credentials); err != nil {
		return nil, s.mapError(err)
	}
	return map[string]any{"cloned": true}, nil
}

func (s *Service) Log(ctx context.Context, limit int) (map[string]any, error) {
	commits, err := s.backend.Log(ctx, limit)
	if err != nil {
		return nil, s.mapError(err)
	}
	return map[string]any{"commits": commits}, nil
}

func (s *Service) Branches(ctx context.Context) (map[string]any, error) {
	isRepo, err := s.backend.IsRepo(ctx)
	if err != nil {
		return nil, s.mapError(err)
	}
	if !isRepo {
		return map[string]any{
			"branches": []string{},
			"current":  nil,
		}, nil
	}
	branches, current, err := s.backend.BranchList(ctx)
	if err != nil {
		return nil, s.mapError(err)
	}
	if branches == nil {
		branches = []string{}
	}
	var currentValue any
	if strings.TrimSpace(current) != "" {
		currentValue = current
	}
	return map[string]any{
		"branches": branches,
		"current":  currentValue,
	}, nil
}

func (s *Service) CurrentBranch(ctx context.Context) (map[string]any, error) {
	name, err := s.backend.CurrentBranchName(ctx)
	if err != nil {
		return nil, s.mapError(err)
	}
	var branch any
	if strings.TrimSpace(name) != "" {
		branch = name
	}
	return map[string]any{"branch": branch}, nil
}

func (s *Service) CreateBranch(ctx context.Context, name string, checkout bool) (map[string]any, error) {
	if err := validateGitRef(name, "branch"); err != nil {
		return nil, err
	}
	if err := s.backend.BranchCreate(ctx, name, checkout); err != nil {
		return nil, s.mapError(err)
	}
	return map[string]any{
		"created":     true,
		"branch":      name,
		"checked_out": checkout,
	}, nil
}

func (s *Service) Checkout(ctx context.Context, name string) (map[string]any, error) {
	if err := validateGitRef(name, "branch"); err != nil {
		return nil, err
	}
	if err := s.backend.Checkout(ctx, name); err != nil {
		return nil, s.mapError(err)
	}
	return map[string]any{
		"checked_out": true,
		"branch":      name,
	}, nil
}

func (s *Service) Merge(ctx context.Context, source string, message string) (map[string]any, error) {
	if err := validateGitRef(source, "branch"); err != nil {
		return nil, err
	}
	if err := s.backend.Merge(ctx, source, message); err != nil {
		return nil, s.mapError(err)
	}
	return map[string]any{
		"merged": true,
		"source": source,
	}, nil
}

func (s *Service) AddRemote(ctx context.Context, name string, url string) (map[string]any, error) {
	if err := validateGitRef(name, "remote"); err != nil {
		return nil, err
	}
	if err := validateGitURL(url); err != nil {
		return nil, err
	}
	if err := s.backend.RemoteAdd(ctx, name, url); err != nil {
		return nil, s.mapError(err)
	}
	return map[string]any{"added": true}, nil
}

func (s *Service) Remotes(ctx context.Context) (map[string]any, error) {
	remotes, err := s.backend.RemoteList(ctx)
	if err != nil {
		return nil, s.mapError(err)
	}
	if remotes == nil {
		remotes = []gitbackend.RemoteInfo{}
	}
	return map[string]any{"remotes": remotes}, nil
}

func (s *Service) validatePath(raw string) (string, string, error) {
	displayPath := strings.TrimSpace(raw)
	if displayPath == "" {
		return "", "", app.APIError{Status: http.StatusBadRequest, Code: "invalid_path", Message: "path is required"}
	}
	cleaned := filepath.Clean(displayPath)
	absPath := filepath.Join(s.root, cleaned)
	relPath, err := filepath.Rel(s.root, absPath)
	if err != nil {
		return "", "", app.APIError{Status: http.StatusInternalServerError, Code: "path_error", Message: err.Error()}
	}
	if relPath == ".." || strings.HasPrefix(relPath, ".."+string(os.PathSeparator)) {
		return "", "", app.APIError{Status: http.StatusForbidden, Code: "path_forbidden", Message: "path escapes workspace root"}
	}
	return displayPath, filepath.ToSlash(relPath), nil
}

func (s *Service) mapError(err error) error {
	if err == nil {
		return nil
	}

	var authErr *gitbackend.GitAuthError
	if errors.As(err, &authErr) {
		return app.APIError{Status: http.StatusUnauthorized, Code: "git_auth_failed", Message: "Authentication failed: " + sanitizeGitError(authErr.Error())}
	}

	var conflictErr *gitbackend.GitConflictError
	if errors.As(err, &conflictErr) {
		return app.APIError{Status: http.StatusConflict, Code: "git_conflict", Message: sanitizeGitError(conflictErr.Error())}
	}

	var commandErr *gitbackend.GitCommandError
	if errors.As(err, &commandErr) {
		message := sanitizeGitError(commandErr.Stderr)
		if message == "" {
			message = sanitizeGitError(commandErr.Error())
		}
		if strings.Contains(strings.ToLower(message), "nothing to commit") {
			return app.APIError{Status: http.StatusBadRequest, Code: "git_nothing_to_commit", Message: "Git error: " + message}
		}
		return app.APIError{Status: http.StatusInternalServerError, Code: "git_error", Message: "Git error: " + message}
	}

	var notFoundErr *gitbackend.GitNotFoundError
	if errors.As(err, &notFoundErr) {
		return app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: sanitizeGitError(notFoundErr.Error())}
	}

	return app.APIError{Status: http.StatusInternalServerError, Code: "git_error", Message: sanitizeGitError(err.Error())}
}

func sanitizeGitError(value string) string {
	sanitized := strings.TrimSpace(value)
	for _, pattern := range errorPatterns {
		switch pattern.String() {
		case `(?i)(https?://)[^\s@]+@`:
			sanitized = pattern.ReplaceAllString(sanitized, `${1}***@`)
		case `(?i)\bBearer\s+[A-Za-z0-9._\-]+\b`:
			sanitized = pattern.ReplaceAllString(sanitized, "Bearer ***")
		default:
			sanitized = pattern.ReplaceAllString(sanitized, "***")
		}
	}
	return sanitized
}

func validateGitRef(value string, label string) error {
	if !safeNamePattern.MatchString(strings.TrimSpace(value)) {
		return app.APIError{Status: http.StatusBadRequest, Code: "invalid_ref", Message: fmt.Sprintf("invalid %s: %q", label, value)}
	}
	return nil
}

func validateGitURL(value string) error {
	trimmed := strings.TrimSpace(value)
	switch {
	case trimmed == "":
		return app.APIError{Status: http.StatusBadRequest, Code: "invalid_url", Message: "url is required"}
	case scpStylePattern.MatchString(trimmed):
		return nil
	case strings.HasPrefix(trimmed, "http://"), strings.HasPrefix(trimmed, "https://"), strings.HasPrefix(trimmed, "git://"), strings.HasPrefix(trimmed, "ssh://"):
		return nil
	default:
		return app.APIError{Status: http.StatusBadRequest, Code: "invalid_url", Message: fmt.Sprintf("invalid git URL: %q", value)}
	}
}

func workspaceRoot(cfg config.Config) (string, error) {
	if cfg.ConfigPath != "" {
		root := filepath.Dir(cfg.ConfigPath)
		if resolved, err := filepath.EvalSymlinks(root); err == nil {
			return resolved, nil
		}
		return root, nil
	}
	root, err := config.FindProjectRoot()
	if err == nil {
		if resolved, resolveErr := filepath.EvalSymlinks(root); resolveErr == nil {
			return resolved, nil
		}
		return root, nil
	}
	return os.Getwd()
}
