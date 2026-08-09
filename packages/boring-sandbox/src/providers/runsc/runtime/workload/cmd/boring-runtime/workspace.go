package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"os"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

type helperFailure struct {
	OK     bool   `json:"ok"`
	Code   string `json:"code"`
	Reason string `json:"reason,omitempty"`
}

type openHow struct {
	Flags   uint64
	Mode    uint64
	Resolve uint64
}

type statResult struct {
	Size    int64  `json:"size"`
	MtimeMs int64  `json:"mtimeMs"`
	Kind    string `json:"kind"`
}

type workspaceOperation struct {
	Op         string `json:"op"`
	Path       string `json:"path,omitempty"`
	From       string `json:"from,omitempty"`
	To         string `json:"to,omitempty"`
	Data       string `json:"data,omitempty"`
	DataBase64 string `json:"dataBase64,omitempty"`
	Recursive  bool   `json:"recursive,omitempty"`
}

type workspaceEntry struct {
	Name string `json:"name"`
	Kind string `json:"kind"`
}

func workspaceMain() {
	request, err := readBounded(os.Stdin, maxWorkspaceEnvelopeBytes)
	if err != nil {
		writeHelperFailure(codePathUnsafe)
		return
	}
	defer zero(request)
	var operation workspaceOperation
	if err := decodeStrictJSON(request, &operation); err != nil {
		writeHelperFailure(codePathUnsafe)
		return
	}
	rootFD, err := syscall.Open(workspaceRoot, oPath|syscall.O_DIRECTORY|syscall.O_CLOEXEC|syscall.O_NOFOLLOW, 0)
	if err != nil {
		writeHelperFailure(codePathUnsafe)
		return
	}
	defer syscall.Close(rootFD)
	if operation.Op == "probe" {
		probeFD, probeErr := openat2(rootFD, ".", oPath|syscall.O_DIRECTORY|syscall.O_CLOEXEC, 0)
		if probeErr != nil {
			writeProbeFailure(probeErr)
			return
		}
		syscall.Close(probeFD)
		_ = json.NewEncoder(os.Stdout).Encode(map[string]bool{"openat2": true})
		return
	}
	result, resultErr := executeWorkspaceOperation(rootFD, operation)
	if resultErr != nil {
		writeHelperFailure(workspaceErrorCode(resultErr))
		return
	}
	_ = json.NewEncoder(os.Stdout).Encode(result)
}

