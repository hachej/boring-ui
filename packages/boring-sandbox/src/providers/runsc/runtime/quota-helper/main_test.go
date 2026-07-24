package main

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestNextAvailableProjectIDProbesCollisions(t *testing.T) {
	used := map[uint32]struct{}{0x10000: {}, 0x10001: {}}
	projectID, err := nextAvailableProjectID(0x10000, used)
	if err != nil {
		t.Fatal(err)
	}
	if projectID != 0x10002 {
		t.Fatalf("got project id %x", projectID)
	}
}

func TestNextAvailableProjectIDKeepsFreeInitialValue(t *testing.T) {
	projectID, err := nextAvailableProjectID(0x12345, map[uint32]struct{}{})
	if err != nil {
		t.Fatal(err)
	}
	if projectID != 0x12345 {
		t.Fatalf("got project id %x", projectID)
	}
}

func TestReserveCapacityFaultMatrix(t *testing.T) {
	const gib = uint64(1024 * 1024 * 1024)
	if !reserveCapacityAvailable(100*gib, 50*gib, 90, false) {
		t.Fatal("expected existing fixed allocations to preserve ten percent")
	}
	if reserveCapacityAvailable(100*gib, 50*gib, 91, true) {
		t.Fatal("expected aggregate fixed allocations to preserve ten percent")
	}
	if reserveCapacityAvailable(200*gib, 20*gib, 1, true) {
		t.Fatal("expected a new allocation to require reserve plus one quota")
	}
	if !reserveCapacityAvailable(200*gib, 21*gib, 1, true) {
		t.Fatal("expected exact reserve plus one quota to pass")
	}
	if reserveCapacityAvailable(8*gib, 8*gib, 1, true) {
		t.Fatal("expected a volume smaller than the ten GiB reserve to fail")
	}
}

