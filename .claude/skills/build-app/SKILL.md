---
name: build-app
description: Create, build, and deploy a new boring-ui child app from a feature description. Use when the user wants to create a new app, build a new child app, or deploy a new project.
argument-hint: "[feature description]"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion
---

# Build a boring-ui child app

## Phase 1: Requirements gathering

The user wants to build: $ARGUMENTS

Before writing any code, interview the user to understand what they need. Use AskUserQuestion to ask focused questions, 2-4 rounds max.

**Understand the app:**
- What does it do? What problem does it solve?
- Who uses it? (just you, a team, public?)

**Understand the features:**
- What custom panels should the UI have? What do they show/do?
- What backend API endpoints are needed? What data do they serve?
- Does it need its own data store (ClickHouse, SQLite, external API) or is in-memory OK?
- Does it need agent tools? (PI tools the AI agent can call)

**Understand the deployment:**
- Where should it live? (Fly.io is the default)
- Does it need auth? (Neon Auth for multi-user, or local-only is fine?)
- Any external services it connects to? (APIs, databases, etc.)

For reference: boring-macro is an existing child app with custom chart panels,
a ClickHouse data router, CLI commands (ingest/sql/train), and companion agent
integration. Child apps can range from simple (one panel + one router) to complex
(multiple panels, data pipelines, custom agent tools, external service integrations).

Summarize the requirements back to the user and get confirmation before building.

## Phase 2: Build

Once confirmed:

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
3. Run `bui docs quickstart` for the full walkthrough — this is the single source of truth for rules, secrets, scope, routers, panels, and deployment
4. Follow the bui workflow: init → add features → doctor → neon setup → deploy
5. Build the agreed features as custom routers + panels

## Phase 3: Verification

Every app must include a status router with verification endpoints:

- `GET /health` → `{"ok": true, "app": "<app_slug>", "custom": true, "eval_id": "<eval_id>", "verification_nonce": "<nonce>"}`
- `GET /info` → `{"name": "<app_slug>", "version": "0.1.0", "eval_id": "<eval_id>"}`

After deploying, run a full smoke check:

1. `curl https://<app_slug>.fly.dev/health` — must return JSON with verification_nonce
2. `curl https://<app_slug>.fly.dev/info` — must return JSON with eval_id
3. `curl https://<app_slug>.fly.dev/api/capabilities` — must return auth provider
4. Test all custom endpoints (notes CRUD, etc.)
5. Test signup: `curl -X POST https://<app_slug>.fly.dev/auth/sign-up -H "Content-Type: application/json" -d '{"email":"test@eval.local","password":"eval-test-2026","name":"Eval"}'`
   — If signup returns 200 but no verification email arrives, check that `bui neon setup` added the Fly URL to Neon trusted_origins

If any smoke check fails, diagnose and fix before writing the report.

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
