// Package framework resolves the boring-ui framework location.
package framework

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/boringdata/boring-ui/bui/config"
)

// Resolve finds the boring-ui framework path based on mode (dev or deploy).
func Resolve(cfg *config.AppConfig, mode string) (string, error) {
	if mode == "deploy" {
		// Deploy ALWAYS uses pinned commit
		return FetchToCache(cfg.Framework.Repo, cfg.Framework.Commit)
	}

	// Dev mode: auto-detect local checkout
	// 1. Ancestor directory (supports examples nested inside a boring-ui checkout)
	cwd, _ := os.Getwd()
	if ancestor := findAncestorFramework(cwd); ancestor != "" {
		checkDrift(ancestor, cfg.Framework.Commit)
		return ancestor, nil
	}

	// 1. Sibling directory
	sibling := filepath.Join(filepath.Dir(cwd), "boring-ui")
	if isBoringUI(sibling) {
		checkDrift(sibling, cfg.Framework.Commit)
		return sibling, nil
	}

	// 2. Explicit override
	if envPath := os.Getenv("BUI_FRAMEWORK_PATH"); envPath != "" {
		if isBoringUI(envPath) {
			return envPath, nil
		}
		return "", fmt.Errorf("BUI_FRAMEWORK_PATH=%s does not contain boring.app.toml", envPath)
	}

	// 3. Fetch from git to cache
	return FetchToCache(cfg.Framework.Repo, cfg.Framework.Commit)
}

// isBoringUI checks if a directory looks like a boring-ui checkout.
func isBoringUI(dir string) bool {
	info, err := os.Stat(filepath.Join(dir, "boring.app.toml"))
	if err != nil {
		return false
	}
	return !info.IsDir()
}

func findAncestorFramework(start string) string {
	dir := filepath.Dir(start)
	for dir != "" && dir != filepath.Dir(dir) {
		if isFrameworkRoot(dir) {
			return dir
		}
		dir = filepath.Dir(dir)
	}
	return ""
}

func isFrameworkRoot(dir string) bool {
	if !isBoringUI(dir) {
		return false
	}
	if info, err := os.Stat(filepath.Join(dir, "src", "front")); err == nil && info.IsDir() {
		return true
	}
	if info, err := os.Stat(filepath.Join(dir, "cmd", "server")); err == nil && info.IsDir() {
		return true
	}
	return false
}

// checkDrift warns if local HEAD differs from pinned commit.
func checkDrift(localPath, pinnedCommit string) {
	if pinnedCommit == "" {
		return
	}
	head := gitHead(localPath)
	if head == "" {
		return
	}
	// Compare short hashes
	pinShort := pinnedCommit
	if len(pinShort) > 7 {
		pinShort = pinShort[:7]
	}
	headShort := head
	if len(headShort) > 7 {
		headShort = headShort[:7]
	}
	if !strings.HasPrefix(head, pinnedCommit) && !strings.HasPrefix(pinnedCommit, head) {
		fmt.Printf("[bui] warn: ../boring-ui HEAD is %s, config pins %s\n", headShort, pinShort)
	}
}

func gitHead(dir string) string {
	cmd := exec.Command("git", "rev-parse", "HEAD")
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// FetchToCache clones or fetches boring-ui to ~/.bui/cache/<commit>.
func FetchToCache(repo, commit string) (string, error) {
	if commit == "" {
		return "", fmt.Errorf("no [framework].commit set and no local boring-ui found")
	}

	home, _ := os.UserHomeDir()
	cacheDir := filepath.Join(home, ".bui", "cache", commit)

	if isBoringUI(cacheDir) {
		return cacheDir, nil
	}

	// Normalize repo URL
	repoURL := repo
	if !strings.HasPrefix(repoURL, "https://") && !strings.HasPrefix(repoURL, "git@") {
		repoURL = "https://" + repoURL + ".git"
	}

	fmt.Printf("[bui] fetching boring-ui@%s...\n", commit[:min(7, len(commit))])
	if err := os.MkdirAll(filepath.Dir(cacheDir), 0o755); err != nil {
		return "", err
	}

	// Clone to temp dir then rename atomically to avoid races
	tmpDir := cacheDir + ".tmp." + fmt.Sprintf("%d", os.Getpid())
	os.RemoveAll(tmpDir) // clean up any previous failed attempt

	clone := exec.Command("git", "clone", "--depth", "1", repoURL, tmpDir)
	clone.Stdout = os.Stdout
	clone.Stderr = os.Stderr
	if err := clone.Run(); err != nil {
		os.RemoveAll(tmpDir)
		return "", fmt.Errorf("git clone: %w", err)
	}

	checkout := exec.Command("git", "fetch", "origin", commit, "--depth", "1")
	checkout.Dir = tmpDir
	if err := checkout.Run(); err == nil {
		reset := exec.Command("git", "checkout", commit)
		reset.Dir = tmpDir
		_ = reset.Run()
	}

	// Atomic move — if another process won the race, use their result
	if err := os.Rename(tmpDir, cacheDir); err != nil {
		os.RemoveAll(tmpDir)
		if isBoringUI(cacheDir) {
			return cacheDir, nil // another process created it
		}
		return "", fmt.Errorf("cache rename: %w", err)
	}

	return cacheDir, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// LinkFrontend creates a symlink in node_modules/boring-ui pointing to the framework.
func LinkFrontend(frameworkPath, childAppPath string) error {
	nodeModules := filepath.Join(childAppPath, "node_modules")
	if err := os.MkdirAll(nodeModules, 0o755); err != nil {
		return err
	}

	link := filepath.Join(nodeModules, "boring-ui")

	// Remove existing (symlink or dir)
	os.Remove(link)
	os.RemoveAll(link)

	absFramework, err := filepath.Abs(frameworkPath)
	if err != nil {
		return err
	}

	if err := os.Symlink(absFramework, link); err != nil {
		return fmt.Errorf("symlink %s → %s: %w", link, absFramework, err)
	}

	fmt.Printf("[bui] linked node_modules/boring-ui → %s\n", absFramework)
	return nil
}
