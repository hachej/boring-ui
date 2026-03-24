"""Stable reason codes, status/attribution enums, and retriable classifications.

Every non-PASS check result must include a reason_code from this module.
Codes are grouped by category prefix:

    SCAFF_*     Scaffold / file-structure failures
    WORKFLOW_*  Supported-workflow compliance failures
    LOCAL_*     Local dev runtime failures
    DEPLOY_*    Deployment / live-smoke failures
    SEC_*       Security hygiene failures
    REPORT_*    Agent report quality failures
    ENV_*       Environment / provider / harness-credential failures
    HARNESS_*   Harness bugs or internal errors
"""

from __future__ import annotations

from enum import Enum


# ---------------------------------------------------------------------------
# Core enums
# ---------------------------------------------------------------------------

class CheckStatus(str, Enum):
    """Outcome of a single eval check."""

    PASS = "PASS"
    FAIL = "FAIL"
    SKIP = "SKIP"
    INVALID = "INVALID"   # harness/environment failure — not an agent judgment
    ERROR = "ERROR"       # harness bug or unexpected checker failure

    def is_terminal_failure(self) -> bool:
        return self in (CheckStatus.FAIL, CheckStatus.ERROR)


class Attribution(str, Enum):
    """Who is responsible for a non-PASS result."""

    AGENT = "agent"
    PROVIDER = "provider"
    HARNESS = "harness"
    MIXED = "mixed"
    UNKNOWN = "unknown"


class Confidence(str, Enum):
    """How confident the harness is in its attribution."""

    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


# ---------------------------------------------------------------------------
# Reason codes — scaffold
# ---------------------------------------------------------------------------

SCAFF_DIR_MISSING = "SCAFF_DIR_MISSING"
SCAFF_TOML_INVALID = "SCAFF_TOML_INVALID"
SCAFF_TOML_MISSING = "SCAFF_TOML_MISSING"
SCAFF_TOML_FIELD_MISSING = "SCAFF_TOML_FIELD_MISSING"
SCAFF_TOML_FIELD_MISMATCH = "SCAFF_TOML_FIELD_MISMATCH"
SCAFF_ENTRY_MISSING = "SCAFF_ENTRY_MISSING"
SCAFF_ROUTER_MISSING = "SCAFF_ROUTER_MISSING"
SCAFF_ROUTE_MISSING = "SCAFF_ROUTE_MISSING"
SCAFF_GIT_MISSING = "SCAFF_GIT_MISSING"
SCAFF_GIT_NO_COMMITS = "SCAFF_GIT_NO_COMMITS"
SCAFF_UNEXPECTED_FILES = "SCAFF_UNEXPECTED_FILES"

# ---------------------------------------------------------------------------
# Reason codes — workflow compliance
# ---------------------------------------------------------------------------

WORKFLOW_BUI_NOT_USED = "WORKFLOW_BUI_NOT_USED"
WORKFLOW_BYPASS_DETECTED = "WORKFLOW_BYPASS_DETECTED"
WORKFLOW_INIT_FAILED = "WORKFLOW_INIT_FAILED"
WORKFLOW_DOCTOR_FAILED = "WORKFLOW_DOCTOR_FAILED"
WORKFLOW_DOCTOR_SKIPPED = "WORKFLOW_DOCTOR_SKIPPED"
WORKFLOW_NEON_SETUP_FAILED = "WORKFLOW_NEON_SETUP_FAILED"
WORKFLOW_NEON_SETUP_SKIPPED = "WORKFLOW_NEON_SETUP_SKIPPED"
WORKFLOW_DEPLOY_CMD_FAILED = "WORKFLOW_DEPLOY_CMD_FAILED"
WORKFLOW_DEPLOY_CMD_SKIPPED = "WORKFLOW_DEPLOY_CMD_SKIPPED"
WORKFLOW_ORDER_VIOLATION = "WORKFLOW_ORDER_VIOLATION"

# ---------------------------------------------------------------------------
# Reason codes — local dev runtime
# ---------------------------------------------------------------------------

LOCAL_STARTUP_FAILED = "LOCAL_STARTUP_FAILED"
LOCAL_STARTUP_TIMEOUT = "LOCAL_STARTUP_TIMEOUT"
LOCAL_ROUTE_MISMATCH = "LOCAL_ROUTE_MISMATCH"
LOCAL_ROUTE_MISSING = "LOCAL_ROUTE_MISSING"
LOCAL_HEALTH_FAILED = "LOCAL_HEALTH_FAILED"
LOCAL_NONCE_MISMATCH = "LOCAL_NONCE_MISMATCH"
LOCAL_RESPONSE_INVALID = "LOCAL_RESPONSE_INVALID"

# ---------------------------------------------------------------------------
# Reason codes — deployment / live smoke
# ---------------------------------------------------------------------------

