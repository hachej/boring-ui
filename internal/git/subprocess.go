package git

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

var _ GitBackend = (*SubprocessGitBackend)(nil)

var credentialPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)(https?://)[^\s@]+@`),
	regexp.MustCompile(`\bghp_[A-Za-z0-9_]+\b`),
	regexp.MustCompile(`\bghs_[A-Za-z0-9_]+\b`),
	regexp.MustCompile(`\bgithub_pat_[A-Za-z0-9_]+\b`),
	regexp.MustCompile(`(?i)\bBearer\s+[A-Za-z0-9._\-]+\b`),
}

var authFailureMarkers = []string{
	"authentication failed",
	"could not read username",
	"permission denied",
	"invalid credentials",
	"authentication required",
	"repository not found",
}

type CommandFactory interface {
	CommandContext(ctx context.Context, name string, args ...string) *exec.Cmd
}

type execCommandFactory struct{}

func (execCommandFactory) CommandContext(ctx context.Context, name string, args ...string) *exec.Cmd {
	return exec.CommandContext(ctx, name, args...)
}

type SubprocessGitBackendConfig struct {
	WorkspaceRoot  string
	Timeout        time.Duration
	TempDir        string
	CommandFactory CommandFactory
}

type SubprocessGitBackend struct {
	workspaceRoot string
	timeout       time.Duration
	tempDir       string
	factory       CommandFactory
}

func NewSubprocessGitBackend(cfg SubprocessGitBackendConfig) *SubprocessGitBackend {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	factory := cfg.CommandFactory
	if factory == nil {
		factory = execCommandFactory{}
	}
	return &SubprocessGitBackend{
		workspaceRoot: filepath.Clean(cfg.WorkspaceRoot),
		timeout:       timeout,
		tempDir:       cfg.TempDir,
		factory:       factory,
	}
}

func sanitizeGitOutput(value string) string {
	sanitized := strings.TrimSpace(value)
	for _, pattern := range credentialPatterns {
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

func sanitizeURL(value string) string {
	return regexp.MustCompile(`(?i)(https?://)[^\s@]+@`).ReplaceAllString(value, `${1}***@`)
}

func normalizeStatus(raw string) string {
	value := strings.TrimSpace(raw)
	switch {
	case value == "??" || value == "?":
		return "U"
	case value == "UU" || value == "AA" || value == "DD" || value == "DU" || value == "UD" || value == "AU" || value == "UA":
		return "C"
	case value == "D" || value == "D " || value == " D":
		return "D"
	case value == "A" || value == "A " || value == " A":
		return "A"
	case value == "M" || value == "M " || value == " M" || value == "MM":
		return "M"
	case strings.HasPrefix(value, "R"):
		return "M"
	case strings.HasPrefix(value, "C"):
		return "A"
	default:
		for _, r := range value {
			if strings.ContainsRune("MADU", r) {
				return string(r)
			}
			if r != ' ' {
				break
			}
		}
		return "M"
	}
}

func (b *SubprocessGitBackend) run(ctx context.Context, timeout time.Duration, cwd string, credentials *GitCredentials, args ...string) (string, string, error) {
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := b.factory.CommandContext(runCtx, "git", args...)
	if strings.TrimSpace(cwd) == "" {
		cwd = b.workspaceRoot
	}
	cmd.Dir = cwd

	env := os.Environ()
	askpassPath, err := createAskpassScript(b.tempDir, credentials)
	if err != nil {
		return "", "", NewGitCommandError("git "+strings.Join(args, " "), "failed to create askpass script", 0, "", err)
	}
	defer cleanupAskpass(askpassPath)
	if askpassPath != "" {
		env = append(env, "GIT_ASKPASS="+askpassPath, "GIT_TERMINAL_PROMPT=0")
	}
	env = append(env, "LC_ALL=C")
	cmd.Env = env

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		sanitizedStdout := sanitizeGitOutput(stdout.String())
		sanitizedStderr := sanitizeGitOutput(stderr.String())
		message := strings.TrimSpace(sanitizedStderr)
		if message == "" {
			message = strings.TrimSpace(sanitizedStdout)
		}
		if errors.Is(runCtx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) {
			return sanitizedStdout, sanitizedStderr, NewGitCommandError(
				"git "+strings.Join(args, " "),
				fmt.Sprintf("git command timed out after %s", timeout),
				0,
				message,
				context.DeadlineExceeded,
			)
		}

		exitCode := 0
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			exitCode = exitErr.ExitCode()
		}
		lowerMessage := strings.ToLower(message)
		switch {
		case looksLikeAuthFailure(lowerMessage):
			return sanitizedStdout, sanitizedStderr, NewGitAuthError("git "+strings.Join(args, " "), message, err)
		case looksLikeConflict(lowerMessage, strings.ToLower(sanitizedStdout)):
			return sanitizedStdout, sanitizedStderr, NewGitConflictError("git "+strings.Join(args, " "), message, err)
		case looksLikeNotFound(lowerMessage):
			return sanitizedStdout, sanitizedStderr, NewGitNotFoundError("git "+strings.Join(args, " "), message, err)
		default:
			return sanitizedStdout, sanitizedStderr, NewGitCommandError("git "+strings.Join(args, " "), message, exitCode, sanitizedStderr, err)
		}
	}

	return stdout.String(), stderr.String(), nil
}

