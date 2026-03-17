package git

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func createAskpassScript(tempDir string, credentials *GitCredentials) (string, error) {
	if credentials == nil {
		return "", nil
	}

	dir := tempDir
	if strings.TrimSpace(dir) == "" {
		dir = os.TempDir()
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}

	file, err := os.CreateTemp(dir, "git-askpass-*.sh")
	if err != nil {
		return "", err
	}
	path := file.Name()
	if err := file.Close(); err != nil {
		_ = os.Remove(path)
		return "", err
	}

	content := fmt.Sprintf(
		"#!/bin/sh\ncase \"$1\" in\n  *sername*) printf '%%s\\n' %s ;;\n  *) printf '%%s\\n' %s ;;\nesac\n",
		shellQuote(credentials.Username),
		shellQuote(credentials.Password),
	)
	if err := os.WriteFile(path, []byte(content), 0o700); err != nil {
		_ = os.Remove(path)
		return "", err
	}
	if err := os.Chmod(path, 0o700); err != nil {
		_ = os.Remove(path)
		return "", err
	}
	return filepath.Clean(path), nil
}

func cleanupAskpass(path string) {
	if strings.TrimSpace(path) == "" {
		return
	}
	_ = os.Remove(path)
}

func shellQuote(value string) string {
	if value == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}
