package storage

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
)

// Local implements Storage with the local filesystem scoped to a workspace root.
type Local struct {
	root string
}

func NewLocal(root string) (*Local, error) {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if realRoot, err := filepath.EvalSymlinks(absRoot); err == nil {
		absRoot = realRoot
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	return &Local{root: absRoot}, nil
}

func (l *Local) ReadFile(path string) ([]byte, error) {
	resolved, err := l.resolve(path)
	if err != nil {
		return nil, err
	}
	if err := l.rejectSymlinkPath(resolved, false); err != nil {
		return nil, err
	}
	return os.ReadFile(resolved)
}

func (l *Local) WriteFile(path string, data []byte) error {
	resolved, err := l.resolve(path)
	if err != nil {
		return err
	}
	if err := l.rejectSymlinkPath(resolved, true); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(resolved), 0o755); err != nil {
		return err
	}
	return os.WriteFile(resolved, data, 0o644)
}

func (l *Local) DeleteFile(path string) error {
	resolved, err := l.resolve(path)
	if err != nil {
		return err
	}
	if resolved == l.root {
		return ErrDeleteRoot
	}
	if err := l.rejectSymlinkPath(resolved, false); err != nil {
		return err
	}
	if _, err := os.Stat(resolved); err != nil {
		return err
	}
	return os.RemoveAll(resolved)
}

func (l *Local) Stat(path string) (Entry, error) {
	resolved, err := l.resolve(path)
	if err != nil {
		return Entry{}, err
	}
	if err := l.rejectSymlinkPath(resolved, false); err != nil {
		return Entry{}, err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return Entry{}, err
	}
	return l.entryFromInfo(resolved, info), nil
}

func (l *Local) ListDir(path string) ([]Entry, error) {
	resolved, err := l.resolve(path)
	if err != nil {
		return nil, err
	}
	if err := l.rejectSymlinkPath(resolved, false); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []Entry{}, nil
		}
		return nil, err
	}
	entries, err := os.ReadDir(resolved)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []Entry{}, nil
		}
		return nil, err
	}

	items := make([]Entry, 0, len(entries))
	for _, entry := range entries {
		absPath := filepath.Join(resolved, entry.Name())
		info, err := entry.Info()
		if err != nil {
			return nil, err
		}
		items = append(items, l.entryFromInfo(absPath, info))
	}

	sort.Slice(items, func(i, j int) bool {
		if items[i].IsDir != items[j].IsDir {
			return items[i].IsDir
		}
		return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
	})

	return items, nil
}

func (l *Local) DetectEncoding(path string) (Encoding, error) {
	data, err := l.ReadFile(path)
	if err != nil {
		return "", err
	}
	return detectEncoding(data), nil
}

func (l *Local) resolve(path string) (string, error) {
	cleaned := filepath.Clean(path)
	candidate := filepath.Join(l.root, cleaned)
	relative, err := filepath.Rel(l.root, candidate)
	if err != nil {
		return "", err
	}
	if relative == ".." || strings.HasPrefix(relative, ".."+string(os.PathSeparator)) {
		return "", ErrOutsideRoot
	}
	return candidate, nil
}

func (l *Local) rejectSymlinkPath(candidate string, allowMissingLeaf bool) error {
	relative, err := filepath.Rel(l.root, candidate)
	if err != nil {
		return err
	}
	if relative == "." {
		return nil
	}

	current := l.root
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
			return ErrOutsideRoot
		}
	}

	return nil
}

func (l *Local) entryFromInfo(absPath string, info os.FileInfo) Entry {
	relative, err := filepath.Rel(l.root, absPath)
	if err != nil {
		relative = info.Name()
	}
	entry := Entry{
		Name:  info.Name(),
		Path:  filepath.ToSlash(relative),
		IsDir: info.IsDir(),
	}
	if !info.IsDir() {
		entry.Size = info.Size()
	}
	return entry
}

func detectEncoding(data []byte) Encoding {
	if len(data) == 0 {
		return EncodingUTF8
	}
	if bytes.HasPrefix(data, []byte{0xFF, 0xFE}) {
		return EncodingUTF16LE
	}
	if bytes.HasPrefix(data, []byte{0xFE, 0xFF}) {
		return EncodingUTF16BE
	}
	if utf8.Valid(data) {
		return EncodingUTF8
	}
	if enc, ok := detectUTF16ByNullPattern(data); ok {
		return enc
	}
	return EncodingBinary
}

func detectUTF16ByNullPattern(data []byte) (Encoding, bool) {
	if len(data) < 4 {
		return "", false
	}

	var evenNulls int
	var oddNulls int
	for i, b := range data {
		if b != 0 {
			continue
		}
		if i%2 == 0 {
			evenNulls++
		} else {
			oddNulls++
		}
	}

	pairs := len(data) / 2
	if pairs == 0 {
		return "", false
	}

	evenRatio := float64(evenNulls) / float64(pairs)
	oddRatio := float64(oddNulls) / float64(pairs)

	switch {
	case oddRatio >= 0.4 && evenRatio <= 0.1 && mostlyTextBytes(data, 0):
		return EncodingUTF16LE, true
	case evenRatio >= 0.4 && oddRatio <= 0.1 && mostlyTextBytes(data, 1):
		return EncodingUTF16BE, true
	default:
		return "", false
	}
}

func mostlyTextBytes(data []byte, offset int) bool {
	var total int
	var printable int

	for i := offset; i < len(data); i += 2 {
		b := data[i]
		if b == 0 {
			continue
		}
		total++
		if b == '\n' || b == '\r' || b == '\t' || (b >= 0x20 && b <= 0x7E) {
			printable++
		}
	}

	if total == 0 {
		return false
	}

	return float64(printable)/float64(total) >= 0.7
}