DEPLOY_UNREACHABLE = "DEPLOY_UNREACHABLE"
DEPLOY_AUTH_FAILED = "DEPLOY_AUTH_FAILED"
DEPLOY_ROUTE_MISSING = "DEPLOY_ROUTE_MISSING"
DEPLOY_ROUTE_MISMATCH = "DEPLOY_ROUTE_MISMATCH"
DEPLOY_HEALTH_FAILED = "DEPLOY_HEALTH_FAILED"
DEPLOY_NONCE_MISMATCH = "DEPLOY_NONCE_MISMATCH"
DEPLOY_RESPONSE_INVALID = "DEPLOY_RESPONSE_INVALID"
DEPLOY_TIMEOUT = "DEPLOY_TIMEOUT"
DEPLOY_DNS_FAILURE = "DEPLOY_DNS_FAILURE"
DEPLOY_TLS_FAILURE = "DEPLOY_TLS_FAILURE"

# ---------------------------------------------------------------------------
# Reason codes — security hygiene
# ---------------------------------------------------------------------------

SEC_SECRET_LEAKED = "SEC_SECRET_LEAKED"
SEC_SECRET_IN_REPORT = "SEC_SECRET_IN_REPORT"
SEC_SECRET_IN_EVIDENCE = "SEC_SECRET_IN_EVIDENCE"
SEC_SECRET_HARDCODED = "SEC_SECRET_HARDCODED"
SEC_SCOPE_VIOLATION = "SEC_SCOPE_VIOLATION"
SEC_TRAVERSAL_DETECTED = "SEC_TRAVERSAL_DETECTED"
SEC_VAULT_NOT_USED = "SEC_VAULT_NOT_USED"

# ---------------------------------------------------------------------------
# Reason codes — report quality
# ---------------------------------------------------------------------------

REPORT_JSON_MISSING = "REPORT_JSON_MISSING"
REPORT_JSON_INVALID = "REPORT_JSON_INVALID"
REPORT_FIELD_MISSING = "REPORT_FIELD_MISSING"
REPORT_CLAIM_DISPROVED = "REPORT_CLAIM_DISPROVED"
REPORT_URL_INVALID = "REPORT_URL_INVALID"
REPORT_EVAL_ID_MISSING = "REPORT_EVAL_ID_MISSING"
REPORT_NONCE_MISSING = "REPORT_NONCE_MISSING"
REPORT_INCONSISTENT = "REPORT_INCONSISTENT"

# ---------------------------------------------------------------------------
# Reason codes — environment / provider
# ---------------------------------------------------------------------------

ENV_BUI_MISSING = "ENV_BUI_MISSING"
ENV_FLY_AUTH = "ENV_FLY_AUTH"
ENV_VAULT_READ_DENIED = "ENV_VAULT_READ_DENIED"
ENV_VAULT_WRITE_DENIED = "ENV_VAULT_WRITE_DENIED"
ENV_NEON_AUTH_FAILED = "ENV_NEON_AUTH_FAILED"
ENV_PROVIDER_OUTAGE = "ENV_PROVIDER_OUTAGE"
ENV_PROVIDER_TIMEOUT = "ENV_PROVIDER_TIMEOUT"
ENV_DEPENDENCY_MISSING = "ENV_DEPENDENCY_MISSING"
ENV_CREDENTIAL_EXPIRED = "ENV_CREDENTIAL_EXPIRED"

# ---------------------------------------------------------------------------
# Reason codes — harness internal
# ---------------------------------------------------------------------------

HARNESS_BUG = "HARNESS_BUG"
HARNESS_TIMEOUT = "HARNESS_TIMEOUT"
HARNESS_CONFIG_ERROR = "HARNESS_CONFIG_ERROR"
HARNESS_ASSERTION_ERROR = "HARNESS_ASSERTION_ERROR"
HARNESS_CLEANUP_FAILED = "HARNESS_CLEANUP_FAILED"


# ---------------------------------------------------------------------------
# Retriable classification
# ---------------------------------------------------------------------------

#: Reason codes that represent plausibly transient failures worth retrying.
RETRIABLE_CODES: frozenset[str] = frozenset({
    LOCAL_STARTUP_TIMEOUT,
    DEPLOY_UNREACHABLE,
    DEPLOY_TIMEOUT,
    DEPLOY_DNS_FAILURE,
    DEPLOY_TLS_FAILURE,
    ENV_PROVIDER_OUTAGE,
    ENV_PROVIDER_TIMEOUT,
    ENV_CREDENTIAL_EXPIRED,
    HARNESS_TIMEOUT,
})


def is_retriable(reason_code: str) -> bool:
    """Return True if a reason code represents a plausibly transient failure."""
    return reason_code in RETRIABLE_CODES


# ---------------------------------------------------------------------------
# Default attribution map
# ---------------------------------------------------------------------------

