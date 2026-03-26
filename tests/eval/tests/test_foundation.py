"""Comprehensive unit tests for Phase 1 eval harness foundation modules.

Run with: python3 -m pytest tests/eval/tests/test_foundation.py -v
"""

from __future__ import annotations

import json

import pytest

from tests.eval.capabilities import (
    PROFILES,
    CapabilityManifest,
    ProfileContract,
    applicable_checks,
    enrich_manifest_with_preflight_results,
    get_profile_contract,
    skip_reasons_for_manifest,
    validate_profile_against_capabilities,
)
from tests.eval.check_catalog import (
    CATALOG,
    CATEGORY_GATES,
    CheckSpec,
    RetryPolicy,
    get_checks_by_category,
    get_checks_for_profile,
    get_must_pass_checks,
    get_prerequisites,
    get_scored_checks,
    validate_catalog,
)
from tests.eval.contracts import (
    CategoryScore,
    CheckResult,
    CleanupResult,
    EvalResult,
    NamingContract,
    ObservedCommand,
    OperationalMetrics,
    PlatformFacts,
    RunManifest,
)
from tests.eval.reason_codes import (
    Attribution,
    CheckStatus,
    Confidence,
    DEFAULT_ATTRIBUTION,
    RETRIABLE_CODES,
    default_attribution,
    is_retriable,
)
from tests.eval.report_schema import (
    BEGIN_MARKER,
    END_MARKER,
    REPORT_SCHEMA,
    extract_events_from_text,
    extract_report_from_text,
    validate_report,
)


# ===================================================================
# contracts.py tests
# ===================================================================


class TestNamingContract:
    def test_from_eval_id_generates_correct_derived_values(self):
        nc = NamingContract.from_eval_id("child-eval-20260320T120000Z-a1b2c3d4")
        assert nc.eval_id == "child-eval-20260320T120000Z-a1b2c3d4"
        assert nc.app_slug == "ce-0320-a1b2c3d4"
        assert nc.python_module == "ce_0320_a1b2c3d4"
        assert nc.project_root == "/home/ubuntu/projects/ce-0320-a1b2c3d4"
        assert nc.projects_root == "/home/ubuntu/projects"

    def test_from_eval_id_auto_generates(self):
        nc = NamingContract.from_eval_id()
        assert nc.eval_id.startswith("child-eval-")
        assert nc.app_slug.startswith("ce-")
        assert len(nc.app_slug) <= 20

    def test_from_eval_id_custom_projects_root(self):
        nc = NamingContract.from_eval_id(
            "child-eval-20260115T090000Z-x1y2z3w4",
            projects_root="/tmp/projects",
        )
        assert nc.project_root == "/tmp/projects/ce-0115-x1y2z3w4"
        assert nc.projects_root == "/tmp/projects"

    def test_from_eval_id_invalid_format(self):
        with pytest.raises(ValueError, match="does not match"):
            NamingContract.from_eval_id("invalid-id")

    def test_from_eval_id_wrong_prefix(self):
        with pytest.raises(ValueError):
            NamingContract.from_eval_id("wrong-eval-20260320T120000Z-a1b2c3d4")

    def test_app_slug_max_length(self):
        nc = NamingContract.from_eval_id("child-eval-20261231T235959Z-zzzzzzzz")
        assert len(nc.app_slug) <= 20

    def test_round_trip(self):
        nc = NamingContract.from_eval_id("child-eval-20260320T120000Z-a1b2c3d4")
        d = nc.to_dict()
        nc2 = NamingContract.from_dict(d)
        assert nc2 == nc

    def test_json_serializable(self):
        nc = NamingContract.from_eval_id()
        json_str = json.dumps(nc.to_dict())
        data = json.loads(json_str)
        nc2 = NamingContract.from_dict(data)
        assert nc2.eval_id == nc.eval_id


