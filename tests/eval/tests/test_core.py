"""Unit tests for Phase 2 core modules: prompt, parsing, redaction, introspection.

Run with: python3 -m pytest tests/eval/tests/test_core.py -v
"""

from __future__ import annotations

import asyncio
import json
import signal
import tempfile
from pathlib import Path
from types import SimpleNamespace

import pytest

import tests.eval.eval_child_app as eval_child_app_module
import tests.eval.introspection as introspection_module
from tests.eval.agent_prompt import generate_prompt, save_prompt
from tests.eval.contracts import NamingContract, ObservedCommand, RunManifest
from tests.eval.eval_child_app import _default_agent_runner
from tests.eval.introspection import (
    build_manifest_from_facts,
    discover_platform_facts,
    validate_against_manifest,
)
from tests.eval.parsing import (
    extract_bui_commands,
    extract_deployed_url,
    extract_fly_app_name,
    extract_neon_project_id,
    extract_report_json,
    extract_vault_refs_from_report,
)
from tests.eval.reason_codes import CheckStatus
from tests.eval.redaction import (
    FORBIDDEN_HEADERS,
    SAFE_HEADERS,
    SecretRegistry,
    redact_headers,
)
from tests.eval.report_schema import BEGIN_MARKER, END_MARKER
from tests.eval.runners.base import MockRunner, RunResult, SubprocessRunner
from tests.eval.runners.mock import MockRunner as FixtureMockRunner


# ===================================================================
# agent_prompt.py tests
# ===================================================================


