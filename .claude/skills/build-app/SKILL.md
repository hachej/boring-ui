---
name: build-app
description: Create, build, and deploy a new boring-ui child app from a feature description. Use when the user wants to create a new app, build a new child app, or deploy a new project.
argument-hint: "[feature description]"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion
---

# Build a boring-ui child app

## Phase 1: Requirements gathering

The user wants to build: $ARGUMENTS

Before writing any code, interview the user to clarify requirements. Ask about:

1. **Core functionality** — What exactly should the app do? What are the key user actions?
2. **Data model** — What data does it store? What fields? Persistence needs (in-memory OK or needs database)?
3. **Custom panels** — What should the UI panel(s) look like? What interactions (list, create, edit, delete)?
4. **Custom API endpoints** — What backend routes are needed beyond the standard boring-ui ones?
5. **Auth requirements** — Does it need authenticated users or is it public?

Ask one or two focused questions at a time using AskUserQuestion. Stop interviewing when you have enough to build. Aim for 2-4 rounds max — don't over-interview.

Summarize the requirements back to the user and get confirmation before proceeding.

## Phase 2: Build

Once requirements are confirmed:

1. Generate a unique app identity:

```python
python3 -c "
from tests.eval.contracts import NamingContract, RunManifest
import json
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

2. Run `bui --help` to discover the platform workflow
3. Run `bui docs quickstart` for the full walkthrough
4. Follow the bui workflow: init → add features → doctor → neon setup → deploy
5. Build the agreed features as custom routers + panels

## Phase 3: Verification

Every app must include a status router with verification endpoints:

- `GET /health` → `{"ok": true, "app": "<app_slug>", "custom": true, "eval_id": "<eval_id>", "verification_nonce": "<nonce>"}`
- `GET /info` → `{"name": "<app_slug>", "version": "0.1.0", "eval_id": "<eval_id>"}`

After deploying, verify the live endpoints respond correctly.

## Phase 4: Report

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