class TestRunManifest:
    def test_round_trip(self, sample_manifest):
        d = sample_manifest.to_dict()
        rt = RunManifest.from_dict(d)
        assert rt.eval_id == sample_manifest.eval_id
        assert rt.verification_nonce == sample_manifest.verification_nonce
        assert rt.lease_id == sample_manifest.lease_id
        assert rt.required_routes == sample_manifest.required_routes
        assert rt.timeouts == sample_manifest.timeouts

    def test_json_round_trip(self, sample_manifest):
        json_str = json.dumps(sample_manifest.to_dict(), indent=2)
        data = json.loads(json_str)
        rt = RunManifest.from_dict(data)
        assert rt.eval_id == sample_manifest.eval_id

    def test_from_naming(self, sample_naming_contract):
        manifest = RunManifest.from_naming(sample_naming_contract)
        assert manifest.eval_id == sample_naming_contract.eval_id
        assert manifest.app_slug == sample_naming_contract.app_slug
        assert manifest.verification_nonce  # not empty
        assert manifest.lease_id  # not empty
        assert "/health" in manifest.required_routes

    def test_from_naming_auth_plus(self, sample_naming_contract):
        manifest = RunManifest.from_naming(
            sample_naming_contract, platform_profile="auth-plus"
        )
        assert "/whoami" in manifest.required_routes

    def test_from_naming_core_no_whoami(self, sample_naming_contract):
        manifest = RunManifest.from_naming(
            sample_naming_contract, platform_profile="core"
        )
        assert "/whoami" not in manifest.required_routes


class TestCheckResult:
    def test_round_trip(self):
        cr = CheckResult(
            id="scaff.test", category="scaffolding", weight=3.0,
            status=CheckStatus.PASS,
        )
        d = cr.to_dict()
        rt = CheckResult.from_dict(d)
        assert rt.id == cr.id
        assert rt.status == CheckStatus.PASS

    def test_all_statuses_serialize(self):
        for status in CheckStatus:
            cr = CheckResult(
                id="test", category="test", weight=1.0, status=status,
            )
            d = cr.to_dict()
            assert d["status"] == status.value
            rt = CheckResult.from_dict(d)
            assert rt.status == status

    def test_all_attributions_serialize(self):
        for attr in Attribution:
            cr = CheckResult(
                id="test", category="test", weight=1.0,
                status=CheckStatus.FAIL, attribution=attr,
            )
            d = cr.to_dict()
            assert d["attribution"] == attr.value

    def test_optional_fields_defaults(self):
        cr = CheckResult(
            id="test", category="test", weight=1.0, status=CheckStatus.PASS,
        )
        assert cr.reason_code == ""
        assert cr.attribution == Attribution.UNKNOWN
        assert cr.retriable is False
        assert cr.skipped is False
        assert cr.blocked_by == []
        assert cr.evidence_refs == []
        assert cr.detail == ""

    def test_with_blocked_by(self):
        cr = CheckResult(
            id="test", category="test", weight=1.0,
            status=CheckStatus.SKIP, blocked_by=["prereq.1", "prereq.2"],
        )
        d = cr.to_dict()
        rt = CheckResult.from_dict(d)
        assert rt.blocked_by == ["prereq.1", "prereq.2"]


class TestCategoryScore:
    def test_round_trip(self):
        cs = CategoryScore(
            name="scaffolding", score=0.95, gate=0.75,
            gate_met=True, passed_weight=9.5, total_weight=10.0,
        )
        d = cs.to_dict()
        rt = CategoryScore.from_dict(d)
        assert rt.name == cs.name
        assert rt.score == cs.score
        assert rt.gate_met is True


class TestEvalResult:
    def test_round_trip(self):
        er = EvalResult(
            eval_id="test-eval",
            status=CheckStatus.PASS,
            core_score=0.95,
            categories=[
                CategoryScore("scaffolding", 0.95, 0.75, True, 9.5, 10.0),
            ],
            checks=[
                CheckResult("scaff.test", "scaffolding", 3.0, CheckStatus.PASS),
            ],
        )
        d = er.to_dict()
        json_str = json.dumps(d, indent=2)
        rt = EvalResult.from_dict(json.loads(json_str))
        assert rt.eval_id == er.eval_id
        assert len(rt.categories) == 1
        assert len(rt.checks) == 1

    def test_empty_checks(self):
        er = EvalResult(eval_id="test", status=CheckStatus.PASS)
        d = er.to_dict()
        rt = EvalResult.from_dict(d)
        assert rt.checks == []
        assert rt.categories == []

    def test_with_operational_metrics(self):
        er = EvalResult(
            eval_id="test", status=CheckStatus.PASS,
            operational_metrics=OperationalMetrics(
                time_to_local_health_seconds=5.0,
                retry_counts={"deploy": 2},
            ),
        )
        d = er.to_dict()
        rt = EvalResult.from_dict(d)
        assert rt.operational_metrics is not None
        assert rt.operational_metrics.time_to_local_health_seconds == 5.0
        assert rt.operational_metrics.retry_counts == {"deploy": 2}

    def test_with_cleanup_errors(self):
        er = EvalResult(
            eval_id="test", status=CheckStatus.FAIL,
            cleanup_errors=[
                CleanupResult("fly_app", "test-app", False, "timeout"),
            ],
        )
        d = er.to_dict()
        rt = EvalResult.from_dict(d)
        assert len(rt.cleanup_errors) == 1
        assert rt.cleanup_errors[0].success is False