func executeWorkspaceOperation(rootFD int, operation workspaceOperation) (any, error) {
	switch operation.Op {
	case "readFile", "readBinaryFile", "readFileWithStat":
		fd, err := openWorkspacePath(rootFD, operation.Path, syscall.O_RDONLY|syscall.O_CLOEXEC, 0)
		if err != nil {
			return nil, err
		}
		file := os.NewFile(uintptr(fd), "workspace-entry")
		defer file.Close()
		maximum := maxTextTransferBytes
		if operation.Op == "readBinaryFile" {
			maximum = maxBinaryTransferBytes
		}
		content, err := readFileBounded(file, maximum)
		if err != nil {
			return nil, err
		}
		if operation.Op == "readBinaryFile" {
			return map[string]string{"dataBase64": base64.StdEncoding.EncodeToString(content)}, nil
		}
		if operation.Op == "readFileWithStat" {
			stat, err := file.Stat()
			if err != nil {
				return nil, err
			}
			return map[string]any{"content": string(content), "stat": fileStat(stat)}, nil
		}
		return map[string]string{"content": string(content)}, nil
	case "writeFile", "writeBinaryFile", "writeFileWithStat", "writeBinaryFileWithStat":
		content := []byte(operation.Data)
		maximum := maxTextTransferBytes
		if operation.Op == "writeBinaryFile" || operation.Op == "writeBinaryFileWithStat" {
			var err error
			content, err = base64.StdEncoding.DecodeString(operation.DataBase64)
			if err != nil {
				return nil, syscall.EINVAL
			}
			maximum = maxBinaryTransferBytes
		}
		defer zero(content)
		if len(content) > maximum {
			return nil, syscall.EFBIG
		}
		fd, err := openWorkspacePath(rootFD, operation.Path, syscall.O_WRONLY|syscall.O_CREAT|syscall.O_TRUNC|syscall.O_CLOEXEC, 0o660)
		if err != nil {
			return nil, err
		}
		file := os.NewFile(uintptr(fd), "workspace-entry")
		if _, err := file.Write(content); err != nil {
			file.Close()
			return nil, err
		}
		if err := file.Sync(); err != nil {
			file.Close()
			return nil, err
		}
		stat, statErr := file.Stat()
		closeErr := file.Close()
		if statErr != nil {
			return nil, statErr
		}
		if closeErr != nil {
			return nil, closeErr
		}
		if strings.Contains(operation.Op, "WithStat") {
			return map[string]any{"stat": fileStat(stat)}, nil
		}
		return map[string]bool{"ok": true}, nil
	case "stat":
		fd, err := openWorkspacePath(rootFD, operation.Path, oPath|syscall.O_CLOEXEC, 0)
		if err != nil {
			return nil, err
		}
		defer syscall.Close(fd)
		var stat syscall.Stat_t
		if err := syscall.Fstat(fd, &stat); err != nil {
			return nil, err
		}
		return map[string]any{"stat": syscallStat(stat)}, nil
	case "readdir":
		fd, err := openWorkspacePath(rootFD, operation.Path, syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_CLOEXEC, 0)
		if err != nil {
			return nil, err
		}
		file := os.NewFile(uintptr(fd), "workspace-directory")
		defer file.Close()
		entries, err := file.ReadDir(100001)
		if err != nil {
			return nil, err
		}
		if len(entries) > 100000 {
			return nil, syscall.E2BIG
		}
		result := make([]workspaceEntry, 0, len(entries))
		for _, entry := range entries {
			info, err := entry.Info()
			if err != nil || info.Mode()&os.ModeSymlink != 0 {
				return nil, syscall.ELOOP
			}
			kind := "file"
			if info.IsDir() {
				kind = "dir"
			} else if !info.Mode().IsRegular() {
				return nil, syscall.EPERM
			}
			result = append(result, workspaceEntry{Name: entry.Name(), Kind: kind})
		}
		return map[string]any{"entries": result}, nil
	case "mkdir":
		if operation.Recursive {
			if err := mkdirAllAt(rootFD, operation.Path); err != nil {
				return nil, err
			}
		} else {
			parentFD, name, err := openParent(rootFD, operation.Path)
			if err != nil {
				return nil, err
			}
			defer syscall.Close(parentFD)
			if err := syscall.Mkdirat(parentFD, name, 0o770); err != nil {
				return nil, err
			}
		}
		return map[string]bool{"ok": true}, nil
	case "unlink":
		parentFD, name, err := openParent(rootFD, operation.Path)
		if err != nil {
			return nil, err
		}
		defer syscall.Close(parentFD)
		endpointFD, err := openat2(parentFD, name, oPath|syscall.O_CLOEXEC, 0)
		if err != nil {
			return nil, err
		}
		var stat syscall.Stat_t
		if err := syscall.Fstat(endpointFD, &stat); err != nil {
			syscall.Close(endpointFD)
			return nil, err
		}
		syscall.Close(endpointFD)
		flags := 0
		if stat.Mode&syscall.S_IFMT == syscall.S_IFDIR {
			flags = atRemoveDir
		}
		if err := unlinkat(parentFD, name, flags); err != nil {
			return nil, err
		}
		return map[string]bool{"ok": true}, nil
	case "rename":
		fromParent, fromName, err := openParent(rootFD, operation.From)
		if err != nil {
			return nil, err
		}
		defer syscall.Close(fromParent)
		toParent, toName, err := openParent(rootFD, operation.To)
		if err != nil {
			return nil, err
		}
		defer syscall.Close(toParent)
		fromEndpoint, err := openat2(fromParent, fromName, oPath|syscall.O_CLOEXEC, 0)
		if err != nil {
			return nil, err
		}
		syscall.Close(fromEndpoint)
		if toEndpoint, toErr := openat2(toParent, toName, oPath|syscall.O_CLOEXEC, 0); toErr == nil {
			syscall.Close(toEndpoint)
		} else if !errors.Is(toErr, syscall.ENOENT) {
			return nil, toErr
		}
		if err := syscall.Renameat(fromParent, fromName, toParent, toName); err != nil {
			return nil, err
		}
		return map[string]bool{"ok": true}, nil
	default:
		return nil, syscall.EINVAL
	}
}

func openWorkspacePath(rootFD int, path string, flags int, mode uint32) (int, error) {
	parentFD, name, err := openParent(rootFD, path)
	if err != nil {
		return -1, err
	}
	defer syscall.Close(parentFD)
	return openat2(parentFD, name, flags, mode)
}

func openParent(rootFD int, path string) (int, string, error) {
	components, err := workspaceComponents(path)
	if err != nil || len(components) == 0 {
		return -1, "", syscall.EINVAL
	}
	current, err := syscall.Dup(rootFD)
	if err != nil {
		return -1, "", err
	}
	for _, component := range components[:len(components)-1] {
		next, openErr := openat2(current, component, oPath|syscall.O_DIRECTORY|syscall.O_CLOEXEC, 0)
		syscall.Close(current)
		if openErr != nil {
			return -1, "", openErr
		}
		current = next
	}
	return current, components[len(components)-1], nil
}

