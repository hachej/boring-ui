"""Typed dataclasses for the eval harness.

Every dataclass supports JSON round-trip via ``to_dict()`` / ``from_dict()``.
These contracts are the foundation that the entire harness depends on.
"""

from __future__ import annotations

import re
import secrets
import string
from dataclasses import dataclass, field, fields
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from tests.eval.reason_codes import Attribution, CheckStatus, Confidence


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_RAND_CHARS = string.ascii_lowercase + string.digits


def _rand8() -> str:
    return "".join(secrets.choice(_RAND_CHARS) for _ in range(8))


def _utc_now_compact() -> str:
    """Return UTC timestamp in compact ISO-8601 form: ``20260320T120000Z``."""
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _enum_value(v: Any) -> Any:
    """Unwrap enum to its ``.value`` for JSON serialisation."""
    if hasattr(v, "value"):
        return v.value
    return v


def _serialise(obj: Any) -> Any:
    """Recursively serialise a value for JSON output."""
    if obj is None:
        return None
    if isinstance(obj, (str, int, float, bool)):
        return obj
    if hasattr(obj, "to_dict"):
        return obj.to_dict()
    if hasattr(obj, "value"):  # enum
        return obj.value
    if isinstance(obj, dict):
        return {k: _serialise(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_serialise(v) for v in obj]
    if isinstance(obj, Path):
        return str(obj)
    return str(obj)


# ---------------------------------------------------------------------------
# NamingContract
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class NamingContract:
    """Collision-resistant naming for a single eval run.

    All derived values are deterministic from ``eval_id``.

    - ``eval_id``:       ``child-eval-<utc-ts>-<rand8>``
    - ``app_slug``:      ``ce-<MMDD>-<rand8>``  (max 20 chars, Fly-safe)
    - ``python_module``: ``ce_<MMDD>_<rand8>``
    - ``project_root``:  ``<projects_root>/<app_slug>``
    """

    eval_id: str
    app_slug: str
    python_module: str
    project_root: str
    projects_root: str

    # -- factory ----------------------------------------------------------

    @classmethod
    def from_eval_id(
        cls,
        eval_id: str | None = None,
        projects_root: str = "/home/ubuntu/projects",
    ) -> NamingContract:
        """Generate a NamingContract, optionally from a pre-existing eval_id.

        If *eval_id* is ``None``, one is generated with the current UTC time
        and 8 random characters.
        """
        if eval_id is None:
            eval_id = f"child-eval-{_utc_now_compact()}-{_rand8()}"

        # Parse timestamp and rand from eval_id
        m = re.match(
            r"^child-eval-(\d{4})(\d{2})(\d{2})T\d{6}Z-([a-z0-9]{8})$",
            eval_id,
        )
        if not m:
            raise ValueError(
                f"eval_id does not match expected pattern "
                f"'child-eval-<YYYYMMDD>T<HHMMSS>Z-<rand8>': {eval_id!r}"
            )
        _year, month, day, rand = m.groups()
        app_slug = f"ce-{month}{day}-{rand}"
        python_module = f"ce_{month}{day}_{rand}"
        project_root = str(Path(projects_root) / app_slug)

        return cls(
            eval_id=eval_id,
            app_slug=app_slug,
            python_module=python_module,
            project_root=project_root,
            projects_root=projects_root,
        )

    # -- serialisation ----------------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        return {
            "eval_id": self.eval_id,
            "app_slug": self.app_slug,
            "python_module": self.python_module,
            "project_root": self.project_root,
            "projects_root": self.projects_root,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> NamingContract:
        return cls(
            eval_id=data["eval_id"],
            app_slug=data["app_slug"],
            python_module=data["python_module"],
            project_root=data["project_root"],
            projects_root=data["projects_root"],
        )


# ---------------------------------------------------------------------------
# RunManifest
# ---------------------------------------------------------------------------

@dataclass
class RunManifest:
    """Immutable run manifest written before launching the agent.

    Source of truth for naming contract, required routes, budgets,
    evidence paths, and report schema.
    """

    eval_id: str
    eval_spec_version: str
    report_schema_version: str
    platform_profile: str          # core | auth-plus | full-stack | extensible
    app_slug: str
    python_module: str
    project_root: str
    verification_nonce: str
    required_routes: list[str]     # e.g. ["/health", "/info"]
    report_output_path: str
    event_log_path: str
    timeouts: dict[str, int]       # phase -> seconds
    evidence_dir: str
    lease_id: str

    def to_dict(self) -> dict[str, Any]:
        return {f.name: _serialise(getattr(self, f.name)) for f in fields(self)}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> RunManifest:
        return cls(
            eval_id=data["eval_id"],
            eval_spec_version=data["eval_spec_version"],
            report_schema_version=data["report_schema_version"],
            platform_profile=data["platform_profile"],
            app_slug=data["app_slug"],
            python_module=data["python_module"],
            project_root=data["project_root"],
            verification_nonce=data["verification_nonce"],
            required_routes=list(data["required_routes"]),
            report_output_path=data["report_output_path"],
            event_log_path=data["event_log_path"],
            timeouts=dict(data["timeouts"]),
            evidence_dir=data["evidence_dir"],
            lease_id=data["lease_id"],
        )

    @classmethod
    def from_naming(
        cls,
        naming: NamingContract,
        *,
        platform_profile: str = "core",
        eval_spec_version: str = "0.1.0",
        report_schema_version: str = "0.1.0",
        timeouts: dict[str, int] | None = None,
    ) -> RunManifest:
        """Build a RunManifest from a NamingContract with sensible defaults."""
        evidence_dir = str(
            Path(naming.project_root).parent
            / ".eval-evidence"
            / naming.app_slug
        )
        required_routes = ["/health", "/info"]
        if platform_profile in ("auth-plus", "full-stack", "extensible"):
            required_routes.append("/whoami")

        return cls(
            eval_id=naming.eval_id,
            eval_spec_version=eval_spec_version,
            report_schema_version=report_schema_version,
            platform_profile=platform_profile,
            app_slug=naming.app_slug,
            python_module=naming.python_module,
            project_root=naming.project_root,
            verification_nonce=secrets.token_urlsafe(16),
            required_routes=required_routes,
            report_output_path=str(Path(evidence_dir) / "report.json"),
            event_log_path=str(Path(evidence_dir) / "events.jsonl"),
            timeouts=timeouts or {
                "scaffold": 300,
                "local_validation": 120,
                "neon_setup": 180,
                "deploy": 600,
                "live_validation": 120,
                "cleanup": 120,
            },
            evidence_dir=evidence_dir,
            lease_id=f"lease-{naming.app_slug}-{_rand8()}",
        )


# ---------------------------------------------------------------------------
# CheckResult
# ---------------------------------------------------------------------------

@dataclass
class CheckResult:
    """Result of a single eval check."""

    id: str                                         # e.g. "scaff.toml_valid"
    category: str                                   # e.g. "scaffolding"
    weight: float                                   # scoring weight
    status: CheckStatus
    reason_code: str = ""                           # stable reason code
    attribution: Attribution = Attribution.UNKNOWN
    retriable: bool = False
    confidence: Confidence = Confidence.HIGH
    skipped: bool = False
    blocked_by: list[str] = field(default_factory=list)
    evidence_refs: list[str] = field(default_factory=list)
    detail: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "category": self.category,
            "weight": self.weight,
            "status": self.status.value,
            "reason_code": self.reason_code,
            "attribution": self.attribution.value,
            "retriable": self.retriable,
            "confidence": self.confidence.value,
            "skipped": self.skipped,
            "blocked_by": list(self.blocked_by),
            "evidence_refs": list(self.evidence_refs),
            "detail": self.detail,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CheckResult:
        return cls(
            id=data["id"],
            category=data["category"],
            weight=float(data["weight"]),
            status=CheckStatus(data["status"]),
            reason_code=data.get("reason_code", ""),
            attribution=Attribution(data.get("attribution", "unknown")),
            retriable=data.get("retriable", False),
            confidence=Confidence(data.get("confidence", "high")),
            skipped=data.get("skipped", False),
            blocked_by=list(data.get("blocked_by", [])),
            evidence_refs=list(data.get("evidence_refs", [])),
            detail=data.get("detail", ""),
        )


# ---------------------------------------------------------------------------
# CategoryScore
# ---------------------------------------------------------------------------

@dataclass
class CategoryScore:
    """Aggregate score for a check category."""

    name: str
    score: float                   # 0.0–1.0
    gate: float                    # minimum score to pass the gate
    gate_met: bool
    passed_weight: float
    total_weight: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "score": self.score,
            "gate": self.gate,
            "gate_met": self.gate_met,
            "passed_weight": self.passed_weight,
            "total_weight": self.total_weight,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CategoryScore:
        return cls(
            name=data["name"],
            score=float(data["score"]),
            gate=float(data["gate"]),
            gate_met=bool(data["gate_met"]),
            passed_weight=float(data["passed_weight"]),
            total_weight=float(data["total_weight"]),
        )


# ---------------------------------------------------------------------------
# CleanupResult
# ---------------------------------------------------------------------------

@dataclass
class CleanupResult:
    """Outcome of cleaning up a single provider resource."""

    resource_type: str             # e.g. "fly_app", "neon_project", "directory"
    resource_id: str               # e.g. Fly app name, Neon project ID, path
    success: bool
    error: str = ""
    duration_seconds: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "resource_type": self.resource_type,
            "resource_id": self.resource_id,
            "success": self.success,
            "error": self.error,
            "duration_seconds": self.duration_seconds,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CleanupResult:
        return cls(
            resource_type=data["resource_type"],
            resource_id=data["resource_id"],
            success=bool(data["success"]),
            error=data.get("error", ""),
            duration_seconds=float(data.get("duration_seconds", 0.0)),
        )


# ---------------------------------------------------------------------------
# ObservedCommand
# ---------------------------------------------------------------------------

@dataclass
class ObservedCommand:
    """A command observed during agent execution (from event log)."""

    command: str
    exit_code: int | None = None
    timestamp: str = ""            # ISO-8601
    duration_seconds: float = 0.0
    cwd: str = ""
    phase: str = ""                # e.g. "scaffold", "deploy"

    def to_dict(self) -> dict[str, Any]:
        return {
            "command": self.command,
            "exit_code": self.exit_code,
            "timestamp": self.timestamp,
            "duration_seconds": self.duration_seconds,
            "cwd": self.cwd,
            "phase": self.phase,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ObservedCommand:
        return cls(
            command=data["command"],
            exit_code=data.get("exit_code"),
            timestamp=data.get("timestamp", ""),
            duration_seconds=float(data.get("duration_seconds", 0.0)),
            cwd=data.get("cwd", ""),
            phase=data.get("phase", ""),
        )


# ---------------------------------------------------------------------------
# PlatformFacts
# ---------------------------------------------------------------------------

@dataclass
class PlatformFacts:
    """Observed platform facts discovered from the repo/CLI at runtime.

    Populated by introspection before the eval run starts.
    """

    boring_ui_commit: str = ""
    boring_ui_dirty: bool = False
    bui_version: str = ""
    python_version: str = ""
    node_version: str = ""
    fly_cli_version: str = ""
    vault_available: bool = False
    neon_cli_version: str = ""
    os_info: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {f.name: _serialise(getattr(self, f.name)) for f in fields(self)}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PlatformFacts:
        return cls(**{
            f.name: data[f.name]
            for f in fields(cls)
            if f.name in data
        })


# ---------------------------------------------------------------------------
# OperationalMetrics
# ---------------------------------------------------------------------------

@dataclass
class OperationalMetrics:
    """Telemetry recorded during the eval run (initially unscored)."""

    time_to_local_health_seconds: Optional[float] = None
    time_to_live_health_seconds: Optional[float] = None
    deploy_propagation_seconds: Optional[float] = None
    retry_counts: dict[str, int] = field(default_factory=dict)
    provider_api_calls: dict[str, int] = field(default_factory=dict)
    evidence_bundle_size_bytes: Optional[int] = None

    def to_dict(self) -> dict[str, Any]:
        return {f.name: _serialise(getattr(self, f.name)) for f in fields(self)}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> OperationalMetrics:
        return cls(
            time_to_local_health_seconds=data.get("time_to_local_health_seconds"),
            time_to_live_health_seconds=data.get("time_to_live_health_seconds"),
            deploy_propagation_seconds=data.get("deploy_propagation_seconds"),
            retry_counts=dict(data.get("retry_counts", {})),
            provider_api_calls=dict(data.get("provider_api_calls", {})),
            evidence_bundle_size_bytes=data.get("evidence_bundle_size_bytes"),
        )


# ---------------------------------------------------------------------------
# EvalResult
# ---------------------------------------------------------------------------

@dataclass
class EvalResult:
    """Top-level result of a complete eval run."""

    eval_id: str
    status: CheckStatus
    status_detail: str = ""

    # Scores (0.0–1.0)
    core_score: float = 0.0
    extension_score: float = 0.0
    overall_score: float = 0.0

    # Failure summaries
    critical_failures: list[str] = field(default_factory=list)
    must_pass_failures: list[str] = field(default_factory=list)

    # Breakdown
    categories: list[CategoryScore] = field(default_factory=list)
    checks: list[CheckResult] = field(default_factory=list)

    # Deployment info
    deployed_url: str = ""
    fly_app_name: str = ""
    neon_project_id: str = ""

    # Cleanup
    cleanup_errors: list[CleanupResult] = field(default_factory=list)

    # Telemetry
    operational_metrics: Optional[OperationalMetrics] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "eval_id": self.eval_id,
            "status": self.status.value,
            "status_detail": self.status_detail,
            "core_score": self.core_score,
            "extension_score": self.extension_score,
            "overall_score": self.overall_score,
            "critical_failures": list(self.critical_failures),
            "must_pass_failures": list(self.must_pass_failures),
            "categories": [c.to_dict() for c in self.categories],
            "checks": [c.to_dict() for c in self.checks],
            "deployed_url": self.deployed_url,
            "fly_app_name": self.fly_app_name,
            "neon_project_id": self.neon_project_id,
            "cleanup_errors": [c.to_dict() for c in self.cleanup_errors],
            "operational_metrics": (
                self.operational_metrics.to_dict()
                if self.operational_metrics
                else None
            ),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> EvalResult:
        return cls(
            eval_id=data["eval_id"],
            status=CheckStatus(data["status"]),
            status_detail=data.get("status_detail", ""),
            core_score=float(data.get("core_score", 0.0)),
            extension_score=float(data.get("extension_score", 0.0)),
            overall_score=float(data.get("overall_score", 0.0)),
            critical_failures=list(data.get("critical_failures", [])),
            must_pass_failures=list(data.get("must_pass_failures", [])),
            categories=[
                CategoryScore.from_dict(c)
                for c in data.get("categories", [])
            ],
            checks=[
                CheckResult.from_dict(c) for c in data.get("checks", [])
            ],
            deployed_url=data.get("deployed_url", ""),
            fly_app_name=data.get("fly_app_name", ""),
            neon_project_id=data.get("neon_project_id", ""),
            cleanup_errors=[
                CleanupResult.from_dict(c)
                for c in data.get("cleanup_errors", [])
            ],
            operational_metrics=(
                OperationalMetrics.from_dict(data["operational_metrics"])
                if data.get("operational_metrics")
                else None
            ),
        )