class TestObservedCommand:
    def test_round_trip(self):
        oc = ObservedCommand(
            command="bui deploy", exit_code=0,
            phase="deploy", duration_seconds=45.2,
        )
        d = oc.to_dict()
        rt = ObservedCommand.from_dict(d)
        assert rt.command == oc.command
        assert rt.exit_code == 0

    def test_null_exit_code(self):
        oc = ObservedCommand(command="bui deploy")
        d = oc.to_dict()
        assert d["exit_code"] is None
        rt = ObservedCommand.from_dict(d)
        assert rt.exit_code is None


class TestPlatformFacts:
    def test_round_trip(self):
        pf = PlatformFacts(
            boring_ui_commit="abc123",
            bui_version="0.1.0",
            python_version="3.13",
        )
        d = pf.to_dict()
        rt = PlatformFacts.from_dict(d)
        assert rt.boring_ui_commit == "abc123"

    def test_defaults(self):
        pf = PlatformFacts()
        assert pf.boring_ui_commit == ""
        assert pf.boring_ui_dirty is False
        assert pf.vault_available is False


# ===================================================================
# reason_codes.py tests
# ===================================================================


class TestCheckStatus:
    def test_values(self):
        assert CheckStatus.PASS.value == "PASS"
        assert CheckStatus.FAIL.value == "FAIL"
        assert CheckStatus.SKIP.value == "SKIP"
        assert CheckStatus.INVALID.value == "INVALID"
        assert CheckStatus.ERROR.value == "ERROR"

    def test_is_terminal_failure(self):
        assert CheckStatus.FAIL.is_terminal_failure() is True
        assert CheckStatus.ERROR.is_terminal_failure() is True
        assert CheckStatus.PASS.is_terminal_failure() is False
        assert CheckStatus.SKIP.is_terminal_failure() is False
        assert CheckStatus.INVALID.is_terminal_failure() is False

    def test_string_enum(self):
        assert isinstance(CheckStatus.PASS, str)
        assert CheckStatus.PASS == "PASS"


class TestAttribution:
    def test_values(self):
        assert Attribution.AGENT.value == "agent"
        assert Attribution.PROVIDER.value == "provider"
        assert Attribution.HARNESS.value == "harness"
        assert Attribution.MIXED.value == "mixed"
        assert Attribution.UNKNOWN.value == "unknown"


class TestReasonCodes:
    def test_scaff_prefix(self):
        from tests.eval import reason_codes as rc
        scaff_codes = [
            v for k, v in vars(rc).items()
            if isinstance(v, str) and v.startswith("SCAFF_")
        ]
        assert len(scaff_codes) >= 10

    def test_env_prefix(self):
        from tests.eval import reason_codes as rc
        env_codes = [
            v for k, v in vars(rc).items()
            if isinstance(v, str) and v.startswith("ENV_")
        ]
        assert len(env_codes) >= 8

    def test_no_duplicate_codes(self):
        from tests.eval import reason_codes as rc
        all_codes = [
            v for k, v in vars(rc).items()
            if isinstance(v, str) and "_" in v and v == v.upper()
            and not k.startswith("_") and k not in ("RETRIABLE_CODES",)
        ]
        assert len(all_codes) == len(set(all_codes)), "Duplicate reason codes found"

    def test_default_attribution_coverage(self):
        """Every code in DEFAULT_ATTRIBUTION maps to a valid Attribution."""
        for code, attr in DEFAULT_ATTRIBUTION.items():
            assert isinstance(attr, Attribution), f"{code}: {attr}"

    def test_default_attribution_env_codes(self):
        """ENV_* codes should default to provider or harness, not agent."""
        from tests.eval import reason_codes as rc
        for name in dir(rc):
            val = getattr(rc, name)
            if isinstance(val, str) and val.startswith("ENV_"):
                attr = default_attribution(val)
                assert attr in (Attribution.PROVIDER, Attribution.HARNESS), (
                    f"{val} -> {attr}, expected provider or harness"
                )

    def test_default_attribution_harness_codes(self):
        """HARNESS_* codes should default to harness."""
        from tests.eval import reason_codes as rc
        for name in dir(rc):
            val = getattr(rc, name)
            if isinstance(val, str) and val.startswith("HARNESS_"):
                assert default_attribution(val) == Attribution.HARNESS

    def test_retriable_codes(self):
        """Known transient codes should be retriable."""
        from tests.eval.reason_codes import DEPLOY_TIMEOUT, ENV_PROVIDER_OUTAGE
        assert is_retriable(DEPLOY_TIMEOUT)
        assert is_retriable(ENV_PROVIDER_OUTAGE)

    def test_non_retriable_codes(self):
        """Permanent failures should not be retriable."""
        from tests.eval.reason_codes import SCAFF_DIR_MISSING, SEC_SECRET_LEAKED
        assert not is_retriable(SCAFF_DIR_MISSING)
        assert not is_retriable(SEC_SECRET_LEAKED)


