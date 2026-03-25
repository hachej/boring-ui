from __future__ import annotations

from argparse import Namespace
from pathlib import Path

from tests.smoke import run_all


def test_build_auth_args_includes_public_origin_and_recipient() -> None:
    auth_args = run_all.build_auth_args(
        Namespace(
            auth_mode="neon",
            neon_auth_url="https://neon.example.com",
            skip_signup=True,
            email="user@example.com",
            password="password123",
            recipient="qa@example.com",
            public_origin="https://app.example.com",
            timeout=45,
        )
    )

    assert auth_args == [
        "--auth-mode",
        "neon",
        "--neon-auth-url",
        "https://neon.example.com",
        "--skip-signup",
        "--email",
        "user@example.com",
        "--password",
        "password123",
        "--recipient",
        "qa@example.com",
        "--public-origin",
        "https://app.example.com",
        "--timeout",
        "45",
    ]


def test_main_resolves_evidence_dir_before_running_suites(monkeypatch, tmp_path: Path) -> None:
    captured: dict[str, object] = {}

    def fake_run_suite(
        *,
        name,
        script,
        base_url,
        auth_args,
        requires_auth,
        extra_args,
        evidence_dir,
        timeout_s,
    ):
        captured["name"] = name
        captured["script"] = script
        captured["base_url"] = base_url
        captured["evidence_dir"] = evidence_dir
        captured["timeout_s"] = timeout_s
        return run_all.SuiteResult(name=name, exit_code=0, elapsed_s=0.1)

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(run_all, "run_suite", fake_run_suite)
    monkeypatch.setattr(
        "sys.argv",
        [
            "run_all.py",
            "--base-url",
            "http://127.0.0.1:9999",
            "--suites",
            "health",
            "--evidence-dir",
            "relative-evidence",
        ],
    )

    exit_code = run_all.main()

    assert exit_code == 0
    assert captured["name"] == "health"
    assert captured["base_url"] == "http://127.0.0.1:9999"
    assert captured["evidence_dir"] == (tmp_path / "relative-evidence").resolve()
    assert (tmp_path / "relative-evidence" / "summary.json").exists()


def test_main_forwards_public_origin_and_recipient_to_neon_auth_suite(
    monkeypatch,
    tmp_path: Path,
) -> None:
    captured: dict[str, object] = {}

    def fake_run_suite(
        *,
        name,
        script,
        base_url,
        auth_args,
        requires_auth,
        extra_args,
        evidence_dir,
        timeout_s,
    ):
        captured["name"] = name
        captured["extra_args"] = extra_args
        captured["requires_auth"] = requires_auth
        return run_all.SuiteResult(name=name, exit_code=0, elapsed_s=0.1)

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(run_all, "run_suite", fake_run_suite)
    monkeypatch.setattr(
        "sys.argv",
        [
            "run_all.py",
            "--base-url",
            "https://api.example.com",
            "--suites",
            "neon-auth",
            "--skip-signup",
            "--email",
            "user@example.com",
            "--password",
            "password123",
            "--recipient",
            "qa@example.com",
            "--public-origin",
            "https://app.example.com",
        ],
    )

    exit_code = run_all.main()

    assert exit_code == 0
    assert captured["name"] == "neon-auth"
    assert captured["requires_auth"] is False
    assert captured["extra_args"] == [
        "--skip-signup",
        "--email",
        "user@example.com",
        "--password",
        "password123",
        "--recipient",
        "qa@example.com",
        "--public-origin",
        "https://app.example.com",
        "--timeout",
        "180",
    ]