class TestAgentPrompt:
    def test_generate_contains_eval_id(self, sample_manifest):
        prompt = generate_prompt(sample_manifest)
        assert sample_manifest.eval_id in prompt

    def test_generate_contains_nonce(self, sample_manifest):
        prompt = generate_prompt(sample_manifest)
        assert sample_manifest.verification_nonce in prompt

    def test_generate_contains_app_slug(self, sample_manifest):
        prompt = generate_prompt(sample_manifest)
        assert sample_manifest.app_slug in prompt

    def test_generate_contains_markers(self, sample_manifest):
        prompt = generate_prompt(sample_manifest)
        assert BEGIN_MARKER in prompt
        assert END_MARKER in prompt

    def test_generate_report_shape_includes_required_schema_fields(self, sample_manifest):
        prompt = generate_prompt(sample_manifest)
        assert '"eval_spec_version": "0.1.0"' in prompt
        assert '"report_schema_version": "0.1.0"' in prompt
        assert f'"python_module": "{sample_manifest.python_module}"' in prompt
        assert '"platform_profile": "core"' in prompt

    def test_generate_contains_bui_help(self, sample_manifest):
        prompt = generate_prompt(sample_manifest)
        assert "bui --help" in prompt

    def test_generate_keeps_prompt_minimal(self, sample_manifest):
        prompt = generate_prompt(sample_manifest)
        assert "I want a boring-ui child app" in prompt
        assert "Do NOT modify" in prompt
        assert "Do NOT hardcode" not in prompt
        assert f"secret/agent/app/{sample_manifest.app_slug}/prod" not in prompt
        assert "The final deployed app must use Neon auth" not in prompt

    def test_generate_avoids_legacy_python_path_instructions(self, sample_manifest):
        prompt = generate_prompt(sample_manifest, profile="auth-plus")
        assert f"src/{sample_manifest.python_module}/routers/status.py" not in prompt
        assert f"src/{sample_manifest.python_module}/routers/notes.py" not in prompt
        assert "Use the shortest supported workflow" in prompt

    def test_generate_discourages_extra_repo_setup_and_manual_sweeps(self, sample_manifest):
        prompt = generate_prompt(sample_manifest)
        assert "git init" not in prompt
        assert "broad manual endpoint sweeps" in prompt

    def test_generate_deterministic(self, sample_manifest):
        p1 = generate_prompt(sample_manifest)
        p2 = generate_prompt(sample_manifest)
        assert p1 == p2

    def test_auth_plus_includes_whoami(self, sample_manifest):
        prompt = generate_prompt(sample_manifest, profile="auth-plus")
        assert "/whoami" in prompt
        assert "boring_session" in prompt

    def test_core_excludes_whoami(self, sample_manifest):
        prompt = generate_prompt(sample_manifest, profile="core")
        assert "/whoami" not in prompt

    def test_save_prompt(self, sample_manifest, tmp_evidence_dir):
        sample_manifest.evidence_dir = str(tmp_evidence_dir)
        prompt = generate_prompt(sample_manifest)
        path = save_prompt(sample_manifest, prompt)
        assert path.exists()
        assert path.read_text() == prompt

    def test_build_neon_local_dev_env_reads_app_scoped_vault_refs(self, tmp_path, monkeypatch):
        root = tmp_path / "demo"
        root.mkdir()
        (root / "boring.app.toml").write_text(
            """
[app]
name = "demo"
id = "demo"

[auth]
provider = "neon"

[deploy]
platform = "fly"

[deploy.secrets]
DATABASE_URL = { vault = "secret/agent/app/demo/prod", field = "database_url" }
BORING_UI_SESSION_SECRET = { vault = "secret/agent/app/demo/prod", field = "session_secret" }
BORING_SETTINGS_KEY = { vault = "secret/agent/app/demo/prod", field = "settings_key" }

[deploy.neon]
auth_url = "https://auth.example.test"
jwks_url = "https://auth.example.test/.well-known/jwks.json"
""",
            encoding="utf-8",
        )

        calls: list[list[str]] = []
        values = {
            "database_url": "postgres://demo",
            "session_secret": "session-secret",
            "settings_key": "settings-key",
        }

        def fake_run(cmd, capture_output, text, timeout, check):
            calls.append(cmd)
            field = cmd[3].split("=", 1)[1]
            return SimpleNamespace(returncode=0, stdout=values[field] + "\n", stderr="")

        monkeypatch.setattr(eval_child_app_module.subprocess, "run", fake_run)

        env = eval_child_app_module._build_neon_local_dev_env(root, 5176)

        assert env["DATABASE_URL"] == "postgres://demo"
        assert env["BORING_UI_SESSION_SECRET"] == "session-secret"
        assert env["BORING_SETTINGS_KEY"] == "settings-key"
        assert env["NEON_AUTH_BASE_URL"] == "https://auth.example.test"
        assert env["NEON_AUTH_JWKS_URL"] == "https://auth.example.test/.well-known/jwks.json"
        assert env["BORING_UI_PUBLIC_ORIGIN"] == "http://127.0.0.1:5176"
        assert calls == [
            ["vault", "kv", "get", "-field=database_url", "secret/agent/app/demo/prod"],
            ["vault", "kv", "get", "-field=session_secret", "secret/agent/app/demo/prod"],
            ["vault", "kv", "get", "-field=settings_key", "secret/agent/app/demo/prod"],
        ]

    def test_load_report_output_text_reads_report_file(self, sample_manifest, tmp_path):
        report_path = tmp_path / "report.json"
        report_path.write_text(f"{BEGIN_MARKER}\n{{\"ok\":true}}\n{END_MARKER}\n", encoding="utf-8")
        sample_manifest.report_output_path = str(report_path)

        text = eval_child_app_module._load_report_output_text(sample_manifest)

        assert BEGIN_MARKER in text
        assert END_MARKER in text

    def test_run_local_dev_validation_uses_process_group_and_file_backed_logs(self, sample_manifest, monkeypatch, tmp_path):
        root = tmp_path / sample_manifest.app_slug
        root.mkdir()
        sample_manifest.project_root = str(root)

        monkeypatch.setattr(
            eval_child_app_module,
            "_run_command_capture",
            lambda *args, **kwargs: asyncio.sleep(0, result=(0, "doctor ok", "")),
        )
        monkeypatch.setattr(eval_child_app_module, "_pick_trusted_local_auth_port", lambda: 5176)
        monkeypatch.setattr(eval_child_app_module, "_build_neon_local_dev_env", lambda *_args, **_kwargs: {})

        calls = {}

        class FakeProcess:
            def __init__(self):
                self.returncode = None
                self.pid = 43210

            async def wait(self):
                self.returncode = 0
                return 0

            def send_signal(self, _sig):
                raise AssertionError("expected process-group signaling instead of direct send_signal")

            def kill(self):
                raise AssertionError("expected process-group signaling instead of direct kill")

            async def communicate(self):
                raise AssertionError("communicate() should not be used for long-running bui dev")

        async def fake_create_subprocess_exec(*cmd, **kwargs):
            calls["cmd"] = cmd
            calls["start_new_session"] = kwargs.get("start_new_session")
            calls["stdout_is_pipe"] = kwargs.get("stdout") is asyncio.subprocess.PIPE
            calls["stderr_is_pipe"] = kwargs.get("stderr") is asyncio.subprocess.PIPE
            kwargs["stdout"].write(b"dev stdout line\n")
            kwargs["stderr"].write(b"dev stderr line\n")
            kwargs["stdout"].flush()
            kwargs["stderr"].flush()
            return FakeProcess()

        probe_counts = {"health": 0, "notes": 0}

        def fake_http_probe(url, timeout_s=3.0):
            if url.endswith("/health"):
                probe_counts["health"] += 1
                return 200, {
                    "ok": True,
                    "app": sample_manifest.app_slug,
                    "eval_id": sample_manifest.eval_id,
                    "verification_nonce": sample_manifest.verification_nonce,
                }
            if url.endswith("/info"):
                return 200, {"name": sample_manifest.app_slug, "version": "0.1.0", "eval_id": sample_manifest.eval_id}
            if url.endswith("/notes"):
                probe_counts["notes"] += 1
                return (200, [{"id": "note-1", "text": "hello", "created_at": "2026-03-26T00:00:00+00:00"}]) if probe_counts["notes"] == 1 else (200, [])
            if url.endswith("/__bui/config"):
                return 200, {"app": {"name": sample_manifest.app_slug, "logo": "C"}}
            if url.endswith("/api/capabilities"):
                return 200, {"features": {}, "routers": ["status"], "version": "0.1.0", "auth": {"provider": "neon"}}
            return None, None

        def fake_http_json_request(url, method="POST", payload=None, timeout_s=3.0):
            if url.endswith("/notes") and method == "POST":
                return 200, {"id": "note-1", "text": "hello", "created_at": "2026-03-26T00:00:00+00:00"}
            if "/notes/" in url and method == "DELETE":
                return 200, {"deleted": True}
            return None, None

        signaled = []

        monkeypatch.setattr(eval_child_app_module.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
        monkeypatch.setattr(eval_child_app_module, "_http_probe", fake_http_probe)
        monkeypatch.setattr(eval_child_app_module, "_http_json_request", fake_http_json_request)
        monkeypatch.setattr(eval_child_app_module, "_signal_subprocess_group", lambda process, sig: signaled.append((process.pid, sig)))

        ctx, _ = asyncio.run(eval_child_app_module._run_local_dev_validation(sample_manifest, timeout_s=1))

        assert calls["start_new_session"] is True
        assert calls["stdout_is_pipe"] is False
        assert calls["stderr_is_pipe"] is False
        assert ctx.dev_started is True
        assert "dev stdout line" in ctx.dev_stdout
        assert "dev stderr line" in ctx.dev_stderr
        assert signaled == [(43210, signal.SIGTERM)]


# ===================================================================
# parsing.py tests
# ===================================================================


class TestParsing:
    def _make_report(self, manifest, **overrides):
        report = {
            "eval_id": manifest.eval_id,
            "eval_spec_version": "0.1.0",
            "report_schema_version": "0.1.0",
            "platform_profile": "core",
            "verification_nonce": manifest.verification_nonce,
            "app_slug": manifest.app_slug,
            "project_root": manifest.project_root,
            "python_module": manifest.python_module,
            "deployed_url": f"https://{manifest.app_slug}.fly.dev",
            "fly_app_name": manifest.app_slug,
            "commands_run": ["bui init", "bui deploy"],
            "vault_secret_refs": [{"name": "KEY", "vault": "v", "field": "f"}],
            "known_issues": [],
        }
        report.update(overrides)
        return report

    def _wrap(self, report):
        return f"Output\n{BEGIN_MARKER}\n{json.dumps(report)}\n{END_MARKER}\nEnd"

    def test_extract_report_with_markers(self, sample_manifest):
        report = self._make_report(sample_manifest)
        text = self._wrap(report)
        result = extract_report_json(text)
        assert result is not None
        assert result["eval_id"] == sample_manifest.eval_id

    def test_extract_report_no_markers(self):
        assert extract_report_json("plain text") is None

    def test_extract_report_malformed_json(self):
        text = f"{BEGIN_MARKER}\n{{bad json\n{END_MARKER}"
        assert extract_report_json(text) is None

    def test_extract_report_from_appended_nested_json_without_markers(self, sample_manifest):
        report = self._make_report(
            sample_manifest,
            steps={"deploy": {"status": "succeeded", "attempted": True}},
            local_checks=[{"path": "/health", "status": 200}],
        )
        text = f"Human summary first\n\n{json.dumps(report, indent=2)}"
        result = extract_report_json(text)
        assert result is not None
        assert result["eval_id"] == sample_manifest.eval_id
        assert result["steps"]["deploy"]["status"] == "succeeded"

    def test_extract_deployed_url_from_report(self, sample_manifest):
        report = self._make_report(sample_manifest)
        text = self._wrap(report)
        url = extract_deployed_url(text, sample_manifest)
        assert url == f"https://{sample_manifest.app_slug}.fly.dev"

    def test_extract_deployed_url_regex(self, sample_manifest):
        text = "Deployed to https://my-app.fly.dev successfully"
        url = extract_deployed_url(text)
        assert url == "https://my-app.fly.dev"

    def test_extract_deployed_url_none(self):
        assert extract_deployed_url("no url here") is None

    def test_extract_fly_app_name(self, sample_manifest):
        report = self._make_report(sample_manifest)
        text = self._wrap(report)
        name = extract_fly_app_name(text, sample_manifest)
        assert name == sample_manifest.app_slug

    def test_extract_neon_project_id_from_file(self, tmp_path):
        (tmp_path / ".boring").mkdir()
        (tmp_path / ".boring" / "neon-config.env").write_text("NEON_PROJECT_ID=neon-xyz")
        nid = extract_neon_project_id(str(tmp_path))
        assert nid == "neon-xyz"

    def test_extract_bui_commands(self):
        text = "bui init test\nbui doctor\nbui deploy"
        cmds = extract_bui_commands(text)
        assert len(cmds) >= 3

    def test_extract_vault_refs(self, sample_manifest):
        report = self._make_report(sample_manifest)
        text = self._wrap(report)
        refs = extract_vault_refs_from_report(text)
        assert len(refs) == 1
        assert refs[0]["name"] == "KEY"


# ===================================================================
# redaction.py tests
# ===================================================================


class TestRedaction:
    def test_register_and_scan_exact(self):
        reg = SecretRegistry()
        reg.register("api_key", "sk-ant-secret-key-12345678")
        matches = reg.scan("key is sk-ant-secret-key-12345678 here")
        assert len(matches) >= 1
        assert matches[0].method == "exact"

    def test_scan_provider_pattern(self):
        reg = SecretRegistry()
        matches = reg.scan("Token: ghp_abcdefghijklmnopqrstuvwxyz1234567890")
        assert len(matches) >= 1
        assert matches[0].name == "github_pat"

    def test_scan_vault_token_pattern(self):
        reg = SecretRegistry()
        matches = reg.scan("hvs.CAESID1234567890abcdefghij")
        assert len(matches) >= 1
        assert matches[0].name == "vault_token"

    def test_scan_postgres_url(self):
        reg = SecretRegistry()
        matches = reg.scan("postgresql://user:pass@host.neon.tech/db")
        assert len(matches) >= 1

    def test_redact_replaces_secrets(self):
        reg = SecretRegistry()
        reg.register("key", "supersecretvalue12345")
        result = reg.redact("The key is supersecretvalue12345")
        assert "supersecretvalue12345" not in result
        assert "[REDACTED:key]" in result

    def test_has_secrets(self):
        reg = SecretRegistry()
        reg.register("key", "mysecretvalue12345678")
        assert reg.has_secrets("contains mysecretvalue12345678")
        assert not reg.has_secrets("clean text")

    def test_high_entropy_scan(self):
        reg = SecretRegistry()
        matches = reg.scan_high_entropy("token aB3cD4eF5gH6iJ7kL8mN9o")
        assert len(matches) >= 1

    def test_no_false_positives_normal_text(self):
        reg = SecretRegistry()
        matches = reg.scan_high_entropy("This is a normal sentence with nothing special.")
        assert len(matches) == 0

    def test_redact_headers(self):
        headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer token",
            "Cookie": "session=abc",
        }
        safe = redact_headers(headers)
        assert safe["Content-Type"] == "application/json"
        assert safe["Authorization"] == "[REDACTED]"
        assert safe["Cookie"] == "[REDACTED]"

    def test_short_secrets_ignored(self):
        reg = SecretRegistry()
        reg.register("too_short", "abc")
        assert reg.count == 0  # 3 chars too short