func (b *SubprocessGitBackend) IsRepo(ctx context.Context) (bool, error) {
	_, _, err := b.run(ctx, b.timeout, "", nil, "rev-parse", "--git-dir")
	if err == nil {
		return true, nil
	}
	if looksLikeNotRepo(strings.ToLower(err.Error())) {
		return false, nil
	}
	var commandErr *GitCommandError
	if errors.As(err, &commandErr) && looksLikeNotRepo(strings.ToLower(commandErr.Stderr)) {
		return false, nil
	}
	return false, err
}

func (b *SubprocessGitBackend) Status(ctx context.Context) ([]StatusEntry, error) {
	isRepo, err := b.IsRepo(ctx)
	if err != nil || !isRepo {
		return []StatusEntry{}, err
	}

	stdout, _, err := b.run(ctx, b.timeout, "", nil, "status", "--porcelain")
	if err != nil {
		return nil, err
	}

	files := map[string]string{}
	priorities := map[string]int{"C": 5, "D": 4, "A": 3, "M": 2, "U": 1}
	for _, line := range strings.Split(strings.TrimSpace(stdout), "\n") {
		if len(line) < 3 {
			continue
		}

		var rawStatus string
		var filePath string
		if len(line) > 3 && line[2] == ' ' {
			rawStatus = line[:2]
			filePath = line[3:]
		} else {
			rawStatus = line[:1]
			if len(line) > 1 && line[1] == ' ' {
				filePath = line[2:]
			} else if len(line) > 3 {
				filePath = line[3:]
			}
		}

		if strings.HasPrefix(rawStatus, "R") || strings.HasPrefix(rawStatus, "C") {
			if strings.Contains(filePath, " -> ") {
				parts := strings.Split(filePath, " -> ")
				filePath = parts[len(parts)-1]
			}
		}

		filePath = strings.TrimSpace(filePath)
		if rawStatus == "" || filePath == "" {
			continue
		}
		statusCode := normalizeStatus(rawStatus)
		if existing, ok := files[filePath]; !ok || priorities[statusCode] > priorities[existing] {
			files[filePath] = statusCode
		}
	}

	out := make([]StatusEntry, 0, len(files))
	for path, status := range files {
		out = append(out, StatusEntry{Path: path, Status: status})
	}
	sort.Slice(out, func(i int, j int) bool {
		return out[i].Path < out[j].Path
	})
	return out, nil
}

func (b *SubprocessGitBackend) Diff(ctx context.Context, path string) (string, error) {
	stdout, _, err := b.run(ctx, b.timeout, "", nil, "diff", "HEAD", "--", path)
	var notFound *GitNotFoundError
	var commandErr *GitCommandError
	if err != nil && !errors.As(err, &notFound) && !errors.As(err, &commandErr) {
		return "", err
	}
	if err != nil {
		return "", nil
	}
	return stdout, nil
}

func (b *SubprocessGitBackend) DiffCached(ctx context.Context, path string) (string, error) {
	stdout, _, err := b.run(ctx, b.timeout, "", nil, "diff", "--cached", "--", path)
	var notFound *GitNotFoundError
	var commandErr *GitCommandError
	if err != nil && !errors.As(err, &notFound) && !errors.As(err, &commandErr) {
		return "", err
	}
	if err != nil {
		return "", nil
	}
	return stdout, nil
}

func (b *SubprocessGitBackend) Log(ctx context.Context, limit int) ([]LogEntry, error) {
	if limit <= 0 {
		limit = 50
	}
	stdout, _, err := b.run(ctx, b.timeout, "", nil, "log", "--format=%H%x00%s%x00%an%x00%ae%x00%aI", "-n", strconv.Itoa(limit))
	if err != nil {
		if looksLikeNotRepo(strings.ToLower(err.Error())) {
			return []LogEntry{}, nil
		}
		return nil, err
	}
	lines := strings.Split(strings.TrimSpace(stdout), "\n")
	out := make([]LogEntry, 0, len(lines))
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.Split(line, "\x00")
		if len(parts) != 5 {
			continue
		}
		authoredAt, parseErr := time.Parse(time.RFC3339, parts[4])
		if parseErr != nil {
			authoredAt = time.Time{}
		}
		out = append(out, LogEntry{
			OID:         parts[0],
			Subject:     parts[1],
			AuthorName:  parts[2],
			AuthorEmail: parts[3],
			AuthoredAt:  authoredAt,
		})
	}
	return out, nil
}

