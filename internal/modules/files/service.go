package files

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/boringdata/boring-ui/internal/app"
	"github.com/boringdata/boring-ui/internal/config"
	"github.com/boringdata/boring-ui/internal/storage"
)

const (
	searchTimeout       = 10 * time.Second
	maxConcurrentSearch = 3
)

type Service struct {
	root        string
	storage     storage.Storage
	searchSlots chan struct{}
}

func NewService(cfg config.Config, store storage.Storage) (*Service, error) {
	root, err := workspaceRoot(cfg)
	if err != nil {
		return nil, err
	}
	return &Service{
		root:        root,
		storage:     store,
		searchSlots: make(chan struct{}, maxConcurrentSearch),
	}, nil
}

func (s *Service) List(path string) (map[string]any, error) {
	displayPath, relPath, _, err := s.validatePath(path, ".")
	if err != nil {
		return nil, err
	}
	entries, err := s.storage.ListDir(relPath)
	if err != nil {
		return nil, s.mapStorageError(err, displayPath)
	}
	return map[string]any{
		"entries": entries,
		"path":    displayPath,
	}, nil
}

func (s *Service) Read(path string) (map[string]any, error) {
	displayPath, relPath, _, err := s.validatePath(path, "")
	if err != nil {
		return nil, err
	}
	data, err := s.storage.ReadFile(relPath)
	if err != nil {
		return nil, s.mapStorageError(err, displayPath)
	}
	encoding, err := s.storage.DetectEncoding(relPath)
	if err != nil {
		return nil, s.mapStorageError(err, displayPath)
	}
	content, err := decodeFileContent(data, encoding)
	if err != nil {
		return nil, app.APIError{Status: http.StatusBadRequest, Code: "unsupported_encoding", Message: err.Error()}
	}
	return map[string]any{
		"content": content,
		"path":    displayPath,
	}, nil
}

func (s *Service) Write(path string, content string) (map[string]any, error) {
	displayPath, relPath, _, err := s.validatePath(path, "")
	if err != nil {
		return nil, err
	}
	if err := s.storage.WriteFile(relPath, []byte(content)); err != nil {
		return nil, s.mapStorageError(err, displayPath)
	}
	return map[string]any{
		"success": true,
		"path":    displayPath,
	}, nil
}

func (s *Service) Delete(path string) (map[string]any, error) {
	displayPath, relPath, _, err := s.validatePath(path, "")
	if err != nil {
		return nil, err
	}
	if err := s.storage.DeleteFile(relPath); err != nil {
		return nil, s.mapStorageError(err, displayPath)
	}
	return map[string]any{
		"success": true,
		"path":    displayPath,
	}, nil
}

func (s *Service) Mkdir(path string) (map[string]any, error) {
	displayPath, _, absPath, err := s.validatePath(path, "")
	if err != nil {
		return nil, err
	}
	if err := s.rejectSymlinkPath(absPath, true); err != nil {
		return nil, s.mapStorageError(err, displayPath)
	}
	if err := os.MkdirAll(absPath, 0o755); err != nil {
		return nil, app.APIError{Status: http.StatusInternalServerError, Code: "mkdir_failed", Message: err.Error()}
	}
	return map[string]any{
		"success": true,
		"path":    displayPath,
	}, nil
}

func (s *Service) Rename(oldPath string, newPath string) (map[string]any, error) {
	oldDisplay, _, oldAbs, err := s.validatePath(oldPath, "")
	if err != nil {
		return nil, err
	}
	newDisplay, _, newAbs, err := s.validatePath(newPath, "")
	if err != nil {
		return nil, err
	}
	if err := s.rejectSymlinkPath(oldAbs, false); err != nil {
		return nil, s.mapStorageError(err, oldDisplay)
	}
	if err := s.rejectSymlinkPath(newAbs, true); err != nil {
		return nil, s.mapStorageError(err, newDisplay)
	}
	if _, err := os.Stat(oldAbs); err != nil {
		return nil, s.mapStorageError(err, oldDisplay)
	}
	if _, err := os.Stat(newAbs); err == nil {
		return nil, app.APIError{Status: http.StatusConflict, Code: "target_exists", Message: fmt.Sprintf("target exists: %s", newDisplay)}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, app.APIError{Status: http.StatusInternalServerError, Code: "stat_failed", Message: err.Error()}
	}
	if err := os.MkdirAll(filepath.Dir(newAbs), 0o755); err != nil {
		return nil, app.APIError{Status: http.StatusInternalServerError, Code: "mkdir_failed", Message: err.Error()}
	}
	if err := os.Rename(oldAbs, newAbs); err != nil {
		return nil, app.APIError{Status: http.StatusInternalServerError, Code: "rename_failed", Message: err.Error()}
	}
	return map[string]any{
		"success":  true,
		"old_path": oldDisplay,
		"new_path": newDisplay,
	}, nil
}