#: Default attribution when the harness cannot determine root cause.
DEFAULT_ATTRIBUTION: dict[str, Attribution] = {
    # Scaffold failures are agent's responsibility
    SCAFF_DIR_MISSING: Attribution.AGENT,
    SCAFF_TOML_INVALID: Attribution.AGENT,
    SCAFF_TOML_MISSING: Attribution.AGENT,
    SCAFF_TOML_FIELD_MISSING: Attribution.AGENT,
    SCAFF_TOML_FIELD_MISMATCH: Attribution.AGENT,
    SCAFF_ENTRY_MISSING: Attribution.AGENT,
    SCAFF_ROUTER_MISSING: Attribution.AGENT,
    SCAFF_ROUTE_MISSING: Attribution.AGENT,
    SCAFF_GIT_MISSING: Attribution.AGENT,
    SCAFF_GIT_NO_COMMITS: Attribution.AGENT,
    SCAFF_UNEXPECTED_FILES: Attribution.AGENT,

    # Workflow compliance is agent's responsibility
    WORKFLOW_BUI_NOT_USED: Attribution.AGENT,
    WORKFLOW_BYPASS_DETECTED: Attribution.AGENT,
    WORKFLOW_INIT_FAILED: Attribution.MIXED,
    WORKFLOW_DOCTOR_FAILED: Attribution.AGENT,
    WORKFLOW_DOCTOR_SKIPPED: Attribution.AGENT,
    WORKFLOW_NEON_SETUP_FAILED: Attribution.MIXED,
    WORKFLOW_NEON_SETUP_SKIPPED: Attribution.AGENT,
    WORKFLOW_DEPLOY_CMD_FAILED: Attribution.MIXED,
    WORKFLOW_DEPLOY_CMD_SKIPPED: Attribution.AGENT,
    WORKFLOW_ORDER_VIOLATION: Attribution.AGENT,

    # Local dev — mostly agent, but startup can be mixed
    LOCAL_STARTUP_FAILED: Attribution.MIXED,
    LOCAL_STARTUP_TIMEOUT: Attribution.MIXED,
    LOCAL_ROUTE_MISMATCH: Attribution.AGENT,
    LOCAL_ROUTE_MISSING: Attribution.AGENT,
    LOCAL_HEALTH_FAILED: Attribution.AGENT,
    LOCAL_NONCE_MISMATCH: Attribution.AGENT,
    LOCAL_RESPONSE_INVALID: Attribution.AGENT,

    # Deployment — mixed, depends on provider
    DEPLOY_UNREACHABLE: Attribution.MIXED,
    DEPLOY_AUTH_FAILED: Attribution.MIXED,
    DEPLOY_ROUTE_MISSING: Attribution.AGENT,
    DEPLOY_ROUTE_MISMATCH: Attribution.AGENT,
    DEPLOY_HEALTH_FAILED: Attribution.MIXED,
    DEPLOY_NONCE_MISMATCH: Attribution.AGENT,
    DEPLOY_RESPONSE_INVALID: Attribution.AGENT,
    DEPLOY_TIMEOUT: Attribution.PROVIDER,
    DEPLOY_DNS_FAILURE: Attribution.PROVIDER,
    DEPLOY_TLS_FAILURE: Attribution.PROVIDER,

    # Security — agent's responsibility
    SEC_SECRET_LEAKED: Attribution.AGENT,
    SEC_SECRET_IN_REPORT: Attribution.AGENT,
    SEC_SECRET_IN_EVIDENCE: Attribution.HARNESS,
    SEC_SECRET_HARDCODED: Attribution.AGENT,
    SEC_SCOPE_VIOLATION: Attribution.AGENT,
    SEC_TRAVERSAL_DETECTED: Attribution.AGENT,
    SEC_VAULT_NOT_USED: Attribution.AGENT,

    # Report quality — agent's responsibility
    REPORT_JSON_MISSING: Attribution.AGENT,
    REPORT_JSON_INVALID: Attribution.AGENT,
    REPORT_FIELD_MISSING: Attribution.AGENT,
    REPORT_CLAIM_DISPROVED: Attribution.AGENT,
    REPORT_URL_INVALID: Attribution.AGENT,
    REPORT_EVAL_ID_MISSING: Attribution.AGENT,
    REPORT_NONCE_MISSING: Attribution.AGENT,
    REPORT_INCONSISTENT: Attribution.AGENT,

    # Environment — provider/harness responsibility
    ENV_BUI_MISSING: Attribution.HARNESS,
    ENV_FLY_AUTH: Attribution.HARNESS,
    ENV_VAULT_READ_DENIED: Attribution.HARNESS,
    ENV_VAULT_WRITE_DENIED: Attribution.HARNESS,
    ENV_NEON_AUTH_FAILED: Attribution.PROVIDER,
    ENV_PROVIDER_OUTAGE: Attribution.PROVIDER,
    ENV_PROVIDER_TIMEOUT: Attribution.PROVIDER,
    ENV_DEPENDENCY_MISSING: Attribution.HARNESS,
    ENV_CREDENTIAL_EXPIRED: Attribution.HARNESS,

    # Harness internal — harness responsibility
    HARNESS_BUG: Attribution.HARNESS,
    HARNESS_TIMEOUT: Attribution.HARNESS,
    HARNESS_CONFIG_ERROR: Attribution.HARNESS,
    HARNESS_ASSERTION_ERROR: Attribution.HARNESS,
    HARNESS_CLEANUP_FAILED: Attribution.HARNESS,
}


def default_attribution(reason_code: str) -> Attribution:
    """Return the default attribution for a reason code."""
    return DEFAULT_ATTRIBUTION.get(reason_code, Attribution.UNKNOWN)
