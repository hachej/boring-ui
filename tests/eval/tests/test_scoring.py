"""Unit tests for Phase 4: scoring engine and evidence bundle writer.

Run with: python3 -m pytest tests/eval/tests/test_scoring.py -v
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from tests.eval.contracts import (
    CategoryScore,
    CheckResult,
    EvalResult,
    NamingContract,
    OperationalMetrics,
    RunManifest,
)
from tests.eval.evidence import ArtifactEntry, EvidenceWriter, write_evidence_bundle
from tests.eval.reason_codes import Attribution, CheckStatus
from tests.eval.redaction import SecretRegistry
from tests.eval.runners.base import RunResult
from tests.eval.scoring import (
    CRITICAL_AUTOFAIL,
    check_auto_fail,
    check_gates,
    check_must_pass,
    compute_category_scores,
    compute_core_score,
    compute_scores,
    determine_status,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _cr(
    check_id: str,
    status: CheckStatus = CheckStatus.PASS,
    category: str = "scaffolding",
    weight: float = 2.0,
) -> CheckResult:
    return CheckResult(id=check_id, category=category, weight=weight, status=status)


# ===================================================================
# scoring.py tests
# ===================================================================


class TestComputeCategoryScores:
    def test_all_pass(self):
        checks = [
            _cr("scaff.dir_exists", CheckStatus.PASS, "scaffolding", 3),
            _cr("scaff.toml_exists", CheckStatus.PASS, "scaffolding", 3),
        ]
        scores = compute_category_scores(checks, "core")
        scaff = [s for s in scores if s.name == "scaffolding"]
        assert len(scaff) == 1
        assert scaff[0].score == 1.0
        assert scaff[0].gate_met is True

    def test_partial_pass(self):
        checks = [
            _cr("scaff.dir_exists", CheckStatus.PASS, "scaffolding", 3),
            _cr("scaff.toml_exists", CheckStatus.FAIL, "scaffolding", 3),
        ]
        scores = compute_category_scores(checks, "core")
        scaff = [s for s in scores if s.name == "scaffolding"][0]
        assert scaff.score == 0.5
        assert scaff.passed_weight == 3.0
        assert scaff.total_weight == 6.0

    def test_skipped_excluded_from_denominator(self):
        checks = [
            _cr("scaff.dir_exists", CheckStatus.PASS, "scaffolding", 3),
            _cr("scaff.toml_exists", CheckStatus.SKIP, "scaffolding", 3),
        ]
        scores = compute_category_scores(checks, "core")
        scaff = [s for s in scores if s.name == "scaffolding"][0]
        assert scaff.score == 1.0  # 3/3 (skip excluded)
        assert scaff.total_weight == 3.0

    def test_empty_checks(self):
        scores = compute_category_scores([], "core")
        assert all(s.score == 0.0 for s in scores)


class TestComputeCoreScore:
    def test_perfect_score(self):
        categories = [
            CategoryScore("scaffolding", 1.0, 0.75, True, 10, 10),
            CategoryScore("workflow", 1.0, 0.70, True, 5, 5),
            CategoryScore("local_dev", 1.0, 0.70, True, 10, 10),
            CategoryScore("deployment", 1.0, 0.65, True, 20, 20),
            CategoryScore("security", 1.0, 0.80, True, 15, 15),
            CategoryScore("report_quality", 1.0, 0.70, True, 10, 10),
        ]
        score = compute_core_score(categories)
        assert score == pytest.approx(1.0)

    def test_zero_score(self):
        categories = [
            CategoryScore("scaffolding", 0.0, 0.75, False, 0, 10),
            CategoryScore("deployment", 0.0, 0.65, False, 0, 20),
        ]
        score = compute_core_score(categories)
        assert score == 0.0

    def test_empty_categories(self):
        assert compute_core_score([]) == 0.0


class TestCheckGates:
    def test_all_gates_met(self):
        categories = [
            CategoryScore("scaffolding", 0.80, 0.75, True, 8, 10),
            CategoryScore("security", 0.85, 0.80, True, 17, 20),
        ]
        assert check_gates(categories) == []

    def test_gate_failure(self):
        categories = [
            CategoryScore("scaffolding", 0.50, 0.75, False, 5, 10),
            CategoryScore("security", 0.90, 0.80, True, 18, 20),
        ]
        failed = check_gates(categories)
        assert "scaffolding" in failed
        assert "security" not in failed


class TestCheckMustPass:
    def test_all_must_pass(self):
        checks = [
            _cr("scaff.custom_router_impl", CheckStatus.PASS, "scaffolding", 4),
            _cr("deploy.health_200", CheckStatus.PASS, "deployment", 4),
        ]
        assert check_must_pass(checks) == []

    def test_must_pass_failure(self):
        checks = [
            _cr("scaff.custom_router_impl", CheckStatus.FAIL, "scaffolding", 4),
            _cr("deploy.health_200", CheckStatus.PASS, "deployment", 4),
        ]
        failures = check_must_pass(checks)
        assert "scaff.custom_router_impl" in failures


class TestCheckAutoFail:
    def test_no_auto_fail(self):
        checks = [
            _cr("sec.no_secrets_in_toml", CheckStatus.PASS, "security", 4),
            _cr("deploy.health_200", CheckStatus.PASS, "deployment", 4),
        ]
        assert check_auto_fail(checks) == []

    def test_auto_fail_triggered(self):
        checks = [
            _cr("sec.no_secrets_in_toml", CheckStatus.FAIL, "security", 4),
        ]
        triggered = check_auto_fail(checks)
        assert len(triggered) >= 1
        assert "Secrets in tracked files" in triggered


class TestDetermineStatus:
    def test_pass(self):
        categories = [
            CategoryScore("scaffolding", 1.0, 0.75, True, 10, 10),
            CategoryScore("security", 1.0, 0.80, True, 15, 15),
        ]
        checks = [
            _cr("scaff.custom_router_impl", CheckStatus.PASS, "scaffolding", 4),
            _cr("sec.no_secrets_in_toml", CheckStatus.PASS, "security", 4),
        ]
        status, detail = determine_status(0.95, categories, checks)
        assert status == CheckStatus.PASS

    def test_fail_low_score(self):
        categories = [CategoryScore("scaffolding", 0.3, 0.75, False, 3, 10)]
        status, detail = determine_status(0.3, categories, [])
        assert status == CheckStatus.FAIL

    def test_error_status(self):
        checks = [_cr("test", CheckStatus.ERROR)]
        status, detail = determine_status(1.0, [], checks)
        assert status == CheckStatus.ERROR


class TestComputeScores:
    def test_full_passing_eval(self, sample_manifest):
        checks = [
            _cr("scaff.dir_exists", CheckStatus.PASS, "scaffolding", 3),
            _cr("scaff.custom_router_impl", CheckStatus.PASS, "scaffolding", 4),
            _cr("sec.no_secrets_in_toml", CheckStatus.PASS, "security", 4),
            _cr("sec.no_secrets_in_source", CheckStatus.PASS, "security", 4),
            _cr("deploy.health_200", CheckStatus.PASS, "deployment", 4),
            _cr("deploy.custom_router_live", CheckStatus.PASS, "deployment", 4),
            _cr("local.clean_room_dev_starts", CheckStatus.PASS, "local_dev", 4),
            _cr("local.custom_health", CheckStatus.PASS, "local_dev", 4),
            _cr("workflow.scaffold_supported", CheckStatus.PASS, "workflow", 4),
            _cr("report.claims_match_evidence", CheckStatus.PASS, "report_quality", 4),
            _cr("sec.no_forbidden_repo_changes", CheckStatus.PASS, "security", 4),
            _cr("sec.only_project_dir_mutated", CheckStatus.PASS, "security", 4),
        ]
        result = compute_scores(checks, sample_manifest.eval_id)
        assert result.status == CheckStatus.PASS
        assert result.core_score == 1.0
        assert result.critical_failures == []
        assert result.must_pass_failures == []


# ===================================================================
# evidence.py tests
# ===================================================================


class TestEvidenceWriter:
    def test_write_text(self, tmp_evidence_dir):
        writer = EvidenceWriter(tmp_evidence_dir)
        path = writer.write_text("test.txt", "hello world")
        assert path.exists()
        assert path.read_text() == "hello world"
        assert len(writer.artifacts) == 1

    def test_write_json(self, tmp_evidence_dir):
        writer = EvidenceWriter(tmp_evidence_dir)
        path = writer.write_json("data.json", {"key": "value"})
        assert path.exists()
        data = json.loads(path.read_text())
        assert data["key"] == "value"

    def test_write_with_redaction(self, tmp_evidence_dir):
        reg = SecretRegistry()
        reg.register("secret", "supersecretvalue12345")
        writer = EvidenceWriter(tmp_evidence_dir, reg)
        path = writer.write_text("output.txt", "Key: supersecretvalue12345")
        content = path.read_text()
        assert "supersecretvalue12345" not in content
        assert "[REDACTED:secret]" in content

    def test_write_without_redaction(self, tmp_evidence_dir):
        reg = SecretRegistry()
        reg.register("secret", "supersecretvalue12345")
        writer = EvidenceWriter(tmp_evidence_dir, reg)
        path = writer.write_text("raw.txt", "supersecretvalue12345", redact=False)
        assert "supersecretvalue12345" in path.read_text()

    def test_artifact_manifest(self, tmp_evidence_dir):
        writer = EvidenceWriter(tmp_evidence_dir)
        writer.write_text("a.txt", "aaa")
        writer.write_text("b.txt", "bbb")
        manifest_path = writer.write_artifact_manifest()
        data = json.loads(manifest_path.read_text())
        assert data["artifact_count"] == 2  # a.txt, b.txt (manifest written after count)

    def test_write_run_result(self, tmp_evidence_dir):
        writer = EvidenceWriter(tmp_evidence_dir)
        rr = RunResult(exit_code=0, stdout="out", stderr="err", final_response="resp")
        writer.write_run_result(rr)
        assert (tmp_evidence_dir / "agent_stdout.txt").read_text() == "out"
        assert (tmp_evidence_dir / "agent_stderr.txt").read_text() == "err"


class TestWriteEvidenceBundle:
    def test_full_bundle(self, sample_manifest, tmp_evidence_dir):
        sample_manifest.evidence_dir = str(tmp_evidence_dir)
        eval_result = EvalResult(
            eval_id=sample_manifest.eval_id,
            status=CheckStatus.PASS,
            core_score=0.95,
        )
        run_result = RunResult(exit_code=0, stdout="output")

        writer = write_evidence_bundle(sample_manifest, eval_result, run_result)

        assert (tmp_evidence_dir / "summary.json").exists()
        assert (tmp_evidence_dir / "run_manifest.json").exists()
        assert (tmp_evidence_dir / "eval_result.json").exists()
        assert (tmp_evidence_dir / "agent_stdout.txt").exists()
        assert (tmp_evidence_dir / "artifact_manifest.json").exists()

        summary = json.loads((tmp_evidence_dir / "summary.json").read_text())
        assert summary["status"] == "PASS"
        assert summary["core_score"] == 0.95

    def test_artifact_entry_to_dict(self):
        ae = ArtifactEntry("test.txt", "abc123", 100, True, "harness")
        d = ae.to_dict()
        assert d["filename"] == "test.txt"
        assert d["sha256"] == "abc123"
        assert d["redacted"] is True
