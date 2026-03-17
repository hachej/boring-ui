package storage

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestLocalReadWriteRoundTrip(t *testing.T) {
	t.Parallel()

	store := newTestLocal(t)

	if err := store.WriteFile("nested/note.txt", []byte("hello")); err != nil {
		t.Fatalf("write file: %v", err)
	}

	got, err := store.ReadFile("nested/note.txt")
	if err != nil {
		t.Fatalf("read file: %v", err)
	}
	if string(got) != "hello" {
		t.Fatalf("unexpected content: got %q want %q", string(got), "hello")
	}
}

func TestLocalPathEscapeRejected(t *testing.T) {
	t.Parallel()

	store := newTestLocal(t)

	_, err := store.ReadFile("../outside.txt")
	if !errors.Is(err, ErrOutsideRoot) {
		t.Fatalf("expected ErrOutsideRoot, got %v", err)
	}

	err = store.WriteFile("../../escape.txt", []byte("bad"))
	if !errors.Is(err, ErrOutsideRoot) {
		t.Fatalf("expected ErrOutsideRoot on write, got %v", err)
	}
}

func TestLocalDeleteRejectsRoot(t *testing.T) {
	t.Parallel()

	store := newTestLocal(t)

	tests := []string{"", ".", "nested/.."}
	for _, path := range tests {
		t.Run(path, func(t *testing.T) {
			err := store.DeleteFile(path)
			if !errors.Is(err, ErrDeleteRoot) {
				t.Fatalf("expected ErrDeleteRoot for %q, got %v", path, err)
			}
		})
	}
}

func TestLocalListDirAndStat(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	store := mustNewLocal(t, root)

	if err := os.Mkdir(filepath.Join(root, "subdir"), 0o755); err != nil {
		t.Fatalf("mkdir subdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "b.txt"), []byte("bbb"), 0o644); err != nil {
		t.Fatalf("write b.txt: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "A.txt"), []byte("aaaa"), 0o644); err != nil {
		t.Fatalf("write A.txt: %v", err)
	}

	entries, err := store.ListDir(".")
	if err != nil {
		t.Fatalf("list dir: %v", err)
	}
	if len(entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(entries))
	}
	if entries[0].Name != "subdir" || !entries[0].IsDir {
		t.Fatalf("expected directory-first ordering, got %+v", entries[0])
	}
	if entries[1].Name != "A.txt" || entries[2].Name != "b.txt" {
		t.Fatalf("expected case-insensitive file ordering, got %+v", entries)
	}

	stat, err := store.Stat("A.txt")
	if err != nil {
		t.Fatalf("stat file: %v", err)
	}
	if stat.Path != "A.txt" || stat.Size != 4 || stat.IsDir {
		t.Fatalf("unexpected stat result: %+v", stat)
	}
}

func TestLocalRejectsSymlinkEscapes(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	outside := t.TempDir()
	store := mustNewLocal(t, root)

	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("secret"), 0o644); err != nil {
		t.Fatalf("write outside file: %v", err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Fatalf("create symlink: %v", err)
	}

	tests := []struct {
		name string
		run  func() error
	}{
		{name: "read", run: func() error {
			_, err := store.ReadFile("escape/secret.txt")
			return err
		}},
		{name: "write", run: func() error {
			return store.WriteFile("escape/created.txt", []byte("blocked"))
		}},
		{name: "delete", run: func() error {
			return store.DeleteFile("escape/secret.txt")
		}},
		{name: "stat", run: func() error {
			_, err := store.Stat("escape/secret.txt")
			return err
		}},
		{name: "list", run: func() error {
			_, err := store.ListDir("escape")
			return err
		}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.run()
			if !errors.Is(err, ErrOutsideRoot) {
				t.Fatalf("expected ErrOutsideRoot, got %v", err)
			}
		})
	}

	if _, err := os.Stat(filepath.Join(outside, "secret.txt")); err != nil {
		t.Fatalf("outside file should remain untouched: %v", err)
	}
}

func TestLocalDetectEncodingSamples(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	store := mustNewLocal(t, root)

	samples := map[string][]byte{
		"utf8.txt":    []byte("hello"),
		"utf16le.txt": {0xFF, 0xFE, 'h', 0x00, 'i', 0x00},
		"utf16be.txt": {0xFE, 0xFF, 0x00, 'h', 0x00, 'i'},
		"binary.bin":  {0x00, 0xFF, 0x10, 0x81},
	}
	for name, data := range samples {
		if err := os.WriteFile(filepath.Join(root, name), data, 0o644); err != nil {
			t.Fatalf("write sample %s: %v", name, err)
		}
	}

	tests := []struct {
		path string
		want Encoding
	}{
		{path: "utf8.txt", want: EncodingUTF8},
		{path: "utf16le.txt", want: EncodingUTF16LE},
		{path: "utf16be.txt", want: EncodingUTF16BE},
		{path: "binary.bin", want: EncodingBinary},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			got, err := store.DetectEncoding(tt.path)
			if err != nil {
				t.Fatalf("detect encoding: %v", err)
			}
			if got != tt.want {
				t.Fatalf("unexpected encoding for %s: got %s want %s", tt.path, got, tt.want)
			}
		})
	}
}

func newTestLocal(t *testing.T) *Local {
	t.Helper()
	return mustNewLocal(t, t.TempDir())
}

func mustNewLocal(t *testing.T, root string) *Local {
	t.Helper()
	store, err := NewLocal(root)
	if err != nil {
		t.Fatalf("new local storage: %v", err)
	}
	return store
}
