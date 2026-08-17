#!/usr/bin/env python3
from __future__ import annotations

import fcntl
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

MODULE_PATH = Path(__file__).with_name("scratch_guard.py")
spec = importlib.util.spec_from_file_location("scratch_guard", MODULE_PATH)
assert spec and spec.loader
scratch_guard = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = scratch_guard
spec.loader.exec_module(scratch_guard)


class FakeStatvfs:
    def __init__(self, files: int, free: int) -> None:
        self.f_files = files
        self.f_ffree = free


class ScratchGuardTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="scratch-guard-fixture-")
        self.base = Path(self.temp.name)
        self.root = self.base / "owned-root"
        scratch_guard.initialize_root(self.root)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def entry(self, name: str, heartbeat_age: int = 1_000) -> Path:
        return scratch_guard.initialize_entry(self.root, name, now=10_000 - heartbeat_age)

    def decisions(self, *, apply: bool = False, stale_seconds: int = 100):
        return scratch_guard.clean_root(
            self.root, stale_seconds=stale_seconds, apply=apply, now=10_000
        )

    def test_inode_threshold_above_and_below_configured_percentage(self) -> None:
        mounts = [scratch_guard.Mount(Path("/"), "ext4")]
        below, messages = scratch_guard.preflight(
            paths=[self.base], threshold=80, tmpdir=self.base, pnpm_store=self.base,
            mounts=mounts, statvfs=lambda _: FakeStatvfs(100, 21),
        )
        self.assertEqual([], below)
        self.assertTrue(any("79.00%" in line and line.startswith("OK") for line in messages))
        above, _ = scratch_guard.preflight(
            paths=[self.base], threshold=80, tmpdir=self.base, pnpm_store=self.base,
            mounts=mounts, statvfs=lambda _: FakeStatvfs(100, 20),
        )
        self.assertTrue(any("80.00%" in line and line.startswith("FAIL") for line in above))

    def test_tmpdir_mount_selection_uses_longest_mount_and_warns_on_tmpfs(self) -> None:
        tmpdir = self.base / "nested"
        tmpdir.mkdir()
        mounts = [
            scratch_guard.Mount(Path("/"), "ext4"),
            scratch_guard.Mount(self.base, "tmpfs"),
        ]
        failures, _ = scratch_guard.preflight(
            paths=[tmpdir], threshold=90, tmpdir=tmpdir, pnpm_store=None,
            mounts=mounts, statvfs=lambda _: FakeStatvfs(100, 90),
        )
        self.assertIn(f"FAIL TMPDIR {tmpdir} is on tmpfs", failures)

    def test_pnpm_store_on_tmpfs_is_a_failure(self) -> None:
        store = self.base / "pnpm"
        store.mkdir()
        failures, _ = scratch_guard.preflight(
            paths=[self.base], threshold=90, tmpdir=Path("/"), pnpm_store=store,
            mounts=[scratch_guard.Mount(Path("/"), "ext4"), scratch_guard.Mount(self.base, "tmpfs")],
            statvfs=lambda _: FakeStatvfs(100, 90),
        )
        self.assertTrue(any("pnpm store" in line and "tmpfs" in line for line in failures))

    def test_dry_run_reports_but_does_not_delete(self) -> None:
        entry = self.entry("stale")
        result = self.decisions()
        self.assertEqual("would-delete", result[0].action)
        self.assertTrue(entry.exists())

    def test_stale_marked_unlocked_entry_is_deleted_on_apply(self) -> None:
        entry = self.entry("stale")
        result = self.decisions(apply=True)
        self.assertEqual("deleted", result[0].action)
        self.assertFalse(entry.exists())

    def test_active_lock_is_retained(self) -> None:
        entry = self.entry("active-lock")
        with (entry / scratch_guard.LOCK_FILE).open("r+") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_SH | fcntl.LOCK_NB)
            result = self.decisions(apply=True)
        self.assertEqual("retain", result[0].action)
        self.assertIn("active lock", result[0].reason)
        self.assertTrue(entry.exists())

    def test_live_heartbeat_is_retained(self) -> None:
        entry = self.entry("live", heartbeat_age=99)
        result = self.decisions(apply=True, stale_seconds=100)
        self.assertEqual("retain", result[0].action)
        self.assertIn("heartbeat live", result[0].reason)
        self.assertTrue(entry.exists())

    def test_malformed_and_ambiguous_markers_are_retained(self) -> None:
        malformed = self.root / "malformed"
        malformed.mkdir()
        (malformed / scratch_guard.ENTRY_MARKER).write_text("not json")
        ambiguous = self.entry("ambiguous")
        marker = json.loads((ambiguous / scratch_guard.ENTRY_MARKER).read_text())
        marker["extra"] = "not allowed"
        (ambiguous / scratch_guard.ENTRY_MARKER).write_text(json.dumps(marker))
        results = self.decisions(apply=True)
        self.assertEqual(["retain", "retain"], [result.action for result in results])
        self.assertTrue(malformed.exists())
        self.assertTrue(ambiguous.exists())

    def test_symlink_entry_and_nested_path_escape_are_retained(self) -> None:
        outside = self.base / "outside"
        outside.mkdir()
        symlink_entry = self.root / "entry-link"
        symlink_entry.symlink_to(outside, target_is_directory=True)
        nested = self.entry("nested-link")
        (nested / "escape").symlink_to(outside, target_is_directory=True)
        results = {result.path.name: result for result in self.decisions(apply=True)}
        self.assertEqual("retain", results["entry-link"].action)
        self.assertEqual("retain", results["nested-link"].action)
        self.assertTrue(outside.exists())
        self.assertTrue(nested.exists())


    def test_same_device_nested_mount_boundary_is_retained(self) -> None:
        entry = self.entry("mounted")
        mounted_path = entry / "bind-target"
        result = scratch_guard.clean_root(
            self.root, stale_seconds=100, apply=True, now=10_000,
            mounts=[scratch_guard.Mount(mounted_path, "ext4")],
        )[0]
        self.assertEqual("retain", result.action)
        self.assertIn("mounted path boundary", result.reason)
        self.assertTrue(entry.exists())

    def test_dry_run_refuses_when_mount_identity_is_unavailable(self) -> None:
        entry = self.entry("portable")
        with mock.patch.object(
            scratch_guard, "_fd_mount_id", side_effect=scratch_guard.SafetyError("unavailable")
        ):
            with self.assertRaisesRegex(scratch_guard.SafetyError, "unavailable"):
                self.decisions(apply=False)
        self.assertTrue(entry.exists())


    def test_heartbeat_change_at_mutation_boundary_is_retained(self) -> None:
        entry = self.entry("heartbeat-race")
        real_decision = scratch_guard._entry_decision

        def change_heartbeat(*args, **kwargs):
            decision, evidence = real_decision(*args, **kwargs)
            if evidence is not None:
                os.utime(entry / scratch_guard.HEARTBEAT_FILE, (9_950, 9_950))
            return decision, evidence

        with mock.patch.object(scratch_guard, "_entry_decision", side_effect=change_heartbeat):
            result = self.decisions(apply=True)[0]
        self.assertEqual("retain", result.action)
        self.assertIn("heartbeat changed", result.reason)
        self.assertTrue(entry.exists())

    def test_entry_inode_swap_at_mutation_boundary_is_retained(self) -> None:
        entry = self.entry("swap")
        real_stat = scratch_guard.os.stat

        def changed_stat(path, *args, **kwargs):
            result = real_stat(path, *args, **kwargs)
            if path == "swap" and kwargs.get("dir_fd") is not None:
                values = list(result)
                values[1] += 1
                return os.stat_result(values)
            return result

        with mock.patch.object(scratch_guard.os, "stat", side_effect=changed_stat):
            result = self.decisions(apply=True)[0]
        self.assertEqual("retain", result.action)
        self.assertIn("entry directory changed", result.reason)
        self.assertTrue(entry.exists())



    def test_staging_cleanup_retains_replacement_directory(self) -> None:
        staging = self.base / ".staging"
        staging.mkdir()
        staging_st = staging.lstat()
        identity = (staging_st.st_dev, staging_st.st_ino)
        original = self.base / "original-staging"
        staging.rename(original)
        staging.mkdir()
        sentinel = staging / "sentinel"
        sentinel.write_text("replacement")
        scratch_guard._discard_private_staging(staging, identity)
        self.assertEqual("replacement", sentinel.read_text())
        self.assertTrue(original.exists())

    def test_mountinfo_decodes_all_octal_escapes(self) -> None:
        mounts = scratch_guard.parse_mountinfo(
            ["1 0 0:1 / /mnt/space\\040tab\\011newline\\012slash\\134 rw - tmpfs tmpfs rw\n"]
        )
        self.assertEqual(
            Path("/mnt/space tab\tnewline\nslash\\"), mounts[0].point
        )

    def test_atomic_publication_never_clobbers_existing_directory(self) -> None:
        source = self.base / "publication-source"
        target = self.base / "publication-target"
        source.mkdir()
        target.mkdir()
        sentinel = target / "sentinel"
        sentinel.write_text("preserve")
        with self.assertRaises(FileExistsError):
            scratch_guard._rename_noreplace(source, target)
        self.assertTrue(source.exists())
        self.assertEqual("preserve", sentinel.read_text())


    def test_init_root_loses_race_without_clobbering_competitor(self) -> None:
        target = self.base / "raced-root"
        real_rename = scratch_guard._rename_noreplace

        def competitor_wins(source, destination):
            destination.mkdir()
            (destination / "sentinel").write_text("competitor")
            real_rename(source, destination)

        with mock.patch.object(scratch_guard, "_rename_noreplace", side_effect=competitor_wins):
            with self.assertRaises(FileExistsError):
                scratch_guard.initialize_root(target)
        self.assertEqual("competitor", (target / "sentinel").read_text())
        self.assertEqual([], list(self.base.glob(".raced-root.boring-init-*")))

    def test_failed_initialization_removes_private_staging_and_allows_retry(self) -> None:
        target = self.base / "atomic-root"
        original = Path.write_text

        def fail_marker(path, *args, **kwargs):
            if path.name == scratch_guard.ROOT_MARKER:
                raise OSError("fixture write failure")
            return original(path, *args, **kwargs)

        with mock.patch.object(Path, "write_text", autospec=True, side_effect=fail_marker):
            with self.assertRaisesRegex(OSError, "fixture write failure"):
                scratch_guard.initialize_root(target)
        self.assertFalse(target.exists())
        self.assertEqual([], list(self.base.glob(".atomic-root.boring-init-*")))
        scratch_guard.initialize_root(target)
        self.assertTrue(target.is_dir())

    def test_unrelated_paths_are_preserved(self) -> None:
        unrelated = self.root / "notes.txt"
        unrelated.write_text("operator data")
        result = self.decisions(apply=True)[0]
        self.assertEqual("retain", result.action)
        self.assertEqual("operator data", unrelated.read_text())

    def test_apply_is_idempotent(self) -> None:
        self.entry("once")
        first = self.decisions(apply=True)
        second = self.decisions(apply=True)
        self.assertEqual("deleted", first[0].action)
        self.assertEqual([], second)

    def test_root_must_be_private_canonical_and_marked(self) -> None:
        unmarked = self.base / "unmarked"
        unmarked.mkdir(mode=0o700)
        with self.assertRaisesRegex(scratch_guard.SafetyError, "marker"):
            scratch_guard.clean_root(unmarked, stale_seconds=100, apply=False)
        linked = self.base / "linked"
        linked.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(scratch_guard.SafetyError, "symlink"):
            scratch_guard.clean_root(linked, stale_seconds=100, apply=False)

    def test_exact_documented_install_and_check_commands_validate(self) -> None:
        repo = MODULE_PATH.parents[2]
        doc = (repo / "docs/factory/scratch-guard.md").read_text()
        self.assertIn("install -m 0755 ops/factory-scratch/scratch_guard.py", doc)
        self.assertIn("scratch-guard check --path", doc)
        installed = self.base / "bin" / "scratch-guard"
        installed.parent.mkdir()
        install_run = subprocess.run(
            ["install", "-m", "0755", str(MODULE_PATH), str(installed)],
            cwd=repo, check=False, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
        self.assertEqual(0, install_run.returncode, install_run.stdout)
        self.assertEqual(0o755, stat.S_IMODE(installed.stat().st_mode))
        check_run = subprocess.run(
            [str(installed), "check", "--path", str(self.base),
             "--inode-threshold", "100", "--tmpdir", str(self.base),
             "--pnpm-store", str(self.base)],
            cwd=repo, check=False, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
        self.assertEqual(0, check_run.returncode, check_run.stdout)
        self.assertIn("inode usage", check_run.stdout)
        cli_root = self.base / "cli-root"
        init_root_run = subprocess.run(
            [str(installed), "init-root", str(cli_root)], check=False, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
        self.assertEqual(0, init_root_run.returncode, init_root_run.stdout)
        init_entry_run = subprocess.run(
            [str(installed), "init-entry", str(cli_root), "documented-run"],
            check=False, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
        self.assertEqual(0, init_entry_run.returncode, init_entry_run.stdout)
        cli_entry = cli_root / "documented-run"
        (cli_entry / "tmp").mkdir()
        os.utime(cli_entry / scratch_guard.HEARTBEAT_FILE, (1, 1))
        dry_run = subprocess.run(
            [str(installed), "clean", "--root", str(cli_root), "--stale-seconds", "1"],
            check=False, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
        self.assertEqual(0, dry_run.returncode, dry_run.stdout)
        self.assertIn("WOULD-DELETE", dry_run.stdout)
        self.assertTrue(cli_entry.exists())
        help_run = subprocess.run(
            [str(installed), "check", "--help"], cwd=repo,
            check=False, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
        self.assertEqual(0, help_run.returncode, help_run.stdout)
        self.assertIn("--inode-threshold", help_run.stdout)
        self.assertIn("--pnpm-store", help_run.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
