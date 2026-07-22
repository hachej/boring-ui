package main

import (
	"errors"
	"hash/fnv"
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
	workspaceFD, err := openat2(rootFD, workspaceID, oPath|syscall.O_DIRECTORY|syscall.O_CLOEXEC)
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
		attribute.ProjectID = projectID
		attribute.XFlags |= fsXFlagProjInherit
		if err := setProjectAttribute(workspaceFD, &attribute); err != nil {
			os.Exit(exitUnavailable)
		}
	}
	if projectID == 0 || attribute.XFlags&fsXFlagProjInherit == 0 {
		os.Exit(exitUnavailable)
	}
	if !quotaMatches(rootFD, workspaceFD, projectID) {
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

func quotaMatches(rootFD, workspaceFD int, projectID uint32) bool {
	attribute, err := getProjectAttribute(workspaceFD)
	if err != nil || attribute.ProjectID != projectID || attribute.XFlags&fsXFlagProjInherit == 0 {
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
		fd, err := openat2(rootFD, name, oPath|syscall.O_DIRECTORY|syscall.O_CLOEXEC)
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

func errnoError(errno syscall.Errno) error {
	if errno == 0 {
		return nil
	}
	return errno
}