func mkdirAllAt(rootFD int, path string) error {
	components, err := workspaceComponents(path)
	if err != nil {
		return err
	}
	current, err := syscall.Dup(rootFD)
	if err != nil {
		return err
	}
	for _, component := range components {
		next, openErr := openat2(current, component, oPath|syscall.O_DIRECTORY|syscall.O_CLOEXEC, 0)
		if errors.Is(openErr, syscall.ENOENT) {
			if err := syscall.Mkdirat(current, component, 0o770); err != nil && !errors.Is(err, syscall.EEXIST) {
				syscall.Close(current)
				return err
			}
			next, openErr = openat2(current, component, oPath|syscall.O_DIRECTORY|syscall.O_CLOEXEC, 0)
		}
		if openErr != nil {
			syscall.Close(current)
			return openErr
		}
		syscall.Close(current)
		current = next
	}
	syscall.Close(current)
	return nil
}

func workspaceComponents(path string) ([]string, error) {
	if len(path) == 0 || len(path) > maxPathBytes || strings.HasPrefix(path, "/") || strings.ContainsRune(path, 0) {
		return nil, syscall.EINVAL
	}
	if path == "." {
		return []string{"."}, nil
	}
	components := strings.Split(path, "/")
	for _, component := range components {
		if component == "" || component == "." || component == ".." {
			return nil, syscall.EINVAL
		}
	}
	return components, nil
}

func openat2(directoryFD int, path string, flags int, mode uint32) (int, error) {
	pathBytes, err := syscall.BytePtrFromString(path)
	if err != nil {
		return -1, err
	}
	how := openHow{
		Flags:   uint64(flags | syscall.O_NOFOLLOW),
		Mode:    uint64(mode),
		Resolve: resolveBeneath | resolveNoMagicLinks | resolveNoSymlinks,
	}
	fd, _, errno := syscall.RawSyscall6(
		sysOpenat2,
		uintptr(directoryFD),
		uintptr(unsafe.Pointer(pathBytes)),
		uintptr(unsafe.Pointer(&how)),
		unsafe.Sizeof(how),
		0,
		0,
	)
	if errno != 0 {
		return -1, errno
	}
	return int(fd), nil
}

func unlinkat(directoryFD int, path string, flags int) error {
	pathBytes, err := syscall.BytePtrFromString(path)
	if err != nil {
		return err
	}
	_, _, errno := syscall.RawSyscall(
		syscall.SYS_UNLINKAT,
		uintptr(directoryFD),
		uintptr(unsafe.Pointer(pathBytes)),
		uintptr(flags),
	)
	if errno != 0 {
		return errno
	}
	return nil
}

func fileStat(info os.FileInfo) statResult {
	kind := "file"
	if info.IsDir() {
		kind = "dir"
	}
	return statResult{Size: info.Size(), MtimeMs: info.ModTime().UnixMilli(), Kind: kind}
}

func syscallStat(stat syscall.Stat_t) statResult {
	kind := "file"
	if stat.Mode&syscall.S_IFMT == syscall.S_IFDIR {
		kind = "dir"
	}
	mtime := time.Unix(stat.Mtim.Sec, stat.Mtim.Nsec).UnixMilli()
	return statResult{Size: stat.Size, MtimeMs: mtime, Kind: kind}
}

func workspaceErrorCode(err error) string {
	if errors.Is(err, syscall.ENOSYS) || errors.Is(err, syscall.EOPNOTSUPP) {
		return codePrimitiveUnavailable
	}
	if errors.Is(err, syscall.EDQUOT) || errors.Is(err, syscall.ENOSPC) {
		return codeQuotaExceeded
	}
	return codePathUnsafe
}

func writeHelperFailure(code string) {
	_ = json.NewEncoder(os.Stdout).Encode(helperFailure{OK: false, Code: code})
}

func writeProbeFailure(err error) {
	reason := "other"
	if errors.Is(err, syscall.ENOSYS) {
		reason = "syscall-unavailable"
	} else if errors.Is(err, syscall.EINVAL) {
		reason = "flags-unavailable"
	} else if errors.Is(err, syscall.EPERM) {
		reason = "policy-denied"
	}
	_ = json.NewEncoder(os.Stdout).Encode(helperFailure{
		OK: false, Code: codePrimitiveUnavailable, Reason: reason,
	})
}

func readFileBounded(reader io.Reader, maximum int) ([]byte, error) {
	value, err := io.ReadAll(io.LimitReader(reader, int64(maximum+1)))
	if err != nil {
		return nil, err
	}
	if len(value) > maximum {
		zero(value)
		return nil, syscall.EFBIG
	}
	return value, nil
}