func (s *Service) Move(srcPath string, destDir string) (map[string]any, error) {
	srcDisplay, _, srcAbs, err := s.validatePath(srcPath, "")
	if err != nil {
		return nil, err
	}
	destDisplay, _, destAbs, err := s.validatePath(destDir, "")
	if err != nil {
		return nil, err
	}
	if err := s.rejectSymlinkPath(srcAbs, false); err != nil {
		return nil, s.mapStorageError(err, srcDisplay)
	}
	if err := s.rejectSymlinkPath(destAbs, false); err != nil {
		return nil, s.mapStorageError(err, destDisplay)
	}
	if _, err := os.Stat(srcAbs); err != nil {
		return nil, s.mapStorageError(err, srcDisplay)
	}
	destInfo, err := os.Stat(destAbs)
	if err != nil {
		return nil, s.mapStorageError(err, destDisplay)
	}
	if !destInfo.IsDir() {
		return nil, app.APIError{Status: http.StatusBadRequest, Code: "not_directory", Message: fmt.Sprintf("destination is not a directory: %s", destDisplay)}
	}

	targetAbs := filepath.Join(destAbs, filepath.Base(srcAbs))
	targetRel, err := filepath.Rel(s.root, targetAbs)
	if err != nil {
		return nil, app.APIError{Status: http.StatusInternalServerError, Code: "path_error", Message: err.Error()}
	}
	targetPath := filepath.ToSlash(targetRel)
	if _, err := os.Stat(targetAbs); err == nil {
		return nil, app.APIError{Status: http.StatusConflict, Code: "target_exists", Message: fmt.Sprintf("destination exists: %s", targetPath)}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, app.APIError{Status: http.StatusInternalServerError, Code: "stat_failed", Message: err.Error()}
	}

	if err := os.Rename(srcAbs, targetAbs); err != nil {
		return nil, app.APIError{Status: http.StatusInternalServerError, Code: "move_failed", Message: err.Error()}
	}
	return map[string]any{
		"success":   true,
		"old_path":  srcDisplay,
		"dest_path": targetPath,
	}, nil
}

func (s *Service) Search(ctx context.Context, query string, path string) (map[string]any, error) {
	displayPath, relPath, absPath, err := s.validatePath(path, ".")
	if err != nil {
		return nil, err
	}
	pattern := strings.TrimSpace(query)
	if pattern == "" {
		return nil, app.APIError{Status: http.StatusBadRequest, Code: "invalid_query", Message: "search query is required"}
	}
	if err := s.rejectSymlinkPath(absPath, false); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return map[string]any{
				"results": []map[string]string{},
				"pattern": pattern,
				"path":    displayPath,
			}, nil
		}
		return nil, s.mapStorageError(err, displayPath)
	}
	if _, err := os.Stat(absPath); errors.Is(err, os.ErrNotExist) {
		return map[string]any{
			"results": []map[string]string{},
			"pattern": pattern,
			"path":    displayPath,
		}, nil
	} else if err != nil {
		return nil, app.APIError{Status: http.StatusInternalServerError, Code: "stat_failed", Message: err.Error()}
	}

	if err := s.acquireSearchSlot(ctx); err != nil {
		return nil, err
	}
	defer func() {
		<-s.searchSlots
	}()

	searchCtx, cancel := context.WithTimeout(ctx, searchTimeout)
	defer cancel()

	cmd := exec.CommandContext(
		searchCtx,
		"rg",
		"--files",
		"--hidden",
		"--no-ignore",
		"--glob-case-insensitive",
		"-g",
		pattern,
		".",
	)
	cmd.Dir = absPath

	output, err := cmd.Output()
	if err != nil {
		if searchCtx.Err() == context.DeadlineExceeded {
			return nil, app.APIError{Status: http.StatusGatewayTimeout, Code: "search_timeout", Message: "ripgrep search timed out"}
		}
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) && exitErr.ExitCode() == 1 {
			output = nil
		} else {
			return nil, app.APIError{Status: http.StatusInternalServerError, Code: "search_failed", Message: err.Error()}
		}
	}

	results := parseSearchResults(relPath, output)
	return map[string]any{
		"results": results,
		"pattern": pattern,
		"path":    displayPath,
	}, nil
}

