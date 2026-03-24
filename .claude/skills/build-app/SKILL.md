---
name: build-app
description: Create, build, and deploy a new boring-ui child app from a feature description. Use when the user wants to create a new app, build a new child app, or deploy a new project.
argument-hint: "[feature description]"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent
---

# Build a boring-ui child app

You are building a new boring-ui child app. Your only tool reference is `bui --help`.

## What to build

$ARGUMENTS

## Setup

Generate a unique app identity:

```python
python3 -c "
from tests.eval.contracts import NamingContract, RunManifest
import json, secrets
nc = NamingContract.from_eval_id()
m = RunManifest.from_naming(nc, platform_profile='core')
print(json.dumps({
    'app_slug': nc.app_slug,
    'eval_id': nc.eval_id,
    'python_module': nc.python_module,
    'project_root': nc.project_root,
    'verification_nonce': m.verification_nonce,
    'report_output_path': m.report_output_path,
}, indent=2))
"
```

Use the generated `app_slug` as the app name for `bui init`.

## Workflow

1. Run `bui --help` to understand available commands
2. Run `bui docs quickstart` for the full autonomous walkthrough
3. Follow the bui workflow: init → add features → doctor → neon setup → deploy
4. Build the feature described above as custom routers + panels

## Verification endpoints

Every app must include a status router with these exact endpoints:

- `GET /health` → `{"ok": true, "app": "<app_slug>", "custom": true, "eval_id": "<eval_id>", "verification_nonce": "<nonce>"}`
- `GET /info` → `{"name": "<app_slug>", "version": "0.1.0", "eval_id": "<eval_id>"}`

## Report

When done, emit a structured report:

```
BEGIN_EVAL_REPORT_JSON
{
  "eval_id": "<eval_id>",
  "verification_nonce": "<nonce>",
  "app_slug": "<app_slug>",
  "project_root": "<project_root>",
  "deployed_url": "https://<app_slug>.fly.dev",
  "fly_app_name": "<app_slug>",
  "neon_project_id": "...",
  "commands_run": ["bui init ...", "bui doctor", "bui deploy"],
  "steps": {},
  "local_checks": [],
  "live_checks": [],
  "failures": [],
  "known_issues": []
}
END_EVAL_REPORT_JSON
```
