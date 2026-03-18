"""Unit tests for shared workspace path safety helpers."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi import HTTPException

from boring_ui.api.config import APIConfig
from boring_ui.api.modules.files.service import FileService
from boring_ui.api.sandbox.nsjail import NsjailBackend
from boring_ui.api.sandbox.validated_exec import ValidatedExecBackend
from boring_ui.api.storage import LocalStorage
from boring_ui.api.workspace.paths import openat2_available, resolve_path_beneath, safe_open


def _symlinks_supported() -> bool:
    return hasattr(os, "symlink")


def test_openat2_available_returns_bool() -> None:
    assert isinstance(openat2_available(), bool)


def test_safe_open_reads_existing_file(tmp_path: Path) -> None:
    note = tmp_path / "note.txt"
    note.write_text("hello", encoding="utf-8")

    root_fd = os.open(tmp_path, os.O_RDONLY)
    try:
        file_fd = safe_open(root_fd, "note.txt")
        with os.fdopen(file_fd, "r", encoding="utf-8") as handle:
            assert handle.read() == "hello"
    finally:
        os.close(root_fd)


def test_safe_open_rejects_traversal(tmp_path: Path) -> None:
    root_fd = os.open(tmp_path, os.O_RDONLY)
    try:
        with pytest.raises(ValueError, match="traversal"):
            safe_open(root_fd, "../escape.txt")
    finally:
        os.close(root_fd)


@pytest.mark.skipif(not _symlinks_supported(), reason="Symlink creation not supported")
def test_resolve_path_beneath_fallback_rejects_symlink_escape(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    outside = tmp_path.parent / "outside-path-safety"
    outside.mkdir(exist_ok=True)
    link = tmp_path / "escape"
    link.symlink_to(outside, target_is_directory=True)

    monkeypatch.setattr("boring_ui.api.workspace.paths.openat2_available", lambda: False)

    try:
        with pytest.raises(ValueError, match="traversal"):
            resolve_path_beneath(tmp_path, "escape/secret.txt")
    finally:
        if link.exists() or link.is_symlink():
            link.unlink()
        outside.rmdir()


@pytest.mark.skipif(not _symlinks_supported(), reason="Symlink creation not supported")
def test_file_service_rejects_symlink_escape_on_write(tmp_path: Path) -> None:
    outside = tmp_path.parent / "outside-file-service"
    outside.mkdir(exist_ok=True)
    link = tmp_path / "linked"
    link.symlink_to(outside, target_is_directory=True)

    service = FileService(APIConfig(workspace_root=tmp_path), LocalStorage(tmp_path))

    try:
        with pytest.raises(HTTPException) as exc_info:
            service.write_file("linked/escape.txt", "nope")
        assert exc_info.value.status_code == 400
        assert "traversal" in exc_info.value.detail.lower()
    finally:
        if link.exists() or link.is_symlink():
            link.unlink()
        outside.rmdir()


@pytest.mark.skipif(not _symlinks_supported(), reason="Symlink creation not supported")
def test_validated_exec_backend_rejects_symlink_escape_cwd(tmp_path: Path) -> None:
    outside = tmp_path.parent / "outside-validated-exec"
    outside.mkdir(exist_ok=True)
    link = tmp_path / "linked"
    link.symlink_to(outside, target_is_directory=True)

    backend = ValidatedExecBackend()

    try:
        with pytest.raises(ValueError, match="traversal"):
            backend._resolve_working_dir(tmp_path, "linked")
    finally:
        if link.exists() or link.is_symlink():
            link.unlink()
        outside.rmdir()


@pytest.mark.skipif(not _symlinks_supported(), reason="Symlink creation not supported")
def test_nsjail_backend_rejects_symlink_escape_cwd(tmp_path: Path) -> None:
    outside = tmp_path.parent / "outside-nsjail"
    outside.mkdir(exist_ok=True)
    link = tmp_path / "linked"
    link.symlink_to(outside, target_is_directory=True)

    backend = NsjailBackend()

    try:
        with pytest.raises(ValueError, match="traversal"):
            backend._resolve_working_dir(tmp_path, "linked")
    finally:
        if link.exists() or link.is_symlink():
            link.unlink()
        outside.rmdir()
