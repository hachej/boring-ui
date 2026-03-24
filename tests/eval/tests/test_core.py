"""Unit tests for Phase 2 core modules: prompt, parsing, redaction, introspection.

Run with: python3 -m pytest tests/eval/tests/test_core.py -v
"""

from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path

import pytest

from tests.eval.agent_prompt import generate_prompt, save_prompt
from tests.eval.contracts import NamingContract, ObservedCommand, RunManifest
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

    def test_generate_contains_bui_commands(self, sample_manifest):
        prompt = generate_prompt(sample_manifest)
        assert "bui init" in prompt
        assert "bui doctor" in prompt
        assert "bui deploy" in prompt

    def test_generate_contains_constraints(self, sample_manifest):
        prompt = generate_prompt(sample_manifest)
        assert "Do NOT modify" in prompt
        assert "Do NOT hardcode" in prompt

    def test_generate_deterministic(self, sample_manifest):
        p1 = generate_prompt(sample_manifest)
        p2 = generate_prompt(sample_manifest)
        assert p1 == p2

    def test_auth_plus_includes_whoami(self, sample_manifest):
        prompt = generate_prompt(sample_manifest, profile="auth-plus")
        assert "/whoami" in prompt

    def test_core_excludes_whoami(self, sample_manifest):
        prompt = generate_prompt(sample_manifest, profile="core")
        assert "/whoami" not in prompt

    def test_save_prompt(self, sample_manifest, tmp_evidence_dir):
        sample_manifest.evidence_dir = str(tmp_evidence_dir)
        prompt = generate_prompt(sample_manifest)
        path = save_prompt(sample_manifest, prompt)
        assert path.exists()
        assert path.read_text() == prompt


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
        assert (Path(manifest.project_root) / "src" / naming.python_module / "routers" / "status.py").exists()

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