func (b *SubprocessGitBackend) Show(ctx context.Context, path string) (string, error) {
	stdout, _, err := b.run(ctx, b.timeout, "", nil, "show", "HEAD:"+path)
	if err != nil {
		return "", err
	}
	return stdout, nil
}

func (b *SubprocessGitBackend) Init(ctx context.Context) error {
	_, _, err := b.run(ctx, b.timeout, "", nil, "init")
	return err
}

func (b *SubprocessGitBackend) Add(ctx context.Context, paths []string) error {
	args := []string{"add"}
	if paths == nil {
		args = append(args, "-A")
	} else if len(paths) == 0 {
		return nil
	} else {
		args = append(args, "--")
		args = append(args, paths...)
	}
	_, _, err := b.run(ctx, b.timeout, "", nil, args...)
	return err
}

func (b *SubprocessGitBackend) Commit(ctx context.Context, message string, authorName string, authorEmail string) (string, error) {
	args := []string{"commit", "-m", message}
	if strings.TrimSpace(authorName) != "" && strings.TrimSpace(authorEmail) != "" {
		args = append(args, "--author", fmt.Sprintf("%s <%s>", authorName, authorEmail))
	}
	if _, _, err := b.run(ctx, b.timeout, "", nil, args...); err != nil {
		return "", err
	}
	stdout, _, err := b.run(ctx, b.timeout, "", nil, "rev-parse", "HEAD")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(stdout), nil
}

func (b *SubprocessGitBackend) Push(ctx context.Context, remote string, branch string, credentials *GitCredentials) error {
	args := []string{"push", remote}
	if strings.TrimSpace(branch) != "" {
		args = append(args, branch)
	}
	_, _, err := b.run(ctx, 60*time.Second, "", credentials, args...)
	return err
}

func (b *SubprocessGitBackend) Pull(ctx context.Context, remote string, branch string, credentials *GitCredentials) error {
	args := []string{"pull", remote}
	if strings.TrimSpace(branch) != "" {
		args = append(args, branch)
	}
	_, _, err := b.run(ctx, 60*time.Second, "", credentials, args...)
	return err
}

func (b *SubprocessGitBackend) Fetch(ctx context.Context, remote string, credentials *GitCredentials) error {
	args := []string{"fetch"}
	if strings.TrimSpace(remote) != "" {
		args = append(args, remote)
	}
	_, _, err := b.run(ctx, 60*time.Second, "", credentials, args...)
	return err
}

func (b *SubprocessGitBackend) Clone(ctx context.Context, url string, branch string, credentials *GitCredentials) error {
	args := []string{"clone", "--depth", "1"}
	if strings.TrimSpace(branch) != "" {
		args = append(args, "-b", branch)
	}
	args = append(args, "--", url, b.workspaceRoot)
	_, _, err := b.run(ctx, 120*time.Second, filepath.Dir(b.workspaceRoot), credentials, args...)
	return err
}

func (b *SubprocessGitBackend) BranchList(ctx context.Context) ([]string, string, error) {
	isRepo, err := b.IsRepo(ctx)
	if err != nil || !isRepo {
		return []string{}, "", err
	}
	stdout, _, err := b.run(ctx, b.timeout, "", nil, "branch", "--list", "--no-color")
	if err != nil {
		return nil, "", err
	}
	var branches []string
	current := ""
	for _, line := range strings.Split(strings.TrimSpace(stdout), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		isCurrent := strings.HasPrefix(line, "*")
		name := strings.TrimSpace(strings.TrimPrefix(line, "*"))
		if name == "" || strings.HasPrefix(name, "(") {
			continue
		}
		branches = append(branches, name)
		if isCurrent {
			current = name
		}
	}
	return branches, current, nil
}

func (b *SubprocessGitBackend) CurrentBranchName(ctx context.Context) (string, error) {
	isRepo, err := b.IsRepo(ctx)
	if err != nil || !isRepo {
		return "", err
	}
	stdout, _, err := b.run(ctx, b.timeout, "", nil, "rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return "", nil
	}
	name := strings.TrimSpace(stdout)
	if name == "HEAD" {
		return "", nil
	}
	return name, nil
}

func (b *SubprocessGitBackend) BranchCreate(ctx context.Context, name string, checkout bool) error {
	if checkout {
		_, _, err := b.run(ctx, b.timeout, "", nil, "checkout", "-b", name)
		return err
	}
	_, _, err := b.run(ctx, b.timeout, "", nil, "branch", name)
	return err
}

