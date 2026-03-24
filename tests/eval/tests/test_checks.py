"""Unit tests for Phase 3 check modules using synthetic inputs.

Run with: python3 -m pytest tests/eval/tests/test_checks.py -v
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from tests.eval.checks.deployment import DeploymentContext, run_deployment_checks
from tests.eval.checks.local_dev import LocalDevContext, run_local_dev_checks
from tests.eval.checks.preflight import run_preflight_checks
from tests.eval.checks.report_quality import run_report_quality_checks
from tests.eval.checks.scaffolding import run_scaffolding_checks
from tests.eval.checks.security import run_security_checks
from tests.eval.checks.workflow import run_workflow_checks
from tests.eval.contracts import NamingContract, ObservedCommand, RunManifest
from tests.eval.reason_codes import CheckStatus
from tests.eval.redaction import SecretRegistry
from tests.eval.report_schema import BEGIN_MARKER, END_MARKER
from tests.eval.tests.conftest import TEST_EVAL_ID


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def manifest():
    nc = NamingContract.from_eval_id(TEST_EVAL_ID)
    return RunManifest.from_naming(nc)


@pytest.fixture
def good_project(manifest, tmp_path):
    """Create a well-formed project directory."""
    root = tmp_path / manifest.app_slug
    root.mkdir()
    manifest.project_root = str(root)
    manifest.evidence_dir = str(tmp_path / "evidence")

    (root / "boring.app.toml").write_text(f"""
[app]
name = "{manifest.app_slug}"
id = "{manifest.app_slug}"
logo = "C"

[backend]
entry = "{manifest.python_module}.api.app:create_app"

[deploy]
platform = "fly"

[deploy.secrets]
api_key = {{vault = "secret/agent/anthropic", field = "api_key"}}
session_secret = {{vault = "secret/agent/app/test/prod", field = "session_secret"}}
""")
    (root / ".gitignore").write_text(".env\n.boring/\n__pycache__/\n")

    # Backend
    pkg = root / "src" / manifest.python_module / "api"
    pkg.mkdir(parents=True)
    (pkg / "__init__.py").write_text("")
    (pkg / "app.py").write_text("""
from fastapi import FastAPI
def create_app():
    app = FastAPI()
    from .routers import status
    app.include_router(status.router)
    return app
""")

    routers = pkg / "routers"
    routers.mkdir()
    (routers / "__init__.py").write_text("")
    (routers / "status.py").write_text(f"""
from fastapi import APIRouter
router = APIRouter()

@router.get("/health")
def health():
    return {{"ok": True, "app": "{manifest.app_slug}",
             "eval_id": "{manifest.eval_id}",
             "verification_nonce": "{manifest.verification_nonce}",
             "custom": True}}

@router.get("/info")
def info():
    return {{"name": "{manifest.app_slug}", "version": "0.1.0",
             "eval_id": "{manifest.eval_id}"}}
