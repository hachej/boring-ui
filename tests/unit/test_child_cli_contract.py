"""Child CLI contract coverage for nsjail-backed agents."""

from __future__ import annotations

from pathlib import Path

from boring_ui.api.sandbox.nsjail import NsjailBackend


def _readonly_mounts(invocation: list[str]) -> list[str]:
    mounts: list[str] = []
    for index, value in enumerate(invocation):
        if value == "--bindmount_ro":
            mounts.append(invocation[index + 1])
    return mounts


def test_nsjail_invocation_mounts_path_entries_for_child_cli(
    tmp_path: Path,
    monkeypatch,
) -> None:
    child_cli_dir = tmp_path / "child-cli-bin"
    child_cli_dir.mkdir()
    tools_dir = tmp_path / "tool-bin"
    tools_dir.mkdir()
    stdlib_dir = tmp_path / "stdlib"
    stdlib_dir.mkdir()
    site_packages_dir = tmp_path / "site-packages"
    site_packages_dir.mkdir()
    pip_local_dir = tmp_path / ".pip-local"
    pip_local_dir.mkdir()

    monkeypatch.setenv("PATH", f"{child_cli_dir}:{tools_dir}")

    backend = NsjailBackend(
        python_stdlib=stdlib_dir,
        python_site_packages=site_packages_dir,
    )
    invocation = backend._build_invocation(
        nsjail="/usr/bin/nsjail",
        workspace_root=tmp_path,
        pip_packages_dir=pip_local_dir,
        inside_cwd=Path("/workspace"),
        env={},
        command=None,
        argv=["bm", "help"],
        timeout_seconds=30,
    )

    assert "--disable_proc" in invocation
    readonly_mounts = _readonly_mounts(invocation)
    assert f"{child_cli_dir}:{child_cli_dir}" in readonly_mounts
    assert f"{tools_dir}:{tools_dir}" in readonly_mounts
    assert f"{stdlib_dir}:{stdlib_dir}" in readonly_mounts