func TestApplyProjectTreeTagsPopulatedNestedTree(t *testing.T) {
	root := t.TempDir()
	nested := filepath.Join(root, "repo", "node_modules", "pkg")
	if err := os.MkdirAll(nested, 0o700); err != nil {
		t.Fatal(err)
	}
	for path, value := range map[string]string{
		filepath.Join(root, "root.txt"):            "root",
		filepath.Join(root, "repo", "index.ts"):    "index",
		filepath.Join(nested, "package.json"):      "{}",
		filepath.Join(nested, "implementation.js"): "module.exports = true",
	} {
		if err := os.WriteFile(path, []byte(value), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	rootFD, err := syscall.Open(
		root,
		syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_CLOEXEC,
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer syscall.Close(rootFD)

	stored := make(map[inodeKey]fsXAttr)
	keyForFD := func(fd int) inodeKey {
		var stat syscall.Stat_t
		if err := syscall.Fstat(fd, &stat); err != nil {
			t.Fatal(err)
		}
		return inodeKey{device: uint64(stat.Dev), inode: stat.Ino}
	}
	attributes := projectAttributeAccess{
		get: func(fd int) (fsXAttr, error) {
			return stored[keyForFD(fd)], nil
		},
		set: func(fd int, attribute *fsXAttr) error {
			stored[keyForFD(fd)] = *attribute
			return nil
		},
	}
	const unrelatedFlag = uint32(0x00000010)
	rootKey := keyForFD(rootFD)
	stored[rootKey] = fsXAttr{XFlags: unrelatedFlag}

	const projectID = uint32(0x12345)
	if err := applyProjectTree(rootFD, projectID, attributes); err != nil {
		t.Fatal(err)
	}
	if err := verifyProjectTree(rootFD, projectID, attributes); err != nil {
		t.Fatal(err)
	}
	visited := 0
	if err := walkProjectTree(rootFD, func(fd int, directory bool) error {
		visited++
		attribute := stored[keyForFD(fd)]
		if attribute.ProjectID != projectID {
			t.Fatalf("inode %d retained project %d", keyForFD(fd).inode, attribute.ProjectID)
		}
		if directory && attribute.XFlags&fsXFlagProjInherit == 0 {
			t.Fatalf("directory %d lacks project inheritance", keyForFD(fd).inode)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if visited != 8 {
		t.Fatalf("visited %d populated-tree inodes, want 8", visited)
	}
	if stored[rootKey].XFlags&unrelatedFlag == 0 {
		t.Fatal("unrelated root project flags were not preserved")
	}

	for key, attribute := range stored {
		if key != rootKey {
			attribute.ProjectID = 0
			stored[key] = attribute
			break
		}
	}
	if verifyProjectTree(rootFD, projectID, attributes) == nil {
		t.Fatal("recursive verification accepted a partially tagged tree")
	}
	if err := applyProjectTree(rootFD, projectID, attributes); err != nil {
		t.Fatalf("idempotent repair failed: %v", err)
	}
}

func TestApplyProjectTreeRejectsSymlinkWithoutTouchingOutside(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "repo"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "repo", "escape")); err != nil {
		t.Fatal(err)
	}
	rootFD, err := syscall.Open(
		root,
		syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_CLOEXEC,
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer syscall.Close(rootFD)

	setCount := 0
	stored := make(map[inodeKey]fsXAttr)
	keyForFD := func(fd int) inodeKey {
		var stat syscall.Stat_t
		if err := syscall.Fstat(fd, &stat); err != nil {
			t.Fatal(err)
		}
		return inodeKey{device: uint64(stat.Dev), inode: stat.Ino}
	}
	attributes := projectAttributeAccess{
		get: func(fd int) (fsXAttr, error) { return stored[keyForFD(fd)], nil },
		set: func(fd int, attribute *fsXAttr) error {
			setCount++
			stored[keyForFD(fd)] = *attribute
			return nil
		},
	}
	if err := applyProjectTree(rootFD, 0x12345, attributes); err == nil {
		t.Fatal("symlinked tree entry was accepted")
	}
	if setCount != 0 {
		t.Fatalf("touched %d inodes before rejecting symlink, want none", setCount)
	}
}

func TestApplyProjectTreeRejectsExternalHardLinkBeforeMutation(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "workspace")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	inside := filepath.Join(root, "inside.txt")
	if err := os.WriteFile(inside, []byte("shared inode"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(inside, filepath.Join(parent, "outside.txt")); err != nil {
		t.Fatal(err)
	}
	rootFD, err := syscall.Open(
		root,
		syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_CLOEXEC,
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer syscall.Close(rootFD)

	setCount := 0
	attributes := projectAttributeAccess{
		get: func(_ int) (fsXAttr, error) { return fsXAttr{}, nil },
		set: func(_ int, _ *fsXAttr) error {
			setCount++
			return nil
		},
	}
	if err := applyProjectTree(rootFD, 0x12345, attributes); err == nil {
		t.Fatal("workspace file with an external hard link was accepted")
	}
	if setCount != 0 {
		t.Fatalf("made %d project-id mutations before rejecting external hard link", setCount)
	}
}

func TestApplyProjectTreeRejectsHardLinkInsertedAfterPreflight(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "workspace")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	inside := filepath.Join(root, "inside.txt")
	if err := os.WriteFile(inside, []byte("shared inode"), 0o600); err != nil {
		t.Fatal(err)
	}
	rootFD, err := syscall.Open(
		root,
		syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_CLOEXEC,
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer syscall.Close(rootFD)
	insideFD, err := syscall.Open(inside, syscall.O_RDONLY|syscall.O_CLOEXEC, 0)
	if err != nil {
		t.Fatal(err)
	}
	var insideStat syscall.Stat_t
	if err := syscall.Fstat(insideFD, &insideStat); err != nil {
		syscall.Close(insideFD)
		t.Fatal(err)
	}
	syscall.Close(insideFD)
	insideKey := inodeKey{
		device: uint64(insideStat.Dev),
		inode:  insideStat.Ino,
	}

	insideMutated := false
	attributes := projectAttributeAccess{
		get: func(_ int) (fsXAttr, error) { return fsXAttr{}, nil },
		set: func(fd int, _ *fsXAttr) error {
			var stat syscall.Stat_t
			if err := syscall.Fstat(fd, &stat); err != nil {
				return err
			}
			if (inodeKey{device: uint64(stat.Dev), inode: stat.Ino}) == insideKey {
				insideMutated = true
			}
			return nil
		},
	}
	err = applyProjectTreeWithPreMutation(
		rootFD,
		0x12345,
		attributes,
		func() error {
			return os.Link(inside, filepath.Join(parent, "outside.txt"))
		},
	)
	if err == nil {
		t.Fatal("hard link inserted after preflight was accepted")
	}
	if insideMutated {
		t.Fatal("mutated an inode after its link count changed")
	}
}

func TestApplyProjectTreeRejectsInTreeHardLinksBeforeDistributionCanRace(t *testing.T) {
	root := t.TempDir()
	first := filepath.Join(root, "first.txt")
	second := filepath.Join(root, "second.txt")
	if err := os.WriteFile(first, []byte("shared inode"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(first, second); err != nil {
		t.Fatal(err)
	}
	rootFD, err := syscall.Open(
		root,
		syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_CLOEXEC,
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer syscall.Close(rootFD)

	setCount := 0
	mutationPhaseReached := false
	attributes := projectAttributeAccess{
		get: func(_ int) (fsXAttr, error) { return fsXAttr{}, nil },
		set: func(_ int, _ *fsXAttr) error {
			setCount++
			return nil
		},
	}
	err = applyProjectTreeWithPreMutation(
		rootFD,
		0x12345,
		attributes,
		func() error {
			mutationPhaseReached = true
			return os.Rename(second, filepath.Join(filepath.Dir(root), "outside.txt"))
		},
	)
	if err == nil {
		t.Fatal("in-tree hard links were accepted")
	}
	if mutationPhaseReached || setCount != 0 {
		t.Fatal("hard-linked tree reached the mutation phase")
	}
}
