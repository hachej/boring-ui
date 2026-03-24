"""Machine-readable response schema for the agent's final eval report.

The agent wraps its structured report between ``BEGIN_EVAL_REPORT_JSON``
and ``END_EVAL_REPORT_JSON`` markers.  This module defines:

- ``REPORT_SCHEMA``: JSON Schema (draft 2020-12) for the report payload.
- ``validate_report(json_dict)``: Validate against the schema.
- ``extract_report_from_text(text)``: Extract the JSON block from raw text.
"""

from __future__ import annotations

import json
import re
from typing import Any

# ---------------------------------------------------------------------------
# Markers
# ---------------------------------------------------------------------------

BEGIN_MARKER = "BEGIN_EVAL_REPORT_JSON"
END_MARKER = "END_EVAL_REPORT_JSON"

BEGIN_EVENT_MARKER = "BEGIN_EVAL_EVENT_JSON"
END_EVENT_MARKER = "END_EVAL_EVENT_JSON"


# ---------------------------------------------------------------------------
# JSON Schema (draft 2020-12)
# ---------------------------------------------------------------------------

REPORT_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "Child App E2E Eval Report",
    "description": "Machine-readable report from the agent after an eval run.",
    "type": "object",
    "required": [
        "eval_id",
        "eval_spec_version",
        "report_schema_version",
        "platform_profile",
        "verification_nonce",
        "app_slug",
        "project_root",
        "python_module",
    ],
    "properties": {
        "eval_id": {
            "type": "string",
            "description": "Unique eval run identifier (child-eval-<ts>-<rand8>)",
        },
        "eval_spec_version": {
            "type": "string",
            "description": "Eval specification version",
        },
        "report_schema_version": {
            "type": "string",
            "description": "Report schema version",
        },
        "platform_profile": {
            "type": "string",
            "enum": ["core", "auth-plus", "full-stack", "extensible"],
            "description": "Eval profile used for this run",
        },
        "verification_nonce": {
            "type": "string",
            "description": "Nonce from the run manifest, echoed back for verification",
        },
        "app_slug": {
            "type": "string",
            "description": "Short app identifier (ce-<MMDD>-<rand8>)",
        },
        "project_root": {
            "type": "string",
            "description": "Absolute path to the generated child app directory",
        },
        "python_module": {
            "type": "string",
            "description": "Python module name (ce_<MMDD>_<rand8>)",
        },
        "deployed_url": {
            "type": ["string", "null"],
            "description": "URL of the deployed application",
        },
        "fly_app_name": {
            "type": ["string", "null"],
            "description": "Fly.io app name",
        },
        "neon_project_id": {
            "type": ["string", "null"],
            "description": "Neon project identifier",
        },
        "vault_secret_refs": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["name"],
                "properties": {
                    "name": {"type": "string"},
                    "vault": {"type": "string"},
                    "field": {"type": "string"},
                },
                "additionalProperties": True,
            },
            "description": "Vault secret references used (no raw values)",
        },
        "commands_run": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Commands the agent actually ran",
        },
        "steps": {
            "type": "object",
            "additionalProperties": {
                "type": "object",
                "required": ["status", "attempted"],
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": ["succeeded", "failed", "skipped", "not_attempted"],
                    },
                    "attempted": {"type": "boolean"},
                    "error": {"type": "string"},
                },
                "additionalProperties": True,
            },
            "description": "Per-step outcomes (scaffold, local_validate, neon_setup, deploy)",
        },
        "local_checks": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["path", "status"],
                "properties": {
                    "path": {"type": "string"},
                    "status": {"type": "integer"},
                    "body": {},
                },
                "additionalProperties": True,
            },
            "description": "Agent-observed local endpoint check results",
        },
        "live_checks": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["path", "status"],
                "properties": {
                    "path": {"type": "string"},
                    "status": {"type": "integer"},
                    "body": {},
                },
                "additionalProperties": True,
            },
            "description": "Agent-observed live endpoint check results",
        },
        "unverified_steps": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Steps the agent could not verify",
        },
        "failures": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Human-readable failure descriptions",
        },
        "resource_inventory": {
            "type": "object",
            "properties": {
                "fly_app_name": {"type": ["string", "null"]},
                "neon_project_id": {"type": ["string", "null"]},
            },
            "additionalProperties": True,
            "description": "Provider resource identifiers created during the run",
        },
        "timings_s": {
            "type": "object",
            "additionalProperties": {"type": "number"},
            "description": "Agent-reported timings in seconds (advisory)",
        },
        "known_issues": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Residual issues or risks",
        },
    },
    "additionalProperties": True,
}


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def validate_report(report: dict[str, Any]) -> tuple[bool, list[str]]:
    """Validate *report* against the schema.

    Returns ``(valid, errors)`` where *errors* is a list of human-readable
    messages.  Uses a lightweight built-in check (no ``jsonschema``
    dependency required) for the required fields and basic type checks.
    """
    errors: list[str] = []
    props = REPORT_SCHEMA["properties"]
    required = set(REPORT_SCHEMA["required"])

    # Required field presence
    for field_name in required:
        if field_name not in report:
            errors.append(f"Missing required field: {field_name}")

    # Type checks for present fields
    for field_name, value in report.items():
        if field_name not in props:
            continue  # additionalProperties allowed
        expected = props[field_name].get("type")
        if expected is None:
            continue
        if not _type_matches(value, expected):
            errors.append(
                f"Field {field_name!r}: expected type {expected}, "
                f"got {type(value).__name__}"
            )

    # Enum checks
    for field_name, value in report.items():
        if field_name not in props:
            continue
        allowed = props[field_name].get("enum")
        if allowed is not None and value not in allowed:
            errors.append(
                f"Field {field_name!r}: value {value!r} not in {allowed}"
            )

    return (len(errors) == 0, errors)


