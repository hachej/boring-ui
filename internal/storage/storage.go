package storage

import "errors"

// ErrOutsideRoot is returned when a relative path escapes the configured root.
var ErrOutsideRoot = errors.New("storage path escapes workspace root")

// ErrDeleteRoot is returned when a delete targets the storage root itself.
var ErrDeleteRoot = errors.New("refusing to delete storage root")

type Encoding string

const (
	EncodingUTF8    Encoding = "utf-8"
	EncodingUTF16LE Encoding = "utf-16le"
	EncodingUTF16BE Encoding = "utf-16be"
	EncodingBinary  Encoding = "binary"
)

// Entry describes a file or directory relative to the storage root.
type Entry struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"is_dir"`
	Size  int64  `json:"size,omitempty"`
}

// Storage defines the minimal filesystem surface used by the Go backend.
type Storage interface {
	ReadFile(path string) ([]byte, error)
	WriteFile(path string, data []byte) error
	// DeleteFile removes a file or directory subtree relative to the storage root.
	DeleteFile(path string) error
	Stat(path string) (Entry, error)
	ListDir(path string) ([]Entry, error)
	DetectEncoding(path string) (Encoding, error)
}
