"""Evidence bundle writer for the eval harness.

Writes all artifacts to ``<evidence_dir>/`` with redaction applied
before any data touches disk.
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from tests.eval.contracts import EvalResult, RunManifest
from tests.eval.redaction import SecretRegistry
from tests.eval.runners.base import RunResult


# ---------------------------------------------------------------------------
# Artifact manifest entry
# ---------------------------------------------------------------------------

@dataclass
class ArtifactEntry:
    """Metadata for a single evidence artifact."""

    filename: str
    sha256: str
    size_bytes: int
    redacted: bool
    producer: str = "harness"

    def to_dict(self) -> dict[str, Any]:
        return {
            "filename": self.filename,
            "sha256": self.sha256,
            "size_bytes": self.size_bytes,
            "redacted": self.redacted,
            "producer": self.producer,
        }


# ---------------------------------------------------------------------------
# EvidenceWriter
# ---------------------------------------------------------------------------

class EvidenceWriter:
    """Writes evidence artifacts with redaction.

    All writes go through the SecretRegistry before hitting disk.
    """

    def __init__(
        self,
        evidence_dir: str | Path,
        registry: SecretRegistry | None = None,
    ) -> None:
        self._dir = Path(evidence_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._registry = registry or SecretRegistry()
        self._artifacts: list[ArtifactEntry] = []

    @property
    def evidence_dir(self) -> Path:
        return self._dir

    @property
    def artifacts(self) -> list[ArtifactEntry]:
        return list(self._artifacts)

    def write_text(
        self,
        filename: str,
        content: str,
        producer: str = "harness",
        redact: bool = True,
    ) -> Path:
        """Write a text file with optional redaction."""
        if redact:
            content = self._registry.redact(content)

        path = self._dir / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

        self._record(filename, content.encode(), redact, producer)
        return path

    def write_json(
        self,
        filename: str,
        data: Any,
        producer: str = "harness",
        redact: bool = True,
    ) -> Path:
        """Write a JSON file with optional redaction."""
        text = json.dumps(data, indent=2, default=str)
        return self.write_text(filename, text, producer=producer, redact=redact)

    def write_run_result(self, run_result: RunResult) -> None:
        """Write agent stdout, stderr, and final response."""
        self.write_text("agent_stdout.txt", run_result.stdout, producer="agent")
        self.write_text("agent_stderr.txt", run_result.stderr, producer="agent")
        self.write_text(
            "agent_final_response.txt",
            run_result.final_response,
            producer="agent",
        )
        if run_result.command_log:
            self.write_json(
                "command_log.jsonl",
                [cmd.to_dict() for cmd in run_result.command_log],
                producer="agent",
            )

    def write_summary(
        self,
        manifest: RunManifest,
        eval_result: EvalResult,
    ) -> Path:
        """Write the summary.json with complete eval results."""
        summary = {
            "eval_id": manifest.eval_id,
            "status": eval_result.status.value,
            "status_detail": eval_result.status_detail,
            "core_score": eval_result.core_score,
            "extension_score": eval_result.extension_score,
            "overall_score": eval_result.overall_score,
            "critical_failures": eval_result.critical_failures,
            "must_pass_failures": eval_result.must_pass_failures,
            "categories": [c.to_dict() for c in eval_result.categories],
            "check_count": len(eval_result.checks),
            "passed_count": sum(
                1 for c in eval_result.checks if c.status.value == "PASS"
            ),
            "failed_count": sum(
                1 for c in eval_result.checks if c.status.value == "FAIL"
            ),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        return self.write_json("summary.json", summary, redact=False)

    def write_artifact_manifest(self) -> Path:
        """Write the artifact manifest listing all evidence files."""
        manifest = {
            "artifacts": [a.to_dict() for a in self._artifacts],
            "total_bytes": sum(a.size_bytes for a in self._artifacts),
            "artifact_count": len(self._artifacts),
        }
        return self.write_json(
            "artifact_manifest.json", manifest, redact=False
        )

    def _record(
        self,
        filename: str,
        content_bytes: bytes,
        redacted: bool,
        producer: str,
    ) -> None:
        """Record an artifact in the internal manifest."""
        self._artifacts.append(ArtifactEntry(
            filename=filename,
            sha256=hashlib.sha256(content_bytes).hexdigest(),
            size_bytes=len(content_bytes),
            redacted=redacted,
            producer=producer,
        ))


# ---------------------------------------------------------------------------
# Convenience: write full evidence bundle
# ---------------------------------------------------------------------------

def write_evidence_bundle(
    manifest: RunManifest,
    eval_result: EvalResult,
    run_result: RunResult,
    registry: SecretRegistry | None = None,
) -> EvidenceWriter:
    """Write the complete evidence bundle.

    Returns the EvidenceWriter with all artifacts recorded.
    """
    writer = EvidenceWriter(manifest.evidence_dir, registry)

    # Manifest
    writer.write_json("run_manifest.json", manifest.to_dict(), redact=False)

    # Agent output
    writer.write_run_result(run_result)

    # Scoring results
    writer.write_json("eval_result.json", eval_result.to_dict())

    # Summary
    writer.write_summary(manifest, eval_result)

    # Artifact manifest (always last)
    writer.write_artifact_manifest()

    return writer