def _type_matches(value: Any, expected: str | list[str]) -> bool:
    """Check if *value* matches the JSON Schema *expected* type(s)."""
    if isinstance(expected, list):
        return any(_type_matches(value, t) for t in expected)
    mapping = {
        "string": str,
        "integer": int,
        "number": (int, float),
        "boolean": bool,
        "array": list,
        "object": dict,
        "null": type(None),
    }
    py_type = mapping.get(expected)
    if py_type is None:
        return True  # unknown type, accept
    # In Python, bool is a subclass of int; exclude bools from int/number
    if expected in ("integer", "number") and isinstance(value, bool):
        return False
    return isinstance(value, py_type)


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------

# Regex for the explicit markers (most reliable)
_MARKER_RE = re.compile(
    rf"{re.escape(BEGIN_MARKER)}\s*\n(.*?)\n\s*{re.escape(END_MARKER)}",
    re.DOTALL,
)

# Fallback: look for a fenced JSON code block containing eval_id
_FENCED_RE = re.compile(
    r"```(?:json)?\s*\n(\{.*?\"eval_id\".*?\})\s*\n```",
    re.DOTALL,
)

# Last resort: bare JSON object with eval_id
_BARE_RE = re.compile(
    r"(\{[^{}]*\"eval_id\"[^{}]*\})",
    re.DOTALL,
)


def extract_report_from_text(text: str) -> dict[str, Any] | None:
    """Extract the machine-readable report JSON from *text*.

    Tries, in order:
    1. Explicit BEGIN/END markers
    2. Fenced JSON code block containing ``eval_id``
    3. Bare JSON object containing ``eval_id``

    Returns the parsed dict or ``None`` if extraction fails.
    """
    # Strategy 1: explicit markers
    m = _MARKER_RE.search(text)
    if m:
        return _try_parse(m.group(1).strip())

    # Strategy 2: fenced code block
    m = _FENCED_RE.search(text)
    if m:
        return _try_parse(m.group(1).strip())

    # Strategy 3: bare JSON (greedy, may be fragile)
    m = _BARE_RE.search(text)
    if m:
        return _try_parse(m.group(1).strip())

    return None


def extract_events_from_text(text: str) -> list[dict[str, Any]]:
    """Extract progress event JSON blocks from *text*.

    Looks for ``BEGIN_EVAL_EVENT_JSON`` / ``END_EVAL_EVENT_JSON`` pairs.
    """
    pattern = re.compile(
        rf"{re.escape(BEGIN_EVENT_MARKER)}\s*\n(.*?)\n\s*{re.escape(END_EVENT_MARKER)}",
        re.DOTALL,
    )
    events: list[dict[str, Any]] = []
    for m in pattern.finditer(text):
        parsed = _try_parse(m.group(1).strip())
        if parsed is not None:
            events.append(parsed)
    return events


def _try_parse(text: str) -> dict[str, Any] | None:
    """Attempt to parse *text* as JSON; return dict or None."""
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except (json.JSONDecodeError, ValueError):
        pass
    return None