# ===================================================================
# introspection.py tests
# ===================================================================


class TestIntrospection:
    def test_discover_returns_platform_facts(self):
        facts = discover_platform_facts()
        assert facts.python_version != ""
        assert facts.os_info != ""

    def test_discover_boring_ui_commit(self):
        facts = discover_platform_facts()
        assert facts.boring_ui_commit != ""  # we're in the repo

    def test_build_manifest_from_facts(self):
        facts = discover_platform_facts()
        manifest = build_manifest_from_facts(facts)
        assert isinstance(manifest.bui_available, bool)

    def test_validate_against_manifest(self):
        facts = discover_platform_facts()
        issues = validate_against_manifest(facts, "core")
        # Should return a list (may have issues if fly/bui not installed)
        assert isinstance(issues, list)

    def test_handles_missing_bui(self):
        from tests.eval.contracts import PlatformFacts
        facts = PlatformFacts()  # empty — no tools
        manifest = build_manifest_from_facts(facts)
        assert manifest.bui_available is False

    def test_discover_uses_home_installed_fly(self, monkeypatch, tmp_path):
        home = tmp_path / "home"
        fly_path = home / ".fly" / "bin" / "fly"
        fly_path.parent.mkdir(parents=True)
        fly_path.write_text("#!/bin/sh\nexit 0\n")
        fly_path.chmod(0o755)

        monkeypatch.setenv("HOME", str(home))
        monkeypatch.setenv("PATH", "")
        monkeypatch.delenv("FLYCTL_BIN", raising=False)

        calls = []

        def fake_run(cmd, timeout=10):
            calls.append(cmd)
            if cmd[:2] == [str(fly_path), "version"]:
                return 0, "fly v0.3.99 linux/amd64 Commit: test BuildDate: now", ""
            return 0, "", ""

        monkeypatch.setattr(introspection_module, "_run", fake_run)

        facts = discover_platform_facts()

        assert facts.fly_cli_version == "0.3.99"
        assert [str(fly_path), "version"] in calls