# ===================================================================
# check_catalog.py tests
# ===================================================================


class TestCheckCatalog:
    def test_catalog_count(self):
        assert len(CATALOG) == 123

    def test_catalog_validation(self):
        errors = validate_catalog()
        assert errors == [], f"Catalog validation errors: {errors}"

    def test_no_orphan_prerequisites(self):
        for spec in CATALOG.values():
            for prereq in spec.prerequisites:
                assert prereq in CATALOG, (
                    f"{spec.id}: prerequisite {prereq!r} not in catalog"
                )

    def test_weights_are_non_negative(self):
        for spec in CATALOG.values():
            assert spec.weight >= 0, f"{spec.id}: negative weight {spec.weight}"

    def test_every_check_has_valid_category(self):
        for spec in CATALOG.values():
            assert spec.category in CATEGORY_GATES, (
                f"{spec.id}: unknown category {spec.category!r}"
            )

    def test_preflight_checks_unscored(self):
        for spec in CATALOG.values():
            if spec.category == "preflight":
                assert spec.weight == 0, (
                    f"{spec.id}: preflight check should have weight=0"
                )

    def test_core_profile_checks(self):
        core = get_checks_for_profile("core")
        ids = {c.id for c in core}
        assert "scaff.dir_exists" in ids
        assert "deploy.health_200" in ids
        assert "deploy.auth_signup" not in ids  # auth-plus only

    def test_auth_plus_includes_auth_checks(self):
        auth_plus = get_checks_for_profile("auth-plus")
        ids = {c.id for c in auth_plus}
        assert "deploy.auth_signup" in ids
        assert "deploy.auth_signin" in ids
        assert "deploy.workspace_create" not in ids  # full-stack only

    def test_full_stack_includes_non_extensible(self):
        full = get_checks_for_profile("full-stack")
        extensible_only = [s for s in CATALOG.values() if s.profile == "extensible"]
        assert len(full) == len(CATALOG) - len(extensible_only)

    def test_extensible_includes_everything(self):
        ext = get_checks_for_profile("extensible")
        assert len(ext) == len(CATALOG)

    def test_must_pass_checks(self):
        mp = get_must_pass_checks()
        ids = {c.id for c in mp}
        assert "scaff.custom_router_impl" in ids
        assert "local.clean_room_dev_starts" in ids
        assert "local.custom_health" in ids
        assert "deploy.health_200" in ids
        assert "deploy.custom_router_live" in ids
        assert "sec.no_secrets_in_toml" in ids
        assert "sec.no_secrets_in_source" in ids
        assert "report.claims_match_evidence" in ids

    def test_scored_checks(self):
        scored = get_scored_checks()
        assert all(c.weight > 0 for c in scored)
        # Preflight checks should not be in scored
        assert all(c.category != "preflight" for c in scored)

    def test_dependency_order_valid(self):
        """Check that prerequisites don't form cycles and come before dependents."""
        visited: set[str] = set()

        def _visit(spec_id: str, path: frozenset[str]) -> None:
            if spec_id in path:
                raise AssertionError(f"Cycle detected: {path} -> {spec_id}")
            if spec_id in visited:
                return
            spec = CATALOG[spec_id]
            for prereq in spec.prerequisites:
                _visit(prereq, path | {spec_id})
            visited.add(spec_id)

        for spec_id in CATALOG:
            _visit(spec_id, frozenset())

    def test_check_spec_round_trip(self):
        spec = CATALOG["scaff.custom_router_impl"]
        d = spec.to_dict()
        rt = CheckSpec.from_dict(d)
        assert rt.id == spec.id
        assert rt.must_pass == spec.must_pass
        assert rt.weight == spec.weight
        assert rt.prerequisites == spec.prerequisites

    def test_retry_policy_round_trip(self):
        rp = RetryPolicy(max_retries=3, backoff_base_s=5.0)
        d = rp.to_dict()
        rt = RetryPolicy.from_dict(d)
        assert rt.max_retries == 3
        assert rt.backoff_base_s == 5.0

    def test_get_prerequisites(self):
        prereqs = get_prerequisites("scaff.toml_valid")
        ids = {p.id for p in prereqs}
        assert "scaff.toml_exists" in ids

    def test_get_checks_by_category(self):
        scaff = get_checks_by_category("scaffolding")
        assert all(c.category == "scaffolding" for c in scaff)
        assert len(scaff) == 13


