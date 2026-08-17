#!/usr/bin/env python3
"""Opt-in inode preflight and conservative cleanup for repo-owned scratch roots."""

from __future__ import annotations

import argparse
import ctypes
import errno
import fcntl
import json
import os
import re
from pathlib import Path
import stat
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass
from typing import Callable, Iterable, TextIO

OWNER = "boring-ui"
PROTOCOL_VERSION = 1
ROOT_MARKER = ".boring-scratch-root.json"
ENTRY_MARKER = ".boring-scratch.json"
LOCK_FILE = ".boring-active.lock"
HEARTBEAT_FILE = ".boring-heartbeat"
TMPFS_TYPES = frozenset({"tmpfs", "ramfs"})
AT_FDCWD = -100
RENAME_NOREPLACE = 1


class SafetyError(RuntimeError):
    """A condition that makes mutation unsafe."""


@dataclass(frozen=True)
class Mount:
    point: Path
    fs_type: str


@dataclass(frozen=True)
class Decision:
    path: Path
    action: str
    reason: str


@dataclass
class LeaseEvidence:
    lock: TextIO
    entry_identity: tuple[int, int]
    heartbeat_identity: tuple[int, int]
    heartbeat_mtime_ns: int


def _strict_json(path: Path, expected_keys: set[str]) -> dict[str, object]:
    try:
        st = path.lstat()
    except OSError as exc:
        raise SafetyError(f"cannot stat marker: {exc.strerror}") from exc
    if not stat.S_ISREG(st.st_mode) or path.is_symlink():
        raise SafetyError("marker is not a regular non-symlink file")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise SafetyError(f"marker is unreadable or malformed: {exc}") from exc
    if not isinstance(value, dict) or set(value) != expected_keys:
        raise SafetyError("marker schema is ambiguous")
    return value


def _validate_root(root: Path) -> tuple[Path, str]:
    if not root.is_absolute():
        raise SafetyError("scratch root must be absolute")
    try:
        st = root.lstat()
    except OSError as exc:
        raise SafetyError(f"scratch root is unavailable: {exc.strerror}") from exc
    if not stat.S_ISDIR(st.st_mode) or root.is_symlink():
        raise SafetyError("scratch root must be a real directory, not a symlink")
    if st.st_uid != os.getuid():
        raise SafetyError("scratch root must be owned by the current uid")
    if stat.S_IMODE(st.st_mode) & 0o022:
        raise SafetyError("scratch root must not be group/world writable")
    resolved = root.resolve(strict=True)
    if resolved != root:
        raise SafetyError("scratch root path must already be canonical")
    marker = _strict_json(root / ROOT_MARKER, {"owner", "protocol", "root_id"})
    if marker["owner"] != OWNER or marker["protocol"] != PROTOCOL_VERSION:
        raise SafetyError("scratch root marker has the wrong owner or protocol")
    root_id = marker["root_id"]
    if not isinstance(root_id, str) or not root_id or len(root_id) > 128:
        raise SafetyError("scratch root marker has an invalid root_id")
    return resolved, root_id


def _rename_noreplace(source: Path, target: Path) -> None:
    try:
        renameat2 = ctypes.CDLL(None, use_errno=True).renameat2
    except AttributeError as exc:
        raise SafetyError("platform lacks atomic no-clobber renameat2") from exc
    renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    renameat2.restype = ctypes.c_int
    if renameat2(
        AT_FDCWD, os.fsencode(source), AT_FDCWD, os.fsencode(target), RENAME_NOREPLACE
    ) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), target)


def _fd_mount_id(fd: int) -> int:
    try:
        lines = Path(f"/proc/self/fdinfo/{fd}").read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise SafetyError(f"cannot inspect mount identity: {exc}") from exc
    for line in lines:
        if line.startswith("mnt_id:"):
            try:
                return int(line.split(":", 1)[1].strip())
            except ValueError as exc:
                raise SafetyError("mount identity is malformed") from exc
    raise SafetyError("mount identity is unavailable")


