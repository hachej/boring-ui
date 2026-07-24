package main

import (
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"os"
	"strings"
	"syscall"
	"unsafe"
)

const (
	fixedProfileID  = "fixed-1gib-100k-v1"
	workspaceBytes  = uint64(1024 * 1024 * 1024)
	workspaceInodes = uint64(100000)
	quotaBlockBytes = uint64(1024)

	exitInvalid       = 64
	exitUnavailable   = 69
	exitQuotaExceeded = 73

	sysOpenat2    = 437
	sysQuotactlFD = 443
	oPath         = 0x200000

	resolveNoMagicLinks = 0x02
	resolveNoSymlinks   = 0x04
	resolveBeneath      = 0x08
	resolveNoXDev       = 0x01

	maxWorkspaceTreeEntries = 100000
	maxWorkspaceTreeDepth   = 256

	fsIOCFSGetXAttr    = 0x801c581f
	fsIOCFSSetXAttr    = 0x401c5820
	fsXFlagProjInherit = 0x00000200

	projectQuota = 2
	qGetQuota    = 0x800007
	qSetQuota    = 0x800008
	qIfBLimits   = 1
	qIfILimits   = 4
)

type openHow struct {
	Flags   uint64
	Mode    uint64
	Resolve uint64
}

type fsXAttr struct {
	XFlags     uint32
	ExtSize    uint32
	Nextents   uint32
	ProjectID  uint32
	CowExtSize uint32
	Pad        [8]byte
}

type ifDQBlk struct {
	BHardLimit uint64
	BSoftLimit uint64
	CurSpace   uint64
	IHardLimit uint64
	ISoftLimit uint64
	CurInodes  uint64
	BTime      uint64
	ITime      uint64
	Valid      uint32
	Padding    uint32
}

type projectAttributeAccess struct {
	get func(int) (fsXAttr, error)
	set func(int, *fsXAttr) error
}

type inodeKey struct {
	device uint64
	inode  uint64
}

