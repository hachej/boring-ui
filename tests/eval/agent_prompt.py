"""Prompt generator for the child app E2E eval.

The prompt is intentionally minimal: it points the agent at ``bui --help``
and specifies only what custom deliverables are required. The agent must
discover the workflow autonomously from the CLI documentation.

Usage::

    prompt = generate_prompt(manifest, profile="core")
    Path(manifest.evidence_dir, "prompt.txt").write_text(prompt)
"""

from __future__ import annotations

import json
import textwrap
from pathlib import Path
from typing import Any

from tests.eval.contracts import RunManifest
from tests.eval.report_schema import BEGIN_MARKER, END_MARKER


def generate_prompt(
    manifest: RunManifest,
    profile: str = "core",
) -> str:
    """Generate a minimal agent prompt from a RunManifest.

    The prompt is deterministic given the same manifest values.
    """
    whoami_section = ""
    if profile in ("auth-plus", "full-stack", "extensible"):
        whoami_section = textwrap.dedent("""
        GET /whoami  (authenticated)
          200 → {"user_id": "...", "email": "..."}
          401/403 when unauthenticated
        """)

    report_shape = json.dumps({
        "eval_id": manifest.eval_id,
        "verification_nonce": manifest.verification_nonce,
        "app_slug": manifest.app_slug,
        "project_root": manifest.project_root,
        "deployed_url": "https://...",
        "fly_app_name": "...",
        "neon_project_id": "...",
        "commands_run": ["..."],
        "steps": {"scaffold": {"status": "succeeded", "attempted": True}},
        "local_checks": [{"path": "/health", "status": 200}],
        "live_checks": [{"path": "/health", "status": 200}],
        "failures": [],
        "known_issues": [],
    }, indent=2)

    return textwrap.dedent(f"""\
        # Task

        Create, validate, and deploy a new boring-ui child app named `{manifest.app_slug}`.

        Start with `bui --help` to discover the workflow.

        ## App identity

        - App name: `{manifest.app_slug}`
        - Eval ID: `{manifest.eval_id}`
        - Verification nonce: `{manifest.verification_nonce}`
        - Project location: `{manifest.project_root}`

        ## Custom routes to add

        Add a router at `src/{manifest.python_module}/routers/status.py` with:

        GET /health →
          {{"ok": true, "app": "{manifest.app_slug}", "custom": true, "eval_id": "{manifest.eval_id}", "verification_nonce": "{manifest.verification_nonce}"}}

        GET /info →
          {{"name": "{manifest.app_slug}", "version": "0.1.0", "eval_id": "{manifest.eval_id}"}}
        {whoami_section}
        Wire these routes in `[backend].routers` in boring.app.toml.

        ## Constraints

        - Do not modify `../boring-ui/` or sibling directories.
        - Do not hardcode secrets — use Vault-backed refs.
        - Do not print raw secret values in your report.
        - Use `bui` for all platform workflows (scaffold, validate, deploy).
        - If a step fails, report the exact error — do not fabricate success.

        ## Report

        End with a machine-readable JSON block:

        ```
        {BEGIN_MARKER}
        {report_shape}
        {END_MARKER}
        ```

        Also write it to: `{manifest.report_output_path}`
    """)


def save_prompt(manifest: RunManifest, prompt: str) -> Path:
    """Save the prompt to the evidence directory."""
    evidence = Path(manifest.evidence_dir)
    evidence.mkdir(parents=True, exist_ok=True)
    prompt_path = evidence / "prompt.txt"
    prompt_path.write_text(prompt, encoding="utf-8")
    return prompt_path