def _remove_tree_at(
    parent_fd: int,
    name: str,
    expected_mount_id: int,
    expected_identity: tuple[int, int] | None = None,
    remove_root: bool = True,
) -> None:
    directory_fd = os.open(
        name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd
    )
    try:
        opened_st = os.fstat(directory_fd)
        if expected_identity is not None and (opened_st.st_dev, opened_st.st_ino) != expected_identity:
            raise SafetyError(f"directory identity changed at {name}")
        if _fd_mount_id(directory_fd) != expected_mount_id:
            raise SafetyError(f"mounted directory appeared at {name}")
        for child in os.listdir(directory_fd):
            child_st = os.stat(child, dir_fd=directory_fd, follow_symlinks=False)
            if stat.S_ISLNK(child_st.st_mode):
                raise SafetyError(f"symlink appeared during removal at {child}")
            if stat.S_ISDIR(child_st.st_mode):
                _remove_tree_at(directory_fd, child, expected_mount_id)
                continue
            path_fd = os.open(child, os.O_PATH | os.O_NOFOLLOW, dir_fd=directory_fd)
            try:
                if _fd_mount_id(path_fd) != expected_mount_id:
                    raise SafetyError(f"mounted file appeared at {child}")
            finally:
                os.close(path_fd)
            os.unlink(child, dir_fd=directory_fd)
    finally:
        os.close(directory_fd)
    if remove_root:
        os.rmdir(name, dir_fd=parent_fd)