# ===================================================================
# report_schema.py tests
# ===================================================================


class TestReportSchema:
    def _valid_report(self) -> dict:
        return {
            "eval_id": "child-eval-20260320T120000Z-a1b2c3d4",
            "eval_spec_version": "0.1.0",
            "report_schema_version": "0.1.0",
            "platform_profile": "core",
            "verification_nonce": "nonce-123",
            "app_slug": "ce-0320-a1b2c3d4",
            "project_root": "/home/ubuntu/projects/ce-0320-a1b2c3d4",
            "python_module": "ce_0320_a1b2c3d4",
            "deployed_url": "https://ce-0320-a1b2c3d4.fly.dev",
            "commands_run": ["bui init", "bui deploy"],
            "known_issues": [],
        }

    def test_valid_report_accepted(self):
        ok, errors = validate_report(self._valid_report())
        assert ok, f"Validation errors: {errors}"

    def test_missing_required_fields(self):
        ok, errors = validate_report({"eval_id": "test"})
        assert not ok
        missing = [e for e in errors if "Missing required field" in e]
        assert len(missing) >= 6  # at least 7 other required fields

    def test_wrong_type_string(self):
        report = self._valid_report()
        report["eval_id"] = 123
        ok, errors = validate_report(report)
        assert not ok
        assert any("eval_id" in e for e in errors)

    def test_wrong_type_array(self):
        report = self._valid_report()
        report["commands_run"] = "not an array"
        ok, errors = validate_report(report)
        assert not ok

    def test_bad_enum_value(self):
        report = self._valid_report()
        report["platform_profile"] = "invalid-profile"
        ok, errors = validate_report(report)
        assert not ok
        assert any("platform_profile" in e for e in errors)

    def test_additional_properties_allowed(self):
        report = self._valid_report()
        report["extra_field"] = "allowed"
        ok, errors = validate_report(report)
        assert ok

    def test_null_optional_fields(self):
        report = self._valid_report()
        report["deployed_url"] = None
        report["fly_app_name"] = None
        ok, errors = validate_report(report)
        assert ok

    def test_extract_with_markers(self):
        report = self._valid_report()
        text = f"output\n{BEGIN_MARKER}\n{json.dumps(report)}\n{END_MARKER}\nmore"
        result = extract_report_from_text(text)
        assert result is not None
        assert result["eval_id"] == report["eval_id"]

    def test_extract_fenced_block(self):
        report = self._valid_report()
        text = f"output\n```json\n{json.dumps(report)}\n```\nmore"
        result = extract_report_from_text(text)
        assert result is not None
        assert result["eval_id"] == report["eval_id"]

    def test_extract_no_report(self):
        assert extract_report_from_text("just plain text") is None

    def test_extract_malformed_json(self):
        text = f"{BEGIN_MARKER}\n{{invalid json\n{END_MARKER}"
        assert extract_report_from_text(text) is None

    def test_extract_multiple_blocks_takes_first(self):
        r1 = self._valid_report()
        r2 = {**self._valid_report(), "eval_id": "second"}
        text = (
            f"{BEGIN_MARKER}\n{json.dumps(r1)}\n{END_MARKER}\n"
            f"{BEGIN_MARKER}\n{json.dumps(r2)}\n{END_MARKER}"
        )
        result = extract_report_from_text(text)
        assert result is not None
        assert result["eval_id"] == r1["eval_id"]

    def test_extract_events(self):
        from tests.eval.report_schema import BEGIN_EVENT_MARKER, END_EVENT_MARKER
        text = (
            f"{BEGIN_EVENT_MARKER}\n"
            '{"phase": "scaffold", "status": "started"}\n'
            f"{END_EVENT_MARKER}\n"
            f"{BEGIN_EVENT_MARKER}\n"
            '{"phase": "deploy", "status": "done"}\n'
            f"{END_EVENT_MARKER}"
        )
        events = extract_events_from_text(text)
        assert len(events) == 2
        assert events[0]["phase"] == "scaffold"