func (s *Service) acquireSearchSlot(ctx context.Context) error {
	select {
	case s.searchSlots <- struct{}{}:
		return nil
	case <-ctx.Done():
		return app.APIError{Status: http.StatusServiceUnavailable, Code: "search_unavailable", Message: "search request cancelled"}
	}
}

func (s *Service) validatePath(raw string, defaultPath string) (displayPath string, relPath string, absPath string, err error) {
	displayPath = strings.TrimSpace(raw)
	if displayPath == "" {
		displayPath = defaultPath
	}
	cleaned := filepath.Clean(displayPath)
	absPath = filepath.Join(s.root, cleaned)

	relPath, err = filepath.Rel(s.root, absPath)
	if err != nil {
		return "", "", "", app.APIError{Status: http.StatusInternalServerError, Code: "path_error", Message: err.Error()}
	}
	if relPath == ".." || strings.HasPrefix(relPath, ".."+string(os.PathSeparator)) {
		return "", "", "", app.APIError{Status: http.StatusForbidden, Code: "path_forbidden", Message: "path escapes workspace root"}
	}

	return displayPath, filepath.ToSlash(relPath), absPath, nil
}

func (s *Service) mapStorageError(err error, path string) error {
	switch {
	case errors.Is(err, storage.ErrOutsideRoot), errors.Is(err, storage.ErrDeleteRoot):
		return app.APIError{Status: http.StatusForbidden, Code: "path_forbidden", Message: "path escapes workspace root"}
	case errors.Is(err, os.ErrNotExist):
		return app.APIError{Status: http.StatusNotFound, Code: "not_found", Message: fmt.Sprintf("path not found: %s", path)}
	default:
		return app.APIError{Status: http.StatusInternalServerError, Code: "storage_error", Message: err.Error()}
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

func (s *Service) rejectSymlinkPath(candidate string, allowMissingLeaf bool) error {
	relative, err := filepath.Rel(s.root, candidate)
	if err != nil {
		return err
	}
	if relative == "." {
		return nil
	}

	current := s.root
	for _, part := range strings.Split(relative, string(os.PathSeparator)) {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) && allowMissingLeaf {
				return nil
			}
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return storage.ErrOutsideRoot
		}
	}

	return nil
}

func parseSearchResults(base string, output []byte) []map[string]string {
	lines := bytes.Split(bytes.TrimSpace(output), []byte{'\n'})
	results := make([]map[string]string, 0, len(lines))
	for _, line := range lines {
		if len(line) == 0 {
			continue
		}
		joined := filepath.Clean(filepath.Join(base, string(line)))
		joined = strings.TrimPrefix(joined, "."+string(os.PathSeparator))
		path := filepath.ToSlash(joined)
		dir := filepath.ToSlash(filepath.Dir(path))
		if dir == "." {
			dir = ""
		}
		results = append(results, map[string]string{
			"name": filepath.Base(path),
			"path": path,
			"dir":  dir,
		})
	}
	sort.Slice(results, func(i, j int) bool {
		return results[i]["path"] < results[j]["path"]
	})
	return results
}

func decodeFileContent(data []byte, encoding storage.Encoding) (string, error) {
	switch encoding {
	case storage.EncodingUTF8:
		return string(data), nil
	case storage.EncodingUTF16LE:
		return decodeUTF16(data, binary.LittleEndian)
	case storage.EncodingUTF16BE:
		return decodeUTF16(data, binary.BigEndian)
	case storage.EncodingBinary:
		return "", fmt.Errorf("binary files are not supported")
	default:
		return "", fmt.Errorf("unsupported encoding: %s", encoding)
	}
}

func decodeUTF16(data []byte, order binary.ByteOrder) (string, error) {
	if len(data)%2 != 0 {
		return "", fmt.Errorf("invalid utf-16 byte length")
	}
	if len(data) >= 2 {
		if bytes.HasPrefix(data, []byte{0xFF, 0xFE}) || bytes.HasPrefix(data, []byte{0xFE, 0xFF}) {
			data = data[2:]
		}
	}
	words := make([]uint16, 0, len(data)/2)
	for i := 0; i < len(data); i += 2 {
		words = append(words, order.Uint16(data[i:i+2]))
	}
	return string(utf16.Decode(words)), nil
}