def _discard_private_staging(staging: Path, identity: tuple[int, int]) -> None:
    parent_fd = os.open(staging.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        try:
            current_st = os.stat(staging.name, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError:
            return
        if (current_st.st_dev, current_st.st_ino) != identity:
            return
        _remove_tree_at(
            parent_fd,
            staging.name,
            _fd_mount_id(parent_fd),
            expected_identity=identity,
            remove_root=False,
        )
    finally:
        os.close(parent_fd)


def initialize_root(root: Path) -> None:
    if not root.is_absolute():
        raise SafetyError("scratch root must be absolute")
    if root.exists() or root.is_symlink():
        raise SafetyError("init refuses an existing path")
    if not root.parent.is_dir():
        raise SafetyError("scratch root parent must already exist")
    staging = Path(tempfile.mkdtemp(prefix=f".{root.name}.boring-init-", dir=root.parent))
    staging_st = staging.lstat()
    staging_identity = (staging_st.st_dev, staging_st.st_ino)
    try:
        staging.chmod(0o700)
        marker = {"owner": OWNER, "protocol": PROTOCOL_VERSION, "root_id": str(uuid.uuid4())}
        marker_path = staging / ROOT_MARKER
        marker_path.write_text(json.dumps(marker, sort_keys=True) + "\n", encoding="utf-8")
        marker_path.chmod(0o600)
        _rename_noreplace(staging, root)
    except BaseException:
        _discard_private_staging(staging, staging_identity)
        raise


def initialize_entry(root: Path, name: str, *, now: float | None = None) -> Path:
    canonical_root, root_id = _validate_root(root)
    if (
        not name
        or name in {".", "..", ROOT_MARKER}
        or name.startswith((".boring-trash-", ".boring-init-"))
        or "/" in name
        or os.sep in name
    ):
        raise SafetyError("entry name must be one non-reserved direct child name")
    entry = canonical_root / name
    if entry.exists() or entry.is_symlink():
        raise SafetyError("entry path already exists")
    staging = Path(tempfile.mkdtemp(prefix=".boring-init-", dir=canonical_root))
    staging_st = staging.lstat()
    staging_identity = (staging_st.st_dev, staging_st.st_ino)
    try:
        staging.chmod(0o700)
        marker = {
            "entry": name,
            "owner": OWNER,
            "protocol": PROTOCOL_VERSION,
            "root_id": root_id,
        }
        marker_path = staging / ENTRY_MARKER
        marker_path.write_text(json.dumps(marker, sort_keys=True) + "\n", encoding="utf-8")
        marker_path.chmod(0o600)
        (staging / LOCK_FILE).touch(mode=0o600)
        heartbeat = staging / HEARTBEAT_FILE
        heartbeat.touch(mode=0o600)
        timestamp = time.time() if now is None else now
        os.utime(heartbeat, (timestamp, timestamp), follow_symlinks=False)
        _rename_noreplace(staging, entry)
    except BaseException:
        _discard_private_staging(staging, staging_identity)
        raise
    return entry


def _tree_is_confined(entry: Path, root_device: int) -> tuple[bool, str]:
    for current, dirs, files in os.walk(entry, topdown=True, followlinks=False):
        current_path = Path(current)
        names = [*dirs, *files]
        for name in names:
            candidate = current_path / name
            try:
                st = candidate.lstat()
            except OSError as exc:
                return False, f"tree changed during validation: {exc.strerror}"
            if stat.S_ISLNK(st.st_mode):
                return False, f"symlink present at {candidate.relative_to(entry)}"
            if st.st_dev != root_device:
                return False, f"filesystem boundary at {candidate.relative_to(entry)}"
    return True, "confined"


def _entry_decision(
    root: Path,
    root_id: str,
    entry: Path,
    *,
    stale_before: float,
    now: float,
    mounts: list[Mount],
) -> tuple[Decision, LeaseEvidence | None]:
    try:
        entry_st = entry.lstat()
    except OSError as exc:
        return Decision(entry, "retain", f"cannot stat entry: {exc.strerror}"), None
    if not stat.S_ISDIR(entry_st.st_mode) or entry.is_symlink():
        return Decision(entry, "retain", "not a real directory"), None
    if entry_st.st_dev != root.lstat().st_dev:
        return Decision(entry, "retain", "entry is a filesystem boundary"), None
    for mount in mounts:
        if mount.point == entry or entry in mount.point.parents:
            return Decision(entry, "retain", f"mounted path boundary at {mount.point}"), None
    try:
        marker = _strict_json(entry / ENTRY_MARKER, {"entry", "owner", "protocol", "root_id"})
    except SafetyError as exc:
        return Decision(entry, "retain", str(exc)), None
    expected = {
        "entry": entry.name,
        "owner": OWNER,
        "protocol": PROTOCOL_VERSION,
        "root_id": root_id,
    }
    if marker != expected:
        return Decision(entry, "retain", "entry marker does not exactly match path/root"), None

    lock_path = entry / LOCK_FILE
    heartbeat_path = entry / HEARTBEAT_FILE
    try:
        lock_st = lock_path.lstat()
        heartbeat_st = heartbeat_path.lstat()
    except OSError as exc:
        return Decision(entry, "retain", f"lease files unavailable: {exc.strerror}"), None
    if (
        not stat.S_ISREG(lock_st.st_mode)
        or lock_path.is_symlink()
        or not stat.S_ISREG(heartbeat_st.st_mode)
        or heartbeat_path.is_symlink()
    ):
        return Decision(entry, "retain", "lease files must be regular non-symlink files"), None

    lock_handle: TextIO | None = None
    try:
        lock_handle = lock_path.open("r+")
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as exc:
        if lock_handle is not None:
            lock_handle.close()
        if exc.errno in {errno.EACCES, errno.EAGAIN}:
            return Decision(entry, "retain", "active lock held"), None
        return Decision(entry, "retain", f"lock state ambiguous: {exc.strerror}"), None

    # Re-stat after taking the lock so lease replacement and heartbeat updates are observed.
    try:
        locked_st = lock_path.lstat()
        heartbeat_st = heartbeat_path.lstat()
    except OSError as exc:
        lock_handle.close()
        return Decision(entry, "retain", f"lease changed after lock: {exc.strerror}"), None
    if (locked_st.st_dev, locked_st.st_ino) != (lock_st.st_dev, lock_st.st_ino):
        lock_handle.close()
        return Decision(entry, "retain", "lock file changed during validation"), None
    age = now - heartbeat_st.st_mtime
    if age < 0:
        lock_handle.close()
        return Decision(entry, "retain", "heartbeat timestamp is in the future"), None
    if heartbeat_st.st_mtime >= stale_before:
        lock_handle.close()
        return Decision(entry, "retain", f"heartbeat live ({int(age)}s old)"), None

    confined, reason = _tree_is_confined(entry, root.lstat().st_dev)
    if not confined:
        lock_handle.close()
        return Decision(entry, "retain", reason), None
    evidence = LeaseEvidence(
        lock=lock_handle,
        entry_identity=(entry_st.st_dev, entry_st.st_ino),
        heartbeat_identity=(heartbeat_st.st_dev, heartbeat_st.st_ino),
        heartbeat_mtime_ns=heartbeat_st.st_mtime_ns,
    )
    return (
        Decision(entry, "delete", f"stale heartbeat ({int(age)}s old), unlocked, confined"),
        evidence,
    )


def _read_mounts() -> list[Mount]:
    try:
        with Path("/proc/self/mountinfo").open(encoding="utf-8") as mountinfo:
            mounts = parse_mountinfo(mountinfo)
    except OSError as exc:
        raise SafetyError(f"cannot read mount boundaries: {exc}") from exc
    if not mounts:
        raise SafetyError("mount boundary data is empty or malformed")
    return mounts


def clean_root(
    root: Path,
    *,
    stale_seconds: int,
    apply: bool,
    now: float | None = None,
    mounts: list[Mount] | None = None,
) -> list[Decision]:
    if stale_seconds <= 0:
        raise SafetyError("stale-seconds must be greater than zero")
    canonical_root, root_id = _validate_root(root)
    root_st = canonical_root.lstat()
    root_identity = (root_st.st_dev, root_st.st_ino)
    active_mounts = _read_mounts() if mounts is None else mounts
    current_time = time.time() if now is None else now
    stale_before = current_time - stale_seconds
    decisions: list[Decision] = []
    root_fd = os.open(canonical_root, os.O_RDONLY | os.O_DIRECTORY)
    try:
        opened_root_st = os.fstat(root_fd)
        if (opened_root_st.st_dev, opened_root_st.st_ino) != root_identity:
            raise SafetyError("scratch root changed while opening")
        root_mount_id = _fd_mount_id(root_fd)
        for entry in sorted(canonical_root.iterdir(), key=lambda item: item.name):
            if entry.name == ROOT_MARKER:
                continue
            if entry.name.startswith((".boring-trash-", ".boring-init-")):
                decisions.append(Decision(entry, "retain", "ambiguous prior quarantine/staging"))
                continue
            decision, evidence = _entry_decision(
                canonical_root,
                root_id,
                entry,
                stale_before=stale_before,
                now=current_time,
                mounts=active_mounts,
            )
            if decision.action != "delete" or not apply:
                if evidence is not None:
                    evidence.lock.close()
                decisions.append(
                    Decision(entry, "would-delete", decision.reason)
                    if decision.action == "delete"
                    else decision
                )
                continue

            if evidence is None:
                raise SafetyError("eligible entry is missing lease evidence")
            quarantine_name = f".boring-trash-{uuid.uuid4().hex}"
            quarantine = canonical_root / quarantine_name
            renamed = False
            try:
                current_root_st = canonical_root.lstat()
                if (current_root_st.st_dev, current_root_st.st_ino) != root_identity:
                    raise SafetyError("scratch root changed before quarantine")
                held_lock_st = os.fstat(evidence.lock.fileno())
                path_lock_st = (entry / LOCK_FILE).lstat()
                if (held_lock_st.st_dev, held_lock_st.st_ino) != (
                    path_lock_st.st_dev,
                    path_lock_st.st_ino,
                ):
                    raise SafetyError("lock file changed before quarantine")
                current_heartbeat_st = (entry / HEARTBEAT_FILE).lstat()
                if (
                    (current_heartbeat_st.st_dev, current_heartbeat_st.st_ino)
                    != evidence.heartbeat_identity
                    or current_heartbeat_st.st_mtime_ns != evidence.heartbeat_mtime_ns
                ):
                    raise SafetyError("heartbeat changed before quarantine")
                current_entry_st = os.stat(entry.name, dir_fd=root_fd, follow_symlinks=False)
                if (current_entry_st.st_dev, current_entry_st.st_ino) != evidence.entry_identity:
                    raise SafetyError("entry directory changed before quarantine")
                os.rename(
                    entry.name,
                    quarantine_name,
                    src_dir_fd=root_fd,
                    dst_dir_fd=root_fd,
                )
                renamed = True
                quarantined_st = os.stat(
                    quarantine_name, dir_fd=root_fd, follow_symlinks=False
                )
                if (quarantined_st.st_dev, quarantined_st.st_ino) != evidence.entry_identity:
                    raise SafetyError("quarantine identity mismatch")
                _remove_tree_at(
                    root_fd,
                    quarantine_name,
                    root_mount_id,
                    expected_identity=evidence.entry_identity,
                )
                decisions.append(Decision(entry, "deleted", decision.reason))
            except (OSError, SafetyError) as exc:
                retained_path = quarantine if renamed else entry
                reason = "quarantined but deletion failed" if renamed else "atomic quarantine failed"
                decisions.append(Decision(retained_path, "retain", f"{reason}: {exc}"))
            finally:
                evidence.lock.close()
    finally:
        os.close(root_fd)
    return decisions


def parse_mountinfo(lines: Iterable[str]) -> list[Mount]:
    mounts: list[Mount] = []
    for raw in lines:
        fields = raw.rstrip("\n").split(" ")
        try:
            separator = fields.index("-")
            point = fields[4]
            fs_type = fields[separator + 1]
        except (ValueError, IndexError):
            continue
        decoded = re.sub(
            r"\\([0-7]{3})", lambda match: chr(int(match.group(1), 8)), point
        )
        mounts.append(Mount(Path(decoded), fs_type))
    return mounts


def filesystem_type(path: Path, mounts: Iterable[Mount]) -> str | None:
    resolved = path.resolve(strict=True)
    matches: list[Mount] = []
    for mount in mounts:
        try:
            resolved.relative_to(mount.point)
        except ValueError:
            continue
        matches.append(mount)
    if not matches:
        return None
    return max(matches, key=lambda mount: len(mount.point.parts)).fs_type


def inode_used_percent(path: Path, statvfs: Callable[[Path], os.statvfs_result] = os.statvfs) -> float:
    values = statvfs(path)
    if values.f_files <= 0:
        raise SafetyError(f"filesystem for {path} does not report inode capacity")
    return 100.0 * (values.f_files - values.f_ffree) / values.f_files


def preflight(
    *,
    paths: list[Path],
    threshold: float,
    tmpdir: Path,
    pnpm_store: Path | None,
    mounts: list[Mount],
    statvfs: Callable[[Path], os.statvfs_result] = os.statvfs,
) -> tuple[list[str], list[str]]:
    if not 0 < threshold <= 100:
        raise SafetyError("inode threshold must be in (0, 100]")
    failures: list[str] = []
    warnings: list[str] = []
    checked: set[tuple[int, int]] = set()
    for path in paths:
        resolved = path.resolve(strict=True)
        st = resolved.stat()
        device = (os.major(st.st_dev), os.minor(st.st_dev))
        if device in checked:
            continue
        checked.add(device)
        used = inode_used_percent(resolved, statvfs)
        line = f"inode usage {used:.2f}% at {resolved} (limit {threshold:.2f}%)"
        (failures if used >= threshold else warnings).append(("FAIL " if used >= threshold else "OK ") + line)

    tmp_type = filesystem_type(tmpdir, mounts)
    if tmp_type in TMPFS_TYPES:
        failures.append(f"FAIL TMPDIR {tmpdir.resolve(strict=True)} is on {tmp_type}")
    elif tmp_type is None:
        warnings.append(f"WARN TMPDIR filesystem is unknown for {tmpdir.resolve(strict=True)}")
    else:
        warnings.append(f"OK TMPDIR {tmpdir.resolve(strict=True)} is on {tmp_type}")

    if pnpm_store is None:
        warnings.append("WARN pnpm store path not supplied; pass --pnpm-store or PNPM_STORE_DIR")
    else:
        pnpm_type = filesystem_type(pnpm_store, mounts)
        if pnpm_type in TMPFS_TYPES:
            failures.append(f"FAIL pnpm store {pnpm_store.resolve(strict=True)} is on {pnpm_type}")
        elif pnpm_type is None:
            warnings.append(f"WARN pnpm store filesystem is unknown for {pnpm_store.resolve(strict=True)}")
        else:
            warnings.append(f"OK pnpm store {pnpm_store.resolve(strict=True)} is on {pnpm_type}")
    return failures, warnings


def _print_decisions(decisions: Iterable[Decision]) -> None:
    for decision in decisions:
        print(f"{decision.action.upper()} {decision.path}: {decision.reason}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_root_parser = subparsers.add_parser("init-root", help="create a new private marked root")
    init_root_parser.add_argument("root", type=Path)

    init_entry_parser = subparsers.add_parser("init-entry", help="create one marked scratch entry")
    init_entry_parser.add_argument("root", type=Path)
    init_entry_parser.add_argument("name")

    clean_parser = subparsers.add_parser("clean", help="inspect or age marked entries")
    clean_parser.add_argument("--root", action="append", required=True, type=Path)
    clean_parser.add_argument("--stale-seconds", required=True, type=int)
    clean_parser.add_argument("--apply", action="store_true", help="delete eligible entries; default is dry-run")

    check_parser = subparsers.add_parser("check", help="fail fast on inode or tmpfs pressure")
    check_parser.add_argument("--path", action="append", required=True, type=Path)
    check_parser.add_argument("--inode-threshold", required=True, type=float)
    check_parser.add_argument("--tmpdir", type=Path, default=Path(os.environ.get("TMPDIR", "/tmp")))
    check_parser.add_argument("--pnpm-store", type=Path, default=None)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "init-root":
            initialize_root(args.root)
            print(f"INITIALIZED {args.root}")
            return 0
        if args.command == "init-entry":
            print(f"INITIALIZED {initialize_entry(args.root, args.name)}")
            return 0
        if args.command == "clean":
            for root in args.root:
                _print_decisions(
                    clean_root(root, stale_seconds=args.stale_seconds, apply=args.apply)
                )
            return 0
        if args.command == "check":
            mounts = _read_mounts()
            pnpm_store = args.pnpm_store
            if pnpm_store is None and os.environ.get("PNPM_STORE_DIR"):
                pnpm_store = Path(os.environ["PNPM_STORE_DIR"])
            failures, messages = preflight(
                paths=args.path,
                threshold=args.inode_threshold,
                tmpdir=args.tmpdir,
                pnpm_store=pnpm_store,
                mounts=mounts,
            )
            for message in [*messages, *failures]:
                print(message)
            return 2 if failures else 0
    except (OSError, SafetyError) as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 3
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
