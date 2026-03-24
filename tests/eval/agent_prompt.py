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

    extensible_section = ""
    if profile == "extensible":
        extensible_section = f"""
## Extensible Profile — Custom Pane + Custom Tool

In addition to everything above, you must create:

**Custom workspace pane** (`kurt/panels/eval-status/Panel.jsx`):
- Default-export a React component.
- Render the `eval_id` ("{manifest.eval_id}") and `verification_nonce`
  ("{manifest.verification_nonce}") visibly.
- On mount or via a button, call `GET /api/x/eval_tool/compute?input=<value>`
  and display the response.

**Custom backend router** (`src/{manifest.python_module}/routers/eval_tool.py`):
- Expose `GET /api/x/eval_tool/compute` accepting query parameter `input`.
- Return:
    {{"result": "<deterministic_transform(input)>", "input": "<original_input>", "eval_id": "{manifest.eval_id}", "verification_nonce": "{manifest.verification_nonce}"}}
- The transformation must be non-trivial but deterministic (e.g., reverse +
  uppercase, word count + SHA256 prefix, or similar).
- Declare this router in `boring.app.toml` under `[backend].routers`.

**Verification before deploy:**
- `/api/capabilities` must include the custom pane in `workspace_panes`.
- The custom router must respond correctly at its mounted path.
- The pane component must load without JS errors.

**After deploy, verify:**
- The custom router is live and returns the expected response.
- The capabilities endpoint advertises the workspace pane.

**The pane must call the tool router** — they must work together, not just
coexist.
"""

    return f"""# Task

Create, validate, and deploy a boring-ui child app to Fly.io.

Start with `bui --help` to discover the full workflow, then run `bui init`,
`bui doctor`, and `bui deploy` to scaffold, validate, and deploy the app.

## App identity

- App name: `{manifest.app_slug}`
- Eval ID: `{manifest.eval_id}`
- Verification nonce: `{manifest.verification_nonce}`
- Project location: `{manifest.project_root}`

## What to build

**Verification endpoints** (`src/{manifest.python_module}/routers/status.py`):

  GET /health → {{"ok": true, "app": "{manifest.app_slug}", "custom": true, "eval_id": "{manifest.eval_id}", "verification_nonce": "{manifest.verification_nonce}"}}
  GET /info   → {{"name": "{manifest.app_slug}", "version": "0.1.0", "eval_id": "{manifest.eval_id}"}}
{whoami_section}
**Quick Notes feature** — a working pane + API for saving short text notes:

  Backend (`src/{manifest.python_module}/routers/notes.py`):
    POST /notes       {{"text": "..."}}  → {{"id": "...", "text": "...", "created_at": "..."}}
    GET  /notes                          → [{{"id": "...", "text": "...", "created_at": "..."}}]
    DELETE /notes/{{id}}                  → {{"deleted": true}}

  Frontend (`panels/NotesPanel.jsx`):
    A panel that lists notes, lets you add new ones, and delete them.

Wire all routers and the panel in boring.app.toml. Deploy to Fly.io.
{extensible_section}
Constraints:
- Do NOT modify `../boring-ui/` or sibling directories.
- Do NOT hardcode secrets; use Vault-backed deploy secret refs.

## Report

End with:

```
{BEGIN_MARKER}
{report_shape}
{END_MARKER}
```

Write it to: `{manifest.report_output_path}`
"""


def save_prompt(manifest: RunManifest, prompt: str) -> Path:
    """Save the prompt to the evidence directory."""
    evidence = Path(manifest.evidence_dir)
    evidence.mkdir(parents=True, exist_ok=True)
    prompt_path = evidence / "prompt.txt"
    prompt_path.write_text(prompt, encoding="utf-8")
    return prompt_path