# ===================================================================
# capabilities.py tests
# ===================================================================


class TestCapabilities:
    def test_core_profile_requirements(self):
        core = get_profile_contract("core")
        assert core.requires_deploy is True
        assert core.requires_auth is False
        assert core.requires_neon is True
        assert core.requires_workspace is False

    def test_auth_plus_extends_core(self):
        auth = get_profile_contract("auth-plus")
        assert auth.requires_deploy is True
        assert auth.requires_auth is True  # extended from core

    def test_full_stack_extends_auth_plus(self):
        full = get_profile_contract("full-stack")
        assert full.requires_auth is True
        assert full.requires_workspace is True
        assert full.requires_files is True
        assert full.requires_git is True

    def test_unknown_profile_raises(self):
        with pytest.raises(KeyError):
            get_profile_contract("nonexistent")

    def test_profile_contract_round_trip(self):
        for name in PROFILES:
            p = get_profile_contract(name)
            d = p.to_dict()
            rt = ProfileContract.from_dict(d)
            assert rt.name == p.name
            assert rt.requires_deploy == p.requires_deploy

    def test_applicable_checks_core(self):
        checks = applicable_checks("core")
        ids = {c.id for c in checks}
        assert "scaff.dir_exists" in ids
        assert "deploy.auth_signup" not in ids

    def test_applicable_checks_full_stack(self):
        checks = applicable_checks("full-stack")
        extensible_only = [s for s in CATALOG.values() if s.profile == "extensible"]
        assert len(checks) == len(CATALOG) - len(extensible_only)

    def test_applicable_checks_extensible(self):
        checks = applicable_checks("extensible")
        assert len(checks) == len(CATALOG)

    def test_capability_manifest_from_platform_facts(self):
        facts = PlatformFacts(bui_version="0.1.0", fly_cli_version="0.2.0")
        manifest = CapabilityManifest.from_platform_facts(facts)
        assert manifest.bui_available is True
        assert manifest.fly_available is True
        assert manifest.deploy_support is True

    def test_validate_good_manifest(self):
        good = CapabilityManifest(
            bui_available=True, fly_available=True,
            vault_read=True, vault_write=True,
            network_ok=True, deploy_support=True,
            neon_setup_support=True,
        )
        issues = validate_profile_against_capabilities("core", good)
        assert len(issues) == 0

    def test_validate_missing_bui(self):
        bad = CapabilityManifest()
        issues = validate_profile_against_capabilities("core", bad)
        reqs = {i.requirement for i in issues}
        assert "bui_available" in reqs

    def test_enrich_manifest_with_preflight_results(self):
        manifest = CapabilityManifest()
        preflight_checks = [
            CheckResult("preflight.vault_read_access", "preflight", 0, CheckStatus.PASS),
            CheckResult("preflight.vault_write_access", "preflight", 0, CheckStatus.PASS),
            CheckResult("preflight.network_reachable", "preflight", 0, CheckStatus.PASS),
            CheckResult("preflight.fly_available", "preflight", 0, CheckStatus.PASS),
        ]

        enrich_manifest_with_preflight_results(manifest, preflight_checks)

        assert manifest.vault_read is True
        assert manifest.vault_write is True
        assert manifest.network_ok is True
        assert manifest.fly_available is True

    def test_skip_reasons_no_fly(self):
        manifest = CapabilityManifest(bui_available=True, fly_available=False)
        skips = skip_reasons_for_manifest("core", manifest)
        assert len(skips) > 0
        assert any("deploy" in k for k in skips)