""")
    return root


# ===================================================================
# Scaffolding checks
# ===================================================================


class TestScaffoldingChecks:
    def test_good_project_passes_all(self, manifest, good_project):
        results = run_scaffolding_checks(manifest)
        passed = sum(1 for r in results if r.status == CheckStatus.PASS)
        assert len(results) == 13
        assert passed >= 12  # frontend check may vary

    def test_missing_project_fails(self, manifest):
        manifest.project_root = "/nonexistent/path"
        results = run_scaffolding_checks(manifest)
        assert results[0].status == CheckStatus.FAIL  # dir_exists
        assert results[0].reason_code == "SCAFF_DIR_MISSING"

    def test_missing_toml_fails(self, manifest, tmp_path):
        root = tmp_path / "empty"
        root.mkdir()
        manifest.project_root = str(root)
        results = run_scaffolding_checks(manifest)
        toml_check = [r for r in results if r.id == "scaff.toml_exists"][0]
        assert toml_check.status == CheckStatus.FAIL

    def test_nonce_required(self, manifest, good_project):
        # Remove nonce from status.py
        status_file = list(good_project.rglob("status.py"))[0]
        content = status_file.read_text()
        content = content.replace(manifest.verification_nonce, "wrong-nonce")
        status_file.write_text(content)
        results = run_scaffolding_checks(manifest)
        impl_check = [r for r in results if r.id == "scaff.custom_router_impl"][0]
        assert impl_check.status == CheckStatus.FAIL


# ===================================================================
# Workflow checks
# ===================================================================


class TestWorkflowChecks:
    def test_good_workflow(self, manifest):
        cmds = [
            ObservedCommand(command="bui init test", exit_code=0),
            ObservedCommand(command="bui doctor", exit_code=0),
            ObservedCommand(command="bui neon setup --region aws-eu-central-1", exit_code=0),
            ObservedCommand(command="bui deploy", exit_code=0),
        ]
        results = run_workflow_checks(manifest, cmds)
        assert all(r.status == CheckStatus.PASS for r in results)

    def test_empty_log_fails(self, manifest):
        results = run_workflow_checks(manifest, [])
        scaffold = [r for r in results if r.id == "workflow.scaffold_supported"][0]
        assert scaffold.status == CheckStatus.FAIL

    def test_bypass_detected(self, manifest):
        cmds = [ObservedCommand(command="fly deploy", exit_code=0)]
        results = run_workflow_checks(manifest, cmds)
        bypass = [r for r in results if r.id == "workflow.no_unsupported_bypass"][0]
        assert bypass.status == CheckStatus.FAIL

    def test_text_fallback(self, manifest):
        results = run_workflow_checks(manifest, [], agent_text="I ran bui init my-app")
        scaffold = [r for r in results if r.id == "workflow.scaffold_supported"][0]
        assert scaffold.status == CheckStatus.PASS


# ===================================================================
# Local dev checks
# ===================================================================


class TestLocalDevChecks:
    def test_all_pass(self, manifest):
        ctx = LocalDevContext(
            manifest,
            doctor_exit_code=0,
            doctor_stdout="All checks passed",
            dev_started=True,
            dev_port=8000,
            health_status=200,
            health_response={
                "ok": True, "app": manifest.app_slug,
                "eval_id": manifest.eval_id,
                "verification_nonce": manifest.verification_nonce,
            },
            info_status=200,
            info_response={"name": manifest.app_slug, "version": "0.1.0", "eval_id": manifest.eval_id},
            config_status=200,
            config_response={"app": {}},
            capabilities_status=200,
            capabilities_response={"version": "0.1.0", "features": {}},
            clean_shutdown=True,
        )
        results = run_local_dev_checks(ctx)
        assert all(r.status == CheckStatus.PASS for r in results)

    def test_nonce_mismatch(self, manifest):
        ctx = LocalDevContext(
            manifest,
            dev_started=True, dev_port=8000,
            health_status=200,
            health_response={
                "ok": True, "app": "test",
                "eval_id": manifest.eval_id,
                "verification_nonce": "wrong-nonce",
            },
        )
        results = run_local_dev_checks(ctx)
        health = [r for r in results if r.id == "local.custom_health"][0]
        assert health.status == CheckStatus.FAIL
        assert health.reason_code == "LOCAL_NONCE_MISMATCH"

    def test_dev_not_started_skips(self, manifest):
        ctx = LocalDevContext(manifest, dev_started=False)
        results = run_local_dev_checks(ctx)
        skipped = [r for r in results if r.status == CheckStatus.SKIP]
        assert len(skipped) >= 8  # most checks need dev_started


# ===================================================================
# Security checks
# ===================================================================


class TestSecurityChecks:
    def test_clean_project_passes(self, manifest, good_project):
        reg = SecretRegistry()
        reg.register("test_key", "sk-ant-supersecretkey123456")
        results = run_security_checks(manifest, reg)
        passed = [r for r in results if r.status == CheckStatus.PASS]
        assert len(passed) >= 15

    def test_secret_in_toml_detected(self, manifest, tmp_path):
        root = tmp_path / "leaky"
        root.mkdir()
        manifest.project_root = str(root)
        (root / "boring.app.toml").write_text('key = "sk-ant-supersecretkey123456"')
        (root / ".gitignore").write_text(".env\n.boring/\n")

        reg = SecretRegistry()
        reg.register("test_key", "sk-ant-supersecretkey123456")
        results = run_security_checks(manifest, reg)
        toml_check = [r for r in results if r.id == "sec.no_secrets_in_toml"][0]
        assert toml_check.status == CheckStatus.FAIL

    def test_secret_in_transcript_detected(self, manifest, tmp_path):
        root = tmp_path / "test"
        root.mkdir()
        manifest.project_root = str(root)

        reg = SecretRegistry()
        reg.register("key", "sk-ant-supersecretkey123456")
        results = run_security_checks(
            manifest, reg,
            agent_stdout="The key is sk-ant-supersecretkey123456",
        )
        transcript = [r for r in results if r.id == "sec.no_secrets_in_transcript"][0]
        assert transcript.status == CheckStatus.FAIL


# ===================================================================
# Report quality checks
# ===================================================================


class TestReportQualityChecks:
    def _good_report_text(self, manifest):
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
            "commands_run": ["bui init", "bui doctor", "bui deploy"],
            "local_checks": [{"path": "/health", "status": 200}],
            "live_checks": [{"path": "/health", "status": 200}],
            "known_issues": [],
            "steps": {"scaffold": {"status": "succeeded", "attempted": True}},
        }
        return f"## Summary\nApp deployed.\n{BEGIN_MARKER}\n{json.dumps(report)}\n{END_MARKER}\nDone."

    def test_good_report(self, manifest):
        text = self._good_report_text(manifest)
        results = run_report_quality_checks(manifest, text)
        assert all(r.status == CheckStatus.PASS for r in results)

    def test_no_report(self, manifest):
        results = run_report_quality_checks(manifest, "just text")
        json_check = [r for r in results if r.id == "report.machine_json_present"][0]
        assert json_check.status == CheckStatus.FAIL

    def test_eval_id_mismatch(self, manifest):
        report = {
            "eval_id": "wrong-id",
            "eval_spec_version": "0.1.0",
            "report_schema_version": "0.1.0",
            "platform_profile": "core",
            "verification_nonce": manifest.verification_nonce,
            "app_slug": manifest.app_slug,
            "project_root": manifest.project_root,
            "python_module": manifest.python_module,
            "commands_run": [], "local_checks": [], "live_checks": [],
            "known_issues": [],
        }
        text = f"Summary\n{BEGIN_MARKER}\n{json.dumps(report)}\n{END_MARKER}"
        results = run_report_quality_checks(manifest, text)
        claims = [r for r in results if r.id == "report.claims_match_evidence"][0]
        assert claims.status == CheckStatus.FAIL


# ===================================================================
# Deployment checks
# ===================================================================


class TestDeploymentChecks:
    def test_with_good_responses(self, manifest):
        ctx = DeploymentContext(
            manifest,
            deployed_url=f"https://{manifest.app_slug}.fly.dev",
            responses={
                "/": (200, "<html>App</html>"),
                "/health": (200, {
                    "ok": True, "app": manifest.app_slug,
                    "eval_id": manifest.eval_id,
                    "verification_nonce": manifest.verification_nonce,
                }),
                "/info": (200, {"name": manifest.app_slug, "version": "0.1.0", "eval_id": manifest.eval_id}),
                "/__bui/config": (200, {"app": {}}),
                "/api/capabilities": (200, {"version": "0.1.0", "features": {}}),
                "/api/v1/me": (401, {}),
            },
        )
        results = run_deployment_checks(ctx)
        assert len(results) == 28
        passed = [r for r in results if r.status == CheckStatus.PASS]
        assert len(passed) >= 15

    def test_no_url_fails(self, manifest):
        ctx = DeploymentContext(manifest, deployed_url=None)
        results = run_deployment_checks(ctx)
        url_check = [r for r in results if r.id == "deploy.deployed_url_present"][0]
        assert url_check.status == CheckStatus.FAIL

    def test_nonce_mismatch(self, manifest):
        ctx = DeploymentContext(
            manifest,
            deployed_url="https://test.fly.dev",
            responses={
                "/health": (200, {
                    "ok": True, "app": "test",
                    "eval_id": manifest.eval_id,
                    "verification_nonce": "wrong-nonce",
                }),
            },
        )
        results = run_deployment_checks(ctx)
        custom = [r for r in results if r.id == "deploy.custom_router_live"][0]
        assert custom.status == CheckStatus.FAIL
        assert custom.reason_code == "DEPLOY_NONCE_MISMATCH"


# ===================================================================
# Preflight checks
# ===================================================================


class TestPreflightChecks:
    def test_returns_13_checks(self, manifest):
        results = run_preflight_checks(manifest)
        assert len(results) == 13

    def test_all_unscored(self, manifest):
        results = run_preflight_checks(manifest)
        for r in results:
            assert r.weight == 0
