"""Workspace path helpers."""

from __future__ import annotations

import ctypes
import errno
import os
import sys
from functools import lru_cache
from pathlib import Path

_RESOLVE_NO_MAGICLINKS = 0x02
_RESOLVE_BENEATH = 0x08
_DEFAULT_OPENAT2_RESOLVE = _RESOLVE_BENEATH | _RESOLVE_NO_MAGICLINKS
_OPENAT2_TRAVERSAL_ERRNOS = {errno.EXDEV, errno.ELOOP}
_OPENAT2_UNAVAILABLE_ERRNOS = {errno.ENOSYS, errno.EPERM}
_O_CLOEXEC = getattr(os, "O_CLOEXEC", 0)
_O_DIRECTORY = getattr(os, "O_DIRECTORY", 0)
_O_PATH = getattr(os, "O_PATH", 0)
_SYS_OPENAT2 = 437 if sys.platform.startswith("linux") else None
_LIBC = ctypes.CDLL(None, use_errno=True) if _SYS_OPENAT2 is not None else None


class _OpenHow(ctypes.Structure):
    _fields_ = [
        ("flags", ctypes.c_uint64),
        ("mode", ctypes.c_uint64),
        ("resolve", ctypes.c_uint64),
    ]


def _normalize_relative_path(path: Path | str) -> Path:
    candidate = Path(path)
    if not str(candidate):
        return Path(".")
    if candidate.is_absolute():
        raise ValueError(f"Path traversal detected: {path}")
    return candidate


def _resolve_path_beneath_fallback(root_path: Path, path: Path | str) -> Path:
    normalized = _normalize_relative_path(path)
    resolved_root = Path(root_path).resolve()
    resolved = (resolved_root / normalized).resolve()
    if not resolved.is_relative_to(resolved_root):
        raise ValueError(f"Path traversal detected: {path}")
    return resolved


def _root_path_from_fd(root_fd: int) -> Path:
    for proc_path in (f"/proc/self/fd/{root_fd}", f"/dev/fd/{root_fd}"):
        try:
            return Path(os.readlink(proc_path)).resolve()
        except OSError:
            continue
    raise RuntimeError(f"Could not resolve root path for fd {root_fd}")


def _raw_openat2(
    root_fd: int,
    path: Path | str,
    *,
    flags: int,
    mode: int = 0,
    resolve: int = _DEFAULT_OPENAT2_RESOLVE,
) -> int:
    if _LIBC is None or _SYS_OPENAT2 is None:
        raise OSError(errno.ENOSYS, "openat2 is not available on this platform")

    normalized = _normalize_relative_path(path)
    how = _OpenHow(flags=flags, mode=mode, resolve=resolve)
    fd = _LIBC.syscall(
        _SYS_OPENAT2,
        ctypes.c_int(root_fd),
        ctypes.c_char_p(os.fsencode(os.fspath(normalized))),
        ctypes.byref(how),
        ctypes.sizeof(how),
    )
    if fd < 0:
        err = ctypes.get_errno()
        raise OSError(err, os.strerror(err), os.fspath(normalized))
    return int(fd)


@lru_cache(maxsize=1)
def openat2_available() -> bool:
    """Return True when the Linux openat2 syscall is usable."""

    if _LIBC is None or _SYS_OPENAT2 is None or _O_PATH == 0:
        return False

    root_fd = os.open("/", _O_PATH | _O_DIRECTORY | _O_CLOEXEC)
    try:
        fd = _raw_openat2(
            root_fd,
            ".",
            flags=_O_PATH | _O_DIRECTORY | _O_CLOEXEC,
        )
    except OSError as exc:
        if exc.errno in _OPENAT2_UNAVAILABLE_ERRNOS:
            return False
        return False
    else:
        os.close(fd)
        return True
    finally:
        os.close(root_fd)


def safe_open(
    root_fd: int,
    relpath: Path | str,
    *,
    flags: int | None = None,
    mode: int = 0,
) -> int:
    """Open a path beneath an already-open workspace root."""

    open_flags = os.O_RDONLY if flags is None else flags
    if _O_CLOEXEC:
        open_flags |= _O_CLOEXEC

    if openat2_available():
        try:
            return _raw_openat2(root_fd, relpath, flags=open_flags, mode=mode)
        except OSError as exc:
            if exc.errno in _OPENAT2_TRAVERSAL_ERRNOS:
                raise ValueError(f"Path traversal detected: {relpath}") from exc
            if exc.errno not in _OPENAT2_UNAVAILABLE_ERRNOS:
                raise

    resolved = _resolve_path_beneath_fallback(_root_path_from_fd(root_fd), relpath)
    return os.open(resolved, open_flags, mode)


def resolve_path_beneath(root_path: Path, path: Path | str) -> Path:
    """Resolve a path beneath a workspace root without allowing escapes."""

    resolved_root = Path(root_path).resolve()
    normalized = _normalize_relative_path(path)

    if not openat2_available():
        return _resolve_path_beneath_fallback(resolved_root, normalized)

    root_fd = os.open(resolved_root, _O_PATH | _O_DIRECTORY | _O_CLOEXEC)
    try:
        try:
            fd = safe_open(root_fd, normalized, flags=_O_PATH)
        except FileNotFoundError:
            return _resolve_path_beneath_fallback(resolved_root, normalized)
        try:
            return _root_path_from_fd(fd)
        finally:
            os.close(fd)
    finally:
        os.close(root_fd)


def resolve_workspace_root(
    base_root: Path,
    workspace_id: str | None,
    *,
    single_mode: bool,
) -> Path:
    """Resolve a workspace root under a configured base root."""

    resolved_base = Path(base_root).resolve()
    normalized_id = str(workspace_id or "").strip()
    if single_mode or not normalized_id:
        return resolved_base

    if Path(normalized_id).is_absolute() or "/" in normalized_id or "\\" in normalized_id:
        raise ValueError(f"Workspace path traversal detected: {workspace_id}")

    resolved = resolve_path_beneath(resolved_base, normalized_id)
    if not resolved.is_relative_to(resolved_base):
        raise ValueError(f"Workspace path traversal detected: {workspace_id}")
    return resolved