func (b *SubprocessGitBackend) BranchDelete(ctx context.Context, name string, force bool) error {
	flag := "-d"
	if force {
		flag = "-D"
	}
	_, _, err := b.run(ctx, b.timeout, "", nil, "branch", flag, name)
	return err
}

func (b *SubprocessGitBackend) Checkout(ctx context.Context, name string) error {
	_, _, err := b.run(ctx, b.timeout, "", nil, "checkout", name)
	return err
}

func (b *SubprocessGitBackend) Merge(ctx context.Context, source string, message string) error {
	args := []string{"merge", source}
	if strings.TrimSpace(message) != "" {
		args = append(args, "-m", message)
	}
	_, _, err := b.run(ctx, 60*time.Second, "", nil, args...)
	if err == nil {
		return nil
	}
	var conflictErr *GitConflictError
	if errors.As(err, &conflictErr) {
		_, _, abortErr := b.run(ctx, 10*time.Second, "", nil, "merge", "--abort")
		if abortErr != nil {
			return err
		}
	}
	return err
}

func (b *SubprocessGitBackend) RemoteAdd(ctx context.Context, name string, url string) error {
	_, _, _ = b.run(ctx, b.timeout, "", nil, "remote", "remove", "--", name)
	_, _, err := b.run(ctx, b.timeout, "", nil, "remote", "add", "--", name, url)
	return err
}

func (b *SubprocessGitBackend) RemoteDelete(ctx context.Context, name string) error {
	_, _, _ = b.run(ctx, b.timeout, "", nil, "remote", "remove", "--", name)
	return nil
}

func (b *SubprocessGitBackend) RemoteList(ctx context.Context) ([]RemoteInfo, error) {
	isRepo, err := b.IsRepo(ctx)
	if err != nil || !isRepo {
		return []RemoteInfo{}, err
	}
	stdout, _, err := b.run(ctx, b.timeout, "", nil, "remote", "-v")
	if err != nil {
		return nil, err
	}
	var remotes []RemoteInfo
	seen := map[string]struct{}{}
	for _, line := range strings.Split(strings.TrimSpace(stdout), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 3 && fields[len(fields)-1] == "(fetch)" {
			if _, ok := seen[fields[0]]; ok {
				continue
			}
			seen[fields[0]] = struct{}{}
			remotes = append(remotes, RemoteInfo{Remote: fields[0], URL: sanitizeURL(fields[1])})
		}
	}
	return remotes, nil
}

func (b *SubprocessGitBackend) StashList(ctx context.Context) ([]StashEntry, error) {
	stdout, _, err := b.run(ctx, b.timeout, "", nil, "stash", "list", "--format=%gd%x00%gs")
	if err != nil {
		if looksLikeNotRepo(strings.ToLower(err.Error())) {
			return []StashEntry{}, nil
		}
		return nil, err
	}
	var stashes []StashEntry
	for _, line := range strings.Split(strings.TrimSpace(stdout), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.Split(line, "\x00")
		if len(parts) != 2 {
			continue
		}
		stashes = append(stashes, StashEntry{Name: parts[0], Message: parts[1]})
	}
	return stashes, nil
}

func (b *SubprocessGitBackend) StashPush(ctx context.Context, message string, includeUntracked bool) (string, error) {
	args := []string{"stash", "push"}
	if includeUntracked {
		args = append(args, "-u")
	}
	if strings.TrimSpace(message) != "" {
		args = append(args, "-m", message)
	}
	if _, _, err := b.run(ctx, b.timeout, "", nil, args...); err != nil {
		return "", err
	}
	stashes, err := b.StashList(ctx)
	if err != nil || len(stashes) == 0 {
		return "", err
	}
	return stashes[0].Name, nil
}

func (b *SubprocessGitBackend) StashPop(ctx context.Context, name string) error {
	args := []string{"stash", "pop"}
	if strings.TrimSpace(name) != "" {
		args = append(args, name)
	}
	_, _, err := b.run(ctx, b.timeout, "", nil, args...)
	return err
}

func looksLikeAuthFailure(message string) bool {
	for _, marker := range authFailureMarkers {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
}

func looksLikeConflict(stderr string, stdout string) bool {
	return strings.Contains(stderr, "conflict") || strings.Contains(stdout, "merge conflict")
}

func looksLikeNotRepo(message string) bool {
	return strings.Contains(message, "not a git repository")
}

func looksLikeNotFound(message string) bool {
	return strings.Contains(message, "does not exist in 'head'") ||
		strings.Contains(message, "exists on disk, but not in 'head'") ||
		strings.Contains(message, "unknown revision or path not in the working tree") ||
		strings.Contains(message, "not found")
}