func main() {
	if os.Geteuid() != 0 || len(os.Args) != 4 || os.Args[3] != fixedProfileID {
		os.Exit(exitInvalid)
	}
	operation := os.Args[1]
	workspaceID := strings.ToLower(os.Args[2])
	if (operation != "apply" && operation != "check") || !validWorkspaceID(workspaceID) {
		os.Exit(exitInvalid)
	}
	root := os.Getenv("BORING_WORKSPACE_ROOT")
	if len(root) < 2 || len(root) > 4096 || root[0] != '/' || strings.ContainsRune(root, 0) {
		os.Exit(exitInvalid)
	}
	rootFD, err := syscall.Open(root, oPath|syscall.O_DIRECTORY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
	if err != nil {
		os.Exit(exitUnavailable)
	}
	defer syscall.Close(rootFD)
	workspaceFD, err := openat2(rootFD, workspaceID, syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_CLOEXEC)
	if err != nil {
		os.Exit(exitUnavailable)
	}
	defer syscall.Close(workspaceFD)

	attribute, err := getProjectAttribute(workspaceFD)
	if err != nil {
		os.Exit(exitUnavailable)
	}
	projectID := attribute.ProjectID
	if operation == "apply" {
		lockFD, err := syscall.Openat(rootFD, ".boring-quota.lock", syscall.O_RDWR|syscall.O_CREAT|syscall.O_CLOEXEC|syscall.O_NOFOLLOW, 0o600)
		if err != nil || syscall.Flock(lockFD, syscall.LOCK_EX) != nil {
			if lockFD >= 0 {
				syscall.Close(lockFD)
			}
			os.Exit(exitUnavailable)
		}
		defer syscall.Close(lockFD)
		attribute, err = getProjectAttribute(workspaceFD)
		if err != nil {
			os.Exit(exitUnavailable)
		}
		wasAssigned := attribute.ProjectID != 0 && attribute.XFlags&fsXFlagProjInherit != 0
		var assignedProjects int
		projectID, assignedProjects, err = assignProjectID(rootFD, workspaceID, attribute)
		if err != nil {
			os.Exit(exitUnavailable)
		}
		if !hostReserveAllowsAssignment(rootFD, assignedProjects, !wasAssigned) {
			os.Exit(exitQuotaExceeded)
		}
		quota := fixedQuota()
		if err := quotactlFD(rootFD, qSetQuota, projectID, &quota); err != nil {
			os.Exit(exitUnavailable)
		}
		if err := applyProjectTree(workspaceFD, projectID, ioctlProjectAttributes()); err != nil {
			if errors.Is(err, syscall.EDQUOT) || errors.Is(err, syscall.ENOSPC) {
				os.Exit(exitQuotaExceeded)
			}
			os.Exit(exitUnavailable)
		}
		attribute, err = getProjectAttribute(workspaceFD)
		if err != nil {
			os.Exit(exitUnavailable)
		}
	}
	if projectID == 0 || attribute.XFlags&fsXFlagProjInherit == 0 {
		os.Exit(exitUnavailable)
	}
	if !quotaMatches(rootFD, workspaceFD, projectID, ioctlProjectAttributes()) {
		os.Exit(exitUnavailable)
	}
	quota := ifDQBlk{}
	if err := quotactlFD(rootFD, qGetQuota, projectID, &quota); err != nil {
		os.Exit(exitUnavailable)
	}
	if quota.CurSpace > workspaceBytes || quota.CurInodes > workspaceInodes {
		os.Exit(exitQuotaExceeded)
	}
}

func fixedQuota() ifDQBlk {
	return ifDQBlk{
		BHardLimit: workspaceBytes / quotaBlockBytes,
		BSoftLimit: workspaceBytes / quotaBlockBytes,
		IHardLimit: workspaceInodes,
		ISoftLimit: workspaceInodes,
		Valid:      qIfBLimits | qIfILimits,
	}
}

func quotaMatches(
	rootFD,
	workspaceFD int,
	projectID uint32,
	attributes projectAttributeAccess,
) bool {
	if verifyErr := verifyProjectTree(workspaceFD, projectID, attributes); verifyErr != nil {
		return false
	}
	quota := ifDQBlk{}
	if err := quotactlFD(rootFD, qGetQuota, projectID, &quota); err != nil {
		return false
	}
	expected := fixedQuota()
	return quota.BHardLimit == expected.BHardLimit &&
		quota.BSoftLimit == expected.BSoftLimit &&
		quota.IHardLimit == expected.IHardLimit &&
		quota.ISoftLimit == expected.ISoftLimit
}

func ioctlProjectAttributes() projectAttributeAccess {
	return projectAttributeAccess{
		get: getProjectAttribute,
		set: setProjectAttribute,
	}
}

func applyProjectTree(
	workspaceFD int,
	projectID uint32,
	attributes projectAttributeAccess,
) error {
	if err := walkProjectTree(workspaceFD, func(_ int, _ bool) error {
		return nil
	}); err != nil {
		return err
	}
	return walkProjectTree(workspaceFD, func(fd int, directory bool) error {
		attribute, err := attributes.get(fd)
		if err != nil {
			return err
		}
		attribute.ProjectID = projectID
		if directory {
			attribute.XFlags |= fsXFlagProjInherit
		}
		if err := attributes.set(fd, &attribute); err != nil {
			return err
		}
		applied, err := attributes.get(fd)
		if err != nil ||
			applied.ProjectID != projectID ||
			(directory && applied.XFlags&fsXFlagProjInherit == 0) {
			return errors.New("project attribute verification failed")
		}
		return nil
	})
}

func verifyProjectTree(
	workspaceFD int,
	projectID uint32,
	attributes projectAttributeAccess,
) error {
	return walkProjectTree(workspaceFD, func(fd int, directory bool) error {
		attribute, err := attributes.get(fd)
		if err != nil {
			return err
		}
		if attribute.ProjectID != projectID ||
			(directory && attribute.XFlags&fsXFlagProjInherit == 0) {
			return errors.New("project tree mismatch")
		}
		return nil
	})
}

func walkProjectTree(
	workspaceFD int,
	visit func(fd int, directory bool) error,
) error {
	var root syscall.Stat_t
	if err := syscall.Fstat(workspaceFD, &root); err != nil {
		return err
	}
	if root.Mode&syscall.S_IFMT != syscall.S_IFDIR {
		return errors.New("workspace root is not a directory")
	}

	visitedDirectories := make(map[inodeKey]struct{})
	regularLinks := make(map[inodeKey]uint64)
	regularLinkTargets := make(map[inodeKey]uint64)
	entries := 0
	var walkDirectory func(int, int) error
	walkDirectory = func(directoryFD, depth int) error {
		if depth > maxWorkspaceTreeDepth {
			return errors.New("workspace tree depth exceeds bound")
		}
		var directoryStat syscall.Stat_t
		if err := syscall.Fstat(directoryFD, &directoryStat); err != nil {
			return err
		}
		if directoryStat.Mode&syscall.S_IFMT != syscall.S_IFDIR ||
			uint64(directoryStat.Dev) != uint64(root.Dev) {
			return errors.New("workspace tree changed filesystem or type")
		}
		directoryKey := inodeKey{
			device: uint64(directoryStat.Dev),
			inode:  directoryStat.Ino,
		}
		if _, duplicate := visitedDirectories[directoryKey]; duplicate {
			return errors.New("workspace directory cycle")
		}
		visitedDirectories[directoryKey] = struct{}{}
		entries++
		if entries > maxWorkspaceTreeEntries {
			return errors.New("workspace tree exceeds bound")
		}
		if err := visit(directoryFD, true); err != nil {
			return err
		}

		scanFD, err := openat2(
			directoryFD,
			".",
			syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_CLOEXEC,
		)
		if err != nil {
			return err
		}
		directory := os.NewFile(uintptr(scanFD), "quota-tree")
		children, readErr := directory.ReadDir(maxWorkspaceTreeEntries + 1)
		closeErr := directory.Close()
		if readErr != nil && !errors.Is(readErr, io.EOF) {
			return readErr
		}
		if closeErr != nil {
			return closeErr
		}
		if len(children) > maxWorkspaceTreeEntries {
			return errors.New("workspace tree exceeds bound")
		}

		for _, child := range children {
			name := child.Name()
			if name == "." || name == ".." || strings.ContainsRune(name, 0) {
				return errors.New("invalid workspace tree entry")
			}
			childFD, openErr := openat2(
				directoryFD,
				name,
				syscall.O_RDONLY|syscall.O_CLOEXEC|syscall.O_NONBLOCK,
			)
			if openErr != nil {
				return fmt.Errorf("open workspace tree entry: %w", openErr)
			}
			var childStat syscall.Stat_t
			statErr := syscall.Fstat(childFD, &childStat)
			if statErr != nil {
				syscall.Close(childFD)
				return statErr
			}
			if uint64(childStat.Dev) != uint64(root.Dev) {
				syscall.Close(childFD)
				return errors.New("workspace tree crossed a filesystem")
			}
			switch childStat.Mode & syscall.S_IFMT {
			case syscall.S_IFDIR:
				walkErr := walkDirectory(childFD, depth+1)
				syscall.Close(childFD)
				if walkErr != nil {
					return walkErr
				}
			case syscall.S_IFREG:
				entries++
				if entries > maxWorkspaceTreeEntries {
					syscall.Close(childFD)
					return errors.New("workspace tree exceeds bound")
				}
				key := inodeKey{
					device: uint64(childStat.Dev),
					inode:  childStat.Ino,
				}
				regularLinks[key]++
				regularLinkTargets[key] = uint64(childStat.Nlink)
				if regularLinks[key] == 1 {
					if visitErr := visit(childFD, false); visitErr != nil {
						syscall.Close(childFD)
						return visitErr
					}
				}
				if closeErr := syscall.Close(childFD); closeErr != nil {
					return closeErr
				}
			default:
				syscall.Close(childFD)
				return errors.New("workspace tree contains a special file")
			}
		}
		return nil
	}
	if err := walkDirectory(workspaceFD, 0); err != nil {
		return err
	}
	for key, observed := range regularLinks {
		if observed != regularLinkTargets[key] {
			return errors.New("workspace regular file has an external hard link")
		}
	}
	return nil
}

func assignProjectID(rootFD int, workspaceID string, current fsXAttr) (uint32, int, error) {
	directoryFD, err := openat2(rootFD, ".", syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_CLOEXEC)
	if err != nil {
		return 0, 0, err
	}
	directory := os.NewFile(uintptr(directoryFD), "workspace-root")
	entries, err := directory.ReadDir(100001)
	directory.Close()
	if err != nil || len(entries) > 100000 {
		return 0, 0, errors.New("workspace scan unavailable")
	}
	used := make(map[uint32]struct{}, len(entries))
	for _, entry := range entries {
		name := strings.ToLower(entry.Name())
		if name == workspaceID || !validWorkspaceID(name) {
			continue
		}
		fd, err := openat2(rootFD, name, syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_CLOEXEC)
		if err != nil {
			return 0, 0, err
		}
		attribute, attributeErr := getProjectAttribute(fd)
		syscall.Close(fd)
		if attributeErr != nil {
			return 0, 0, attributeErr
		}
		if attribute.ProjectID != 0 {
			used[attribute.ProjectID] = struct{}{}
		}
	}
	if current.ProjectID != 0 && current.XFlags&fsXFlagProjInherit != 0 {
		if _, collision := used[current.ProjectID]; collision {
			return 0, 0, errors.New("assigned project id collision")
		}
		return current.ProjectID, len(used) + 1, nil
	}
	projectID, err := nextAvailableProjectID(projectIDFor(workspaceID), used)
	return projectID, len(used) + 1, err
}

func hostReserveAllowsAssignment(rootFD, assignedProjects int, newAssignment bool) bool {
	var facts syscall.Statfs_t
	if assignedProjects <= 0 || syscall.Fstatfs(rootFD, &facts) != nil || facts.Bsize <= 0 {
		return false
	}
	blockSize := uint64(facts.Bsize)
	if uint64(facts.Blocks) > ^uint64(0)/blockSize || uint64(facts.Bavail) > ^uint64(0)/blockSize {
		return false
	}
	return reserveCapacityAvailable(
		uint64(facts.Blocks)*blockSize,
		uint64(facts.Bavail)*blockSize,
		assignedProjects,
		newAssignment,
	)
}

func reserveCapacityAvailable(totalBytes, availableBytes uint64, assignedProjects int, newAssignment bool) bool {
	if totalBytes == 0 || assignedProjects <= 0 {
		return false
	}
	reserveBytes := totalBytes / 10
	if totalBytes%10 != 0 {
		reserveBytes++
	}
	const minimumReserveBytes = uint64(10 * 1024 * 1024 * 1024)
	if reserveBytes < minimumReserveBytes {
		reserveBytes = minimumReserveBytes
	}
	if reserveBytes >= totalBytes || uint64(assignedProjects) > (totalBytes-reserveBytes)/workspaceBytes {
		return false
	}
	requiredAvailable := reserveBytes
	if newAssignment {
		if requiredAvailable > ^uint64(0)-workspaceBytes {
			return false
		}
		requiredAvailable += workspaceBytes
	}
	return availableBytes >= requiredAvailable
}

func nextAvailableProjectID(initial uint32, used map[uint32]struct{}) (uint32, error) {
	candidate := initial
	for attempts := 0; attempts <= len(used); attempts++ {
		if candidate != 0 {
			if _, exists := used[candidate]; !exists {
				return candidate, nil
			}
		}
		candidate = ((candidate + 1) & 0x7fffffff) | 0x00010000
	}
	return 0, errors.New("project id space unavailable")
}

func projectIDFor(workspaceID string) uint32 {
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(workspaceID))
	return (hash.Sum32() & 0x7fffffff) | 0x00010000
}