# ===================================================================
# runners/base.py tests
# ===================================================================


class TestRunners:
    def test_mock_runner_returns_result(self, sample_manifest):
        mock_result = RunResult(exit_code=0, stdout="output", final_response="response")
        runner = MockRunner(result=mock_result)

        result = asyncio.run(runner.run(sample_manifest, "prompt", timeout_s=10))
        assert result.exit_code == 0
        assert result.stdout == "output"

    def test_mock_runner_name(self):
        assert MockRunner().name == "mock"

    def test_subprocess_runner_name(self):
        assert SubprocessRunner().name == "subprocess"

    def test_subprocess_runner_preserves_zero_exit_code(self, sample_manifest):
        runner = SubprocessRunner(command=["python3", "-c", "print('ok')"])
        result = asyncio.run(runner.run(sample_manifest, "prompt", timeout_s=5))
        assert result.exit_code == 0
        assert "ok" in result.stdout

    def test_subprocess_runner_creates_missing_project_root(self, tmp_path):
        naming = NamingContract.from_eval_id(
            "child-eval-20260324T141100Z-hijk9012",
            projects_root=str(tmp_path / "missing-root-parent"),
        )
        manifest = RunManifest.from_naming(naming)
        assert not Path(manifest.project_root).exists()

        runner = SubprocessRunner(command=["python3", "-c", "print('ready')"])
        result = asyncio.run(runner.run(manifest, "prompt", timeout_s=5))

        assert result.exit_code == 0
        assert Path(manifest.project_root).exists()
        assert "ready" in result.stdout

    def test_run_result_to_dict(self):
        rr = RunResult(exit_code=0, stdout="x" * 100, elapsed_s=1.5)
        d = rr.to_dict()
        assert d["exit_code"] == 0
        assert d["stdout_length"] == 100
        assert d["elapsed_s"] == 1.5

    def test_fixture_mock_runner_replays_fixture_and_project_tree(self, tmp_path):
        naming = NamingContract.from_eval_id(
            "child-eval-20260324T120000Z-abcd1234",
            projects_root=str(tmp_path),
        )
        manifest = RunManifest.from_naming(naming)
        fixture_dir = (
            Path(__file__).resolve().parents[1]
            / "fixtures"
            / "known-good"
        )

        runner = FixtureMockRunner(fixture_dir=fixture_dir)
        result = asyncio.run(runner.run(manifest, "prompt", timeout_s=10))

        assert result.exit_code == 0
        assert BEGIN_MARKER in result.final_response
        assert len(result.command_log) >= 3
        assert (Path(manifest.project_root) / "boring.app.toml").exists()
        assert (Path(manifest.project_root) / "src" / "server" / "index.ts").exists()
        assert (Path(manifest.project_root) / "src" / "server" / "routes" / "status.ts").exists()

    def test_fixture_mock_runner_defaults_exit_code_to_zero(self, tmp_path):
        fixture_dir = tmp_path / "fixture"
        fixture_dir.mkdir()
        (fixture_dir / "final_response.txt").write_text("fixture response", encoding="utf-8")
        manifest = RunManifest.from_naming(
            NamingContract.from_eval_id(
                "child-eval-20260324T120000Z-efgh5678",
                projects_root=str(tmp_path),
            )
        )

        runner = FixtureMockRunner(fixture_dir=fixture_dir)
        result = asyncio.run(runner.run(manifest, "prompt", timeout_s=10))

        assert result.exit_code == 0
        assert result.final_response == "fixture response"

    def test_default_agent_runner_scopes_claude_to_repo_and_child_app(self, sample_manifest):
        runner = _default_agent_runner(sample_manifest)
        assert isinstance(runner, SubprocessRunner)
        assert runner._cwd == sample_manifest.project_root
        assert runner._command.count("--add-dir") == 1
        assert sample_manifest.project_root in runner._command

    def test_mock_runner_reports_timeout_when_delay_exceeds_budget(self, sample_manifest):
        runner = MockRunner(
            result=RunResult(exit_code=0, stdout="output"),
            delay_s=0.05,
        )

        result = asyncio.run(runner.run(sample_manifest, "prompt", timeout_s=0.01))

        assert result.timed_out is True

    def test_fixture_catalog_contains_all_expected_scenarios(self):
        fixtures_root = Path(__file__).resolve().parents[1] / "fixtures"
        expected = {
            "known-good": "PASS",
            "secret-leak": "FAIL",
            "missing-route": "FAIL",
            "broken-deploy": "FAIL",
            "malformed-json": "FAIL",
            "scope-violation": "FAIL",
            "liar-agent": "FAIL",
            "scaffold-only": "PARTIAL",
            "env-missing": "INVALID",
        }

        for fixture_name, expected_status in expected.items():
            fixture_dir = fixtures_root / fixture_name
            manifest_data = json.loads(
                (fixture_dir / "manifest.json").read_text(encoding="utf-8")
            )
            assert manifest_data["expected_status"] == expected_status
            assert (fixture_dir / "final_response.txt").exists()
            assert (fixture_dir / "command_log.jsonl").exists()
