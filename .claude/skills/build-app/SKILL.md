---
name: build-app
description: Create, build, and deploy a new boring-ui child app from a feature description. Use when the user wants to create a new app, build a new child app, or deploy a new project.
argument-hint: "[feature description]"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion
---

# Build a boring-ui child app

## Phase 1: Requirements

The user wants: $ARGUMENTS

Interview the user (2-4 rounds with AskUserQuestion) to clarify:
- What custom panels and backend endpoints to build
- Data storage needs (in-memory, database, external API)
- Auth requirements (multi-user with Neon, or single-user)

Summarize and get confirmation before building.

## Phase 2: Build

Generate app identity, then use `bui --help` and `bui docs quickstart` to discover the workflow.

```python
python3 -c "
from tests.eval.contracts import NamingContract, RunManifest
import json
nc = NamingContract.from_eval_id()
m = RunManifest.from_naming(nc, platform_profile='core')
print(json.dumps({
    'app_slug': nc.app_slug, 'eval_id': nc.eval_id,
    'python_module': nc.python_module, 'project_root': nc.project_root,
    'verification_nonce': m.verification_nonce,
    'report_output_path': m.report_output_path,
}, indent=2))
"
```

Build the app following `bui docs quickstart`. Include a status router with:
- `GET /health` → `{"ok": true, "app": "<slug>", "custom": true, "eval_id": "<id>", "verification_nonce": "<nonce>"}`
- `GET /info` → `{"name": "<slug>", "version": "0.1.0", "eval_id": "<id>"}`

## Phase 3: Acceptance criteria

The app is NOT done until ALL of these pass. Run each check and report pass/fail.

### Local (before deploy)
- [ ] `bui doctor` exits 0
- [ ] `GET /health` returns JSON with correct verification_nonce
- [ ] `GET /info` returns JSON with correct eval_id
- [ ] All custom endpoints return correct responses
- [ ] No secrets hardcoded in source files

### Deploy
- [ ] `bui neon setup` completes (auth + email auto-configured)
- [ ] `bui deploy` completes with healthy machines
- [ ] App reachable at `https://<slug>.fly.dev`

### Live smoke suite (after deploy — run ALL of these)

Run the boring-ui smoke test suite from the framework repo:

```bash
cd /home/ubuntu/projects/boring-ui

# 1. Health + config + capabilities (no auth)
python3 tests/smoke/smoke_health.py --base-url https://<slug>.fly.dev

# 2. Capabilities detail (verify neon auth, routers, features)
python3 tests/smoke/smoke_capabilities.py --base-url https://<slug>.fly.dev --expect-auth neon

# 3. Full auth suite (19 phases: signup, signin, session, logout, guards, etc.)
python3 tests/smoke/smoke_neon_auth.py --base-url https://<slug>.fly.dev
```

Also test custom endpoints (notes CRUD etc.) with curl.

Every smoke script must exit 0. If any fails, diagnose, fix, redeploy, re-run until green.

## Phase 4: Report

```
BEGIN_EVAL_REPORT_JSON
{
  "eval_id": "<eval_id>",
  "verification_nonce": "<nonce>",
  "app_slug": "<slug>",
  "project_root": "<root>",
  "deployed_url": "https://<slug>.fly.dev",
  "fly_app_name": "<slug>",
  "neon_project_id": "...",
  "commands_run": ["..."],
  "acceptance_criteria": {
    "doctor_pass": true,
    "local_health": true,
    "local_info": true,
    "local_custom_endpoints": true,
    "no_hardcoded_secrets": true,
    "neon_setup": true,
    "deploy_healthy": true,
    "smoke_health_py": true,
    "smoke_capabilities_py": true,
    "smoke_neon_auth_py": true,
    "live_custom_endpoints": true
  },
  "failures": [],
  "known_issues": []
}
END_EVAL_REPORT_JSON
```

Write to: `<report_output_path>`
