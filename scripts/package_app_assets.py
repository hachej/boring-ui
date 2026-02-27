#!/usr/bin/env python3
"""Shared boring-ui helper to build frontend and stage runtime web assets."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
from pathlib import Path


def _run(cmd: list[str], *, cwd: Path) -> None:
    subprocess.run(cmd, cwd=str(cwd), check=True)


def _clear_dir(dst: Path) -> None:
    dst.mkdir(parents=True, exist_ok=True)
    for child in dst.iterdir():
        if child.name == ".gitkeep":
            continue
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()


def _copy_tree(src: Path, dst: Path) -> None:
    _clear_dir(dst)
    for child in src.iterdir():
        target = dst / child.name
        if child.is_dir():
            shutil.copytree(child, target)
        else:
            shutil.copy2(child, target)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build app frontend and stage wheel runtime assets."
    )
    parser.add_argument(
        "--frontend-dir",
        required=True,
        help="Path to app frontend directory containing package.json",
    )
    parser.add_argument(
        "--static-dir",
        required=True,
        help="Path to destination static asset directory",
    )
    parser.add_argument(
        "--companion-source",
        default="",
        help="Optional source companion launcher script path",
    )
    parser.add_argument(
        "--companion-target",
        default="",
        help="Optional target path for copied companion launcher script",
    )
    parser.add_argument(
        "--skip-npm-install",
        action="store_true",
        help="Skip npm install before frontend build",
    )
    args = parser.parse_args()

    frontend_dir = Path(args.frontend_dir).resolve()
    static_dir = Path(args.static_dir).resolve()

    if not (frontend_dir / "package.json").is_file():
        raise SystemExit(f"Missing package.json in frontend dir: {frontend_dir}")

    skip_install = args.skip_npm_install or (
        os.environ.get("BM_SKIP_NPM_INSTALL", "0").strip() == "1"
    )
    if not skip_install:
        _run(["npm", "install"], cwd=frontend_dir)
    _run(["npm", "run", "build"], cwd=frontend_dir)

    dist_dir = frontend_dir / "dist"
    if not dist_dir.is_dir():
        raise SystemExit(f"Frontend build did not produce dist/: {dist_dir}")
    _copy_tree(dist_dir, static_dir)
    print(f"[boring-ui package helper] staged static assets: {dist_dir} -> {static_dir}")

    if args.companion_source or args.companion_target:
        if not args.companion_source or not args.companion_target:
            raise SystemExit(
                "Both --companion-source and --companion-target are required together."
            )
        companion_source = Path(args.companion_source).resolve()
        companion_target = Path(args.companion_target).resolve()
        if not companion_source.is_file():
            raise SystemExit(f"Missing companion source launcher: {companion_source}")
        companion_target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(companion_source, companion_target)
        companion_target.chmod(0o755)
        print(
            f"[boring-ui package helper] staged companion launcher: "
            f"{companion_source} -> {companion_target}"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
