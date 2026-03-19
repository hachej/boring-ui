#!/usr/bin/env python3
"""Unified smoke test runner for boring-ui and child apps.

Runs all applicable smoke suites in sequence, sharing auth credentials
to avoid redundant signups. Reports aggregate pass/fail.

Usage:
    # Run all boring-ui base smokes against local dev server
    python tests/smoke/run_all.py --base-url http://localhost:8000 --auth-mode dev

    # Run against staging with Neon auth (skip signup, use existing account)
    python tests/smoke/run_all.py --base-url https://... --auth-mode neon --skip-signup --email ... --password ...

    # Run specific suites only
    python tests/smoke/run_all.py --base-url https://... --suites health,capabilities,filesystem

    # Include backend-agent WS verification explicitly
    python tests/smoke/run_all.py --base-url https://... --include-agent-ws

    # Child apps: add extra suites via --extra-suites
    python tests/smoke/run_all.py --base-url https://... --extra-suites /path/to/smoke_macro.py
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

SMOKE_DIR = Path(__file__).resolve().parent

# Base boring-ui smoke suites in execution order.
# Each entry: (name, script_filename, requires_auth, extra_args)
BASE_SUITES: list[tuple[str, str, bool, list[str]]] = [
    ("health",              "smoke_health.py",              False, []),
    ("capabilities",        "smoke_capabilities.py",        False, []),
    ("neon-auth",           "smoke_neon_auth.py",           True,  []),
    ("workspace-lifecycle", "smoke_workspace_lifecycle.py", True,  []),
    ("filesystem",          "smoke_filesystem.py",          True,  []),
    ("settings",            "smoke_settings.py",            True,  []),
    ("ui-state",            "smoke_ui_state.py",            True,  []),
    ("git-sync",            "smoke_git_sync.py",            True,  []),
]

OPTIONAL_SUITES: list[tuple[str, str, bool, list[str]]] = [
    ("agent-ws", "smoke_agent_ws.py", True, []),
]


@dataclass
class SuiteResult:
    name: str
    exit_code: int
    elapsed_s: float
    output: str = ""

    @property
    def ok(self) -> bool:
        return self.exit_code == 0


def build_auth_args(args: argparse.Namespace) -> list[str]:
    """Build common auth CLI args from parsed args."""
    auth_args: list[str] = []
    if hasattr(args, "auth_mode") and args.auth_mode:
        auth_args.extend(["--auth-mode", args.auth_mode])
    if hasattr(args, "neon_auth_url") and args.neon_auth_url:
        auth_args.extend(["--neon-auth-url", args.neon_auth_url])
    if args.skip_signup:
        auth_args.append("--skip-signup")
    if args.email:
        auth_args.extend(["--email", args.email])
    if args.password:
        auth_args.extend(["--password", args.password])
    if hasattr(args, "recipient") and args.recipient:
        auth_args.extend(["--recipient", args.recipient])
    if hasattr(args, "timeout") and args.timeout:
        auth_args.extend(["--timeout", str(args.timeout)])
    return auth_args


def run_suite(
    name: str,
    script: str,
    base_url: str,
    auth_args: list[str],
    requires_auth: bool,
    extra_args: list[str],
    evidence_dir: Path | None,
    timeout_s: int = 300,
) -> SuiteResult:
    """Run a single smoke suite as a subprocess."""
    cmd = [sys.executable, script, "--base-url", base_url]
    if requires_auth:
        cmd.extend(auth_args)
    if evidence_dir:
        cmd.extend(["--evidence-out", str(evidence_dir / f"{name}.json")])
    cmd.extend(extra_args)

    print(f"\n{'='*60}")
    print(f"  SUITE: {name}")
    print(f"  CMD: {' '.join(cmd)}")
    print(f"{'='*60}")

    t0 = time.monotonic()
    try:
        result = subprocess.run(
            cmd,
            capture_output=False,
            text=True,
            timeout=timeout_s,
            cwd=str(SMOKE_DIR),
        )
        elapsed = time.monotonic() - t0
        return SuiteResult(name=name, exit_code=result.returncode, elapsed_s=elapsed)
    except subprocess.TimeoutExpired:
        elapsed = time.monotonic() - t0
        print(f"[runner] TIMEOUT: {name} exceeded {timeout_s}s")
        return SuiteResult(name=name, exit_code=124, elapsed_s=elapsed, output="TIMEOUT")
    except Exception as exc:
        elapsed = time.monotonic() - t0
        print(f"[runner] ERROR: {name}: {exc}")
        return SuiteResult(name=name, exit_code=1, elapsed_s=elapsed, output=str(exc))


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--auth-mode", choices=["neon", "dev"], default="neon")
    parser.add_argument("--neon-auth-url", default="")
    parser.add_argument("--skip-signup", action="store_true")
    parser.add_argument("--email")
    parser.add_argument("--password")
    parser.add_argument("--recipient")
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--suite-timeout", type=int, default=300,
                        help="Max seconds per suite (default: 300)")
    parser.add_argument("--suites", default="",
                        help="Comma-separated suite names to run (default: all)")
    parser.add_argument("--skip-suites", default="",
                        help="Comma-separated suite names to skip")
    parser.add_argument("--include-agent-ws", action="store_true",
                        help="Include backend-agent WS smoke (not part of default core path)")
    parser.add_argument("--extra-suites", default="",
                        help="Comma-separated paths to extra smoke scripts (child app tests)")
    parser.add_argument("--evidence-dir", default="",
                        help="Directory for per-suite evidence JSON files")
    parser.add_argument("--expect-auth", default="",
                        help="Pass --expect-auth to capabilities suite")
    parser.add_argument("--expect-features", default="",
                        help="Pass --expect-features to capabilities suite")
    parser.add_argument("--expect-routers", default="",
                        help="Pass --expect-routers to capabilities suite")
    parser.add_argument("--fail-fast", action="store_true",
                        help="Stop on first suite failure")
    args = parser.parse_args()

    # Resolve suites to run
    selected = set(s.strip() for s in args.suites.split(",") if s.strip()) if args.suites else None
    skipped = set(s.strip() for s in args.skip_suites.split(",") if s.strip())

    suite_catalog = list(BASE_SUITES)
    if args.include_agent_ws or (selected and "agent-ws" in selected):
        suite_catalog.extend(OPTIONAL_SUITES)

    suites: list[tuple[str, str, bool, list[str]]] = []
    for name, script, requires_auth, extra in suite_catalog:
        if selected and name not in selected:
            continue
        if name in skipped:
            continue
        # Special handling for suites that need specific args
        suite_extra = list(extra)
        if name == "capabilities":
            if args.expect_auth:
                suite_extra.extend(["--expect-auth", args.expect_auth])
            if args.expect_features:
                suite_extra.extend(["--expect-features", args.expect_features])
            if args.expect_routers:
                suite_extra.extend(["--expect-routers", args.expect_routers])
        if name == "neon-auth":
            # neon-auth has its own auth handling, pass email/password directly
            requires_auth = False
            if args.skip_signup:
                suite_extra.append("--skip-signup")
            if args.email:
                suite_extra.extend(["--email", args.email])
            if args.password:
                suite_extra.extend(["--password", args.password])
            if args.neon_auth_url:
                suite_extra.extend(["--neon-auth-url", args.neon_auth_url])
            if args.timeout:
                suite_extra.extend(["--timeout", str(args.timeout)])
            # Skip neon-auth suite for non-neon auth modes
            if args.auth_mode != "neon":
                continue
        suites.append((name, str(SMOKE_DIR / script), requires_auth, suite_extra))

    # Add extra suites (child app tests).
    # Extra suites don't receive auth args — they handle auth themselves or don't need it.
    if args.extra_suites:
        for path_str in args.extra_suites.split(","):
            path = Path(path_str.strip()).resolve()
            if path.is_file():
                name = path.stem.replace("smoke_", "").replace("_", "-")
                suites.append((name, str(path), False, []))
            else:
                print(f"[runner] WARN: extra suite not found: {path}")

    evidence_dir = Path(args.evidence_dir) if args.evidence_dir else None
    if evidence_dir:
        evidence_dir.mkdir(parents=True, exist_ok=True)

    auth_args = build_auth_args(args)
    results: list[SuiteResult] = []

    print(f"\n{'#'*60}")
    print(f"  BORING-UI SMOKE RUNNER")
    print(f"  Target: {args.base_url}")
    print(f"  Auth: {args.auth_mode}")
    print(f"  Suites: {[s[0] for s in suites]}")
    print(f"{'#'*60}")

    for name, script, requires_auth, extra in suites:
        result = run_suite(
            name=name,
            script=script,
            base_url=args.base_url,
            auth_args=auth_args,
            requires_auth=requires_auth,
            extra_args=extra,
            evidence_dir=evidence_dir,
            timeout_s=args.suite_timeout,
        )
        results.append(result)
        if not result.ok and args.fail_fast:
            print(f"\n[runner] FAIL-FAST: stopping after {name}")
            break

    # Summary
    passed = [r for r in results if r.ok]
    failed = [r for r in results if not r.ok]
    total_time = sum(r.elapsed_s for r in results)

    print(f"\n{'#'*60}")
    print(f"  SMOKE RUNNER SUMMARY")
    print(f"{'#'*60}")
    for r in results:
        status = "PASS" if r.ok else "FAIL"
        print(f"  [{status}] {r.name:25s} ({r.elapsed_s:.1f}s)")
    print(f"\n  {len(passed)}/{len(results)} suites passed ({total_time:.1f}s total)")

    if evidence_dir:
        summary = {
            "ok": len(failed) == 0,
            "base_url": args.base_url,
            "auth_mode": args.auth_mode,
            "total_suites": len(results),
            "passed": len(passed),
            "failed": len(failed),
            "total_time_s": round(total_time, 1),
            "suites": [
                {"name": r.name, "ok": r.ok, "elapsed_s": round(r.elapsed_s, 1)}
                for r in results
            ],
        }
        (evidence_dir / "summary.json").write_text(
            json.dumps(summary, indent=2) + "\n", encoding="utf-8"
        )

    if failed:
        print(f"\n  FAILED SUITES: {[r.name for r in failed]}", file=sys.stderr)
        return 1
    print(f"\n  ALL SUITES PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