func validWorkspaceID(value string) bool {
	if len(value) != 36 || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-' {
		return false
	}
	for index, character := range value {
		if index == 8 || index == 13 || index == 18 || index == 23 {
			continue
		}
		if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f')) {
			return false
		}
	}
	return value[14] >= '1' && value[14] <= '8' &&
		(value[19] == '8' || value[19] == '9' || value[19] == 'a' || value[19] == 'b')
}

func getProjectAttribute(fd int) (fsXAttr, error) {
	attribute := fsXAttr{}
	_, _, errno := syscall.RawSyscall(syscall.SYS_IOCTL, uintptr(fd), fsIOCFSGetXAttr, uintptr(unsafe.Pointer(&attribute)))
	return attribute, errnoError(errno)
}

func setProjectAttribute(fd int, attribute *fsXAttr) error {
	_, _, errno := syscall.RawSyscall(syscall.SYS_IOCTL, uintptr(fd), fsIOCFSSetXAttr, uintptr(unsafe.Pointer(attribute)))
	return errnoError(errno)
}

func quotactlFD(fd int, command uint32, projectID uint32, quota *ifDQBlk) error {
	qcmd := uintptr((command << 8) | projectQuota)
	_, _, errno := syscall.RawSyscall6(
		sysQuotactlFD,
		uintptr(fd),
		qcmd,
		uintptr(projectID),
		uintptr(unsafe.Pointer(quota)),
		0,
		0,
	)
	return errnoError(errno)
}

func openat2(directoryFD int, path string, flags int) (int, error) {
	pathBytes, err := syscall.BytePtrFromString(path)
	if err != nil {
		return -1, err
	}
	how := openHow{
		Flags:   uint64(flags | syscall.O_NOFOLLOW),
		Resolve: resolveBeneath | resolveNoMagicLinks | resolveNoSymlinks | resolveNoXDev,
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

func errnoError(errno syscall.Errno) error {
	if errno == 0 {
		return nil
	}
	return errno
}
