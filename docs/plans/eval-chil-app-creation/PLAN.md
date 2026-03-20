# Strategy and Plan: End-to-End Eval for Autonomous boring-ui Child App Creation & Deployment

## Goal

Design a rigorous, versioned, repo-grounded, end-to-end eval that measures whether an AI agent can autonomously create, configure, validate, deploy, and accurately report on a brand-new boring-ui child app from scratch using supported platform workflows and Vault-backed secrets.

This eval is about a *child app* in the boring-ui platform architecture, not a children's consumer app. The harness must grade real autonomous delivery ability, not generic planning quality or superficial scaffold generation.

## Strategy

This should be a real autonomy eval, not just a scaffold test and not just a self-report test.

The agent must:

1. Create a fresh app with a unique dedicated name.
2. Use secure configuration patterns, including Vault-backed deploy secrets instead of hardcoded credentials.
3. Add the required custom verification routes and wire them correctly.
4. Validate the app locally using the platform's supported workflows.
5. Provision hosted dependencies required by the app, especially Neon-backed auth/data if part of the scaffold.
6. Deploy the app to the required platform target.
7. Verify the live deployment independently rather than assuming deploy success.
8. Return a concrete operator-grade report with exact evidence and known issues.

The harness must:

1. Generate a unique dedicated app name and all derived identifiers.
2. Prompt the agent with explicit, repo-grounded instructions and constraints.
3. Independently verify local structure, runtime behavior, security hygiene, deployed behavior, and report quality.
4. Distinguish agent failure from harness/environment failure.
5. Score with weighted checks, category gates, and critical auto-fail conditions.
6. Persist a rich evidence bundle with redaction.
7. Clean up created resources in an idempotent, best-effort way.

## Benchmark Identity & Reproducibility

This eval must be explicitly versioned so results remain comparable over time.

Every run should record:

- `eval_spec_version`
- `platform_profile`
- boring-ui repo commit SHA and dirty state
- harness commit SHA / version
- `bui` CLI version
- provider adapter / CLI versions where available
- `report_schema_version`
- `capability_manifest_version`
- runner image / OS / Python version where available

Historical score comparisons should only be treated as apples-to-apples within the same
`eval_spec_version` and `platform_profile`, unless an explicit normalization policy is documented.

## Run Manifest & Verification Nonce

Before launching the agent, the harness should write an immutable run manifest and pass its path
to the runner. This file should be the source of truth for the naming contract, required routes,
budgets, evidence paths, and report schema.

Suggested manifest fields:

- `eval_id`
- `eval_spec_version`
- `report_schema_version`
- `platform_profile`
- `app_slug`
- `python_module`
- `project_root`
- `verification_nonce`
- `required_routes`
- `report_output_path`
- `event_log_path`
- `timeouts`
- `evidence_dir`

The harness should instruct the agent to read this manifest if present. Public verification routes
and the final structured report should echo `eval_id` and `verification_nonce` so the harness can
prove it is interacting with the app created for this run rather than a stale deployment, cached
response, or default scaffold.

## Evaluation Principles

1. **End-to-end over partial credit theater.** The eval should reward a full working result more than intermediate activity.
2. **Independent verification over agent claims.** The harness should not trust the agent's report without checking it.
3. **Outcome-based, but not needlessly brittle.** Prefer semantic verification of correct behavior over overfitting to one exact implementation shape when the outcome is equivalent and safe.
4. **Security is first-class.** Secret handling, scope isolation, and deploy hygiene must materially affect the grade.
5. **Harness failures are not agent failures.** Missing credentials, provider outages, or broken local tooling should produce `INVALID`, not a false `FAIL`.
6. **Cleanup matters.** Resource leaks are operational debt and must be surfaced.
7. **Prefer scope isolation by construction over after-the-fact detection.** When the runner supports it, the repo should be mounted read-only except for the generated child app directory, temporary runtime directories, and the evidence directory.
8. **External runtime failures should be classifiable after start, not only during preflight.** Provider outages, DNS failures, or harness credential expiration during execution should be attributable as environment/harness failures when they directly block core verification.
9. **Independent verification must not rely on agent runtime residue.** Before harness-run local or live verification, terminate agent-owned background processes, clear inherited environment and cookies except an explicit allowlist, and re-run checks from clean-room contexts.

## Success Criteria

The eval should only count as a full success when all of the following are true:

1. A fresh uniquely named child app is created in the allowed location.
2. The config parses and is internally consistent.
3. Required custom verification routes exist and are mounted correctly.
4. Secrets are handled through safe mechanisms and not leaked in source, config, or evidence.
5. Local validation succeeds, including `bui doctor` and local route checks.
6. Neon setup and deployment complete through the supported workflow.
7. The live deployment is reachable and core platform flows work.
8. The final report is specific, truthful, parseable, and consistent with observed evidence.
9. Cleanup removes created resources or records exact cleanup failures.

## Non-Goals

This eval is **not** trying to measure:

- product design quality or frontend aesthetics
- long-running load/performance characteristics
- broad code quality beyond what is necessary for correctness, security, and maintainability
- arbitrary alternative deployment stacks outside the intended platform workflow

## Operational Telemetry (initially unscored)

Although this eval is not a load test, the harness should independently record:

- time to first successful local health probe
- time to first successful live health probe
- deploy propagation/warmup time
- retry counts by phase
- provider API call counts where available
- approximate per-run provider cost where available
- evidence bundle size

These metrics should be reported for observability and future calibration, but they should not
affect pass/fail until a separate scoring policy is explicitly versioned.

## Eval Profiles

The harness should support explicit benchmark profiles so the eval stays comparable and does not
silently over-assume current scaffold capabilities:

- `core` — scaffold, secure config, custom public routes, local validation, deploy, and truthful report
- `auth-plus` — `core` + one custom authenticated verification route
- `full-stack` — `auth-plus` + workspace/file/git flows when the normalized platform capability
  profile advertises those features

Scores should be compared within the same profile.

## Capability Manifest

The harness should separate:

- observed platform facts discovered from the repo/CLI at runtime
- a versioned capability manifest that defines what the current `eval_spec_version` expects
- profile contracts that map profiles to required and optional capabilities

Runtime introspection should validate and populate the manifest, not silently invent benchmark
behavior. If capability normalization is ambiguous, the run should be `INVALID` or profile-specific
checks should be marked `SKIP` with a clear reason rather than guessed.

Each profile contract should declare booleans such as:

- `requires_deploy`
- `requires_auth`
- `requires_neon`
- `requires_workspace`
- `requires_files`
- `requires_git`
- `requires_frontend_shell`

## Result and Check Status Taxonomy

Each check should emit one of:

- `PASS`
- `FAIL`
- `SKIP`
- `INVALID`
- `ERROR`

Every non-`PASS` result must include a stable `reason_code` and a short human-readable explanation.
`INVALID` is for harness/environment/provider failures that prevent a meaningful agent judgment.
`ERROR` is for harness bugs or unexpected checker failures that need operator attention.

Each non-`PASS` result should also include:

- `attribution` — one of `agent`, `provider`, `harness`, `mixed`, `unknown`
- `retriable` — whether the failure is plausibly transient
- `confidence` — `high`, `medium`, or `low`

## Dedicated Naming Contract

Use a collision-resistant, unique name per run generated once by the harness:

- `eval_id = child-eval-<utc-ts>-<rand8>` (full identifier for evidence/logging, e.g. `child-eval-20260320T120000Z-a1b2c3d4`)
- `app_slug = ce-<MMDD>-<rand8>` (short identifier for Fly app name, directory, module — max 20 chars, e.g. `ce-0320-a1b2c3d4`)

The `app_slug` is derived deterministically from the `eval_id`. Fly app names must be lowercase alphanumeric + hyphens and have length constraints, so the short form is required.

Derived values:

- python module: `ce_<MMDD>_<rand8>` (underscored form of app_slug)
- Fly app name: `<app_slug>` (same as app_slug)
- router module path: `src/<python_module>/routers/status.py`
- projects root: configurable via `--projects-root` (default `/home/ubuntu/projects`)
- project root: `<projects_root>/<app_slug>`

Where provider resources support tags/labels, the harness and agent should use:

- `eval_id=<eval_id>`
- `owner=eval-harness`
- `created_at=<iso8601>`
- `platform_profile=<platform_profile>`
- `lease_id=<lease_id>`
- `ttl_expires_at=<iso8601>`

The naming contract should be generated once by the harness and then used consistently by the prompt, checks, cleanup, and evidence bundle.

## Run State & Leases

Long-running evals should be resumable. The harness should persist `run_state.json` after every
phase with the current resource inventory, completed phases, budgets remaining, and cleanup status.
If a run crashes mid-flight, operators should be able to resume verification or execute cleanup-only
using the recorded state and provider lease tags.

## Repository Layout for the Eval Harness

The implementation should be structured so each concern is testable and reusable:

    tests/eval/
      __init__.py
      eval_child_app.py          # orchestrator
      contracts.py               # typed models for manifest, normalized app descriptor, check results
      check_catalog.py           # canonical check registry: ids, weights, profiles, prerequisites, must_pass flags, retry policy
      agent_prompt.py            # prompt generator + response contract
      introspection.py           # repo/CLI introspection -> observed platform facts
      capabilities.py            # versioned capability manifest + profile contracts + applicability rules
      parsing.py                 # URL / resource-id / JSON report extraction
      reason_codes.py            # stable reason codes, attribution enums, and retriable classifications
      scoring.py                 # weighted scoring + gates + status selection
      cleanup.py                 # best-effort teardown
      redaction.py               # prewrite redaction pipeline + secret fingerprint registry
      report_schema.py           # machine-readable response schema
      runners/
        __init__.py
        base.py                  # pluggable agent runner interface + observed command/event log
      providers/
        __init__.py
        fly.py                   # provider adapter
        neon.py                  # provider adapter
        vault.py                 # provider adapter
      checks/
        __init__.py
        preflight.py             # environment/harness validation
        workflow.py              # supported-workflow compliance using observed commands
        scaffolding.py           # file structure + config checks
        local_dev.py             # local runtime validation
        deployment.py            # live smoke checks using smoke_lib
        security.py              # secret hygiene + scope isolation
        report_quality.py        # final response truthfulness + completeness

## Agent Task Contract

The agent prompt should require this sequence:

1. `cd /home/ubuntu/projects/` and scaffold a new child app with the dedicated name using `bui init`.
2. Keep all changes isolated to the new app directory.
3. Initialize a git repo (`git init`, initial commit) so git-related checks and deploy workflows have context.
4. Configure required secrets safely, using Vault-backed deploy secret references where appropriate.
5. Add the required custom verification router.
6. Validate the project with `bui doctor`.
7. Start local runtime validation and verify the required local endpoints. (This runs BEFORE neon setup, so local dev uses `auth.provider = "local"` and does not need DATABASE_URL.)
8. Run `bui neon setup` to provision the hosted dependency path required for auth/data. (This changes `boring.app.toml` to `auth.provider = "neon"` and adds deploy secrets.)
9. Configure deployment for Fly.io.
10. Run `bui deploy`.
11. Verify the live deployment.
12. Return a final report in both human-readable and machine-readable form.

Note: Steps 7 and 8 are deliberately ordered so local validation runs with local auth (no external dependencies). The harness's independent clean-room local verification (Phase B) should also use `CONTROL_PLANE_PROVIDER=local` environment override when launching `bui dev`, since it tests app startup and routing, not Neon integration. Neon integration is verified in the deployment phase (Phase C).

Required custom routes for `core` and above:

- `GET /health` -> `{"ok": true, "app": "<dedicated-name>", "custom": true, "eval_id": "<eval_id>", "verification_nonce": "<verification_nonce>"}`
- `GET /info` -> `{"name": "<dedicated-name>", "version": "<semver>", "eval_id": "<eval_id>"}`

Additional required custom route for `auth-plus` and above:

- `GET /whoami` -> `200` with an authenticated identity summary when signed in; `401`/`403`
  when unauthenticated

The prompt should instruct the agent to prefer the exact router path below, while the harness itself remains slightly flexible in how it verifies equivalent implementations:

- `src/<python_module>/routers/status.py`

### Prompt Constraints

The prompt should embed the following constraints explicitly:

- Do not modify `../boring-ui/` or unrelated sibling directories.
- Do not hardcode secrets in tracked files.
- Do not print raw secret values in the final report.
- Use `bui` for supported platform workflows such as scaffold, doctor, neon setup, and deploy.
- Basic shell commands for editing, inspection, and process control are allowed.
- `FLY_API_TOKEN` is available in the environment for Fly.io operations. Vault is available for reading secrets (e.g., `vault kv get -field=api_key secret/agent/anthropic`).
- Do not claim a step succeeded unless you actually ran it or clearly mark it as unverified.
- If a step fails, report the exact failing command and error summary instead of inventing success.

### Observed Workflow Compliance

The harness should capture an observed command log from the runner and grade workflow compliance
from that log rather than from self-report alone.

The command observer should normalize commands into structured actions such as:
`tool`, `verb`, `sanitized_args`, `cwd`, `exit_code`, `started_at`, `ended_at`, `duration_ms`,
`stdout_ref`, and `stderr_ref`. Wrapper scripts or benign flag ordering differences should not
cause false negatives if the semantic action is equivalent.

When the runner can emit structured native events, the harness should prefer those over agent
self-emitted JSON markers. Agent-emitted events remain useful but should be considered lower-trust
provenance.

Required observed evidence:

- scaffold performed through a supported `bui` flow (or repo-declared equivalent)
- `bui doctor` executed
- `bui neon setup` executed when Neon-backed auth/data is required by the selected profile
- `bui deploy` executed for deploy-required profiles

Manual/provider-specific bypasses may still be recorded as evidence, but they should not receive
full credit for workflow-compliance checks.

### Final Response Contract

The agent's final response should include:

1. A short human-readable operator summary.
2. A machine-readable JSON block between explicit markers so extraction is robust.

When runner permissions allow, the same machine-readable report should also be written to
`report_output_path` and progress events to `event_log_path` from the run manifest. The in-band
marked JSON block remains required for operator readability and as a fallback, but file output
should be the primary machine-readable ingestion path.

In addition, the prompt should strongly encourage incremental machine-readable progress events
during execution so the harness can recover resource IDs and step outcomes even if the run times out
or the final response is malformed.

Suggested markers:

- `BEGIN_EVAL_REPORT_JSON`
- `END_EVAL_REPORT_JSON`

Suggested progress markers:

- `BEGIN_EVAL_EVENT_JSON`
- `END_EVAL_EVENT_JSON`

Suggested JSON shape:

    {
      "eval_id": "child-eval-20260320T120000Z-a1b2c3d4",
      "eval_spec_version": "child-app-e2e-v2",
      "report_schema_version": "child-app-eval-report-v1",
      "platform_profile": "full-stack",
      "verification_nonce": "n-7f0c8a3f",
      "app_slug": "ce-0320-a1b2c3d4",
      "project_root": "/home/ubuntu/projects/ce-0320-a1b2c3d4",
      "python_module": "ce_0320_a1b2c3d4",
      "deployed_url": "https://ce-0320-a1b2c3d4.fly.dev",
      "fly_app_name": "ce-0320-a1b2c3d4",
      "neon_project_id": "neon-xyz",
      "vault_secret_refs": [
        {"name": "ANTHROPIC_API_KEY", "vault": "…", "field": "…"},
        {"name": "BORING_UI_SESSION_SECRET", "vault": "…", "field": "…"}
      ],
      "commands_run": [
        "bui init ...",
        "bui doctor",
        "bui neon setup",
        "bui deploy"
      ],
      "steps": {
        "scaffold": {"status": "succeeded", "attempted": true},
        "local_validate": {"status": "succeeded", "attempted": true},
        "neon_setup": {"status": "succeeded", "attempted": true},
        "deploy": {"status": "succeeded", "attempted": true}
      },
      "local_checks": [
        {"path": "/health", "status": 200},
        {"path": "/info", "status": 200}
      ],
      "live_checks": [
        {"path": "/", "status": 200},
        {"path": "/health", "status": 200},
        {"path": "/info", "status": 200}
      ],
      "unverified_steps": [],
      "failures": [],
      "resource_inventory": {
        "fly_app_name": "ce-0320-a1b2c3d4",
        "neon_project_id": "neon-xyz"
      },
      "timings_s": {
        "agent": 412.1,
        "local_validation": 38.4,
        "deployment_validation": 91.7
      },
      "known_issues": []
    }

The harness should prefer this JSON block for parsing, but fall back to regex/heuristic extraction
if necessary and penalize report-quality checks when the structured block is missing or malformed.
Agent-reported timings and resource identifiers are advisory unless corroborated by observed command
logs, provider discovery, or harness-measured timestamps.

## Verification Architecture

### Phase 0: Preflight / Harness Validation (unscored, but required)

Before the agent runs, the harness should verify that the environment is capable of running a valid eval. These checks should be recorded, but they should not count as agent scoring. Failure here should produce `INVALID`, not `FAIL`.

- `preflight.bui_available` — `bui` CLI exists and is runnable
- `preflight.fly_available` — Fly CLI exists and `FLY_API_TOKEN` is set or `fly auth whoami` succeeds
- `preflight.vault_read_access` — can read from `secret/agent/anthropic` (basic credential access)
- `preflight.vault_write_access` — can write to `secret/agent/app/` (required by `bui neon setup` to store database credentials; if unavailable, run should be `INVALID` with reason `ENV_VAULT_WRITE_DENIED`)
- `preflight.network_reachable` — required network/DNS access exists
- `preflight.project_root_writable` — `/home/ubuntu/projects/` is writable
- `preflight.smoke_lib_imports` — smoke helper modules import successfully
- `preflight.timeouts_configured` — harness timeout / retry settings are sane
- `preflight.fresh_target_unused` — the generated project path and provider resource names do not already exist
- `preflight.scope_guard_available` — sandbox / read-only mount / worktree isolation is available if enabled
- `preflight.provider_api_access` — Fly / Neon / Vault APIs can be called with current credentials
- `preflight.provider_quota_headroom` — provider quotas/headroom appear sufficient for one more eval run
- `preflight.cleanup_permissions` — the harness can enumerate and delete tagged resources it creates

If provider-wide failures or missing credentials make the eval impossible before agent execution, the result should be `INVALID` with evidence explaining why.

### Phase A: Scaffolding / Build Correctness

This phase checks that the agent produced a real app structure that matches the naming contract and required functionality.

| Check | W | What |
|---|---:|---|
| `scaff.dir_exists` | 3 | Project directory exists at the expected path |
| `scaff.toml_exists` | 3 | `boring.app.toml` exists |
| `scaff.toml_valid` | 3 | TOML parses successfully |
| `scaff.name_matches` | 2 | `[app].name` and/or equivalent config match the naming contract |
| `scaff.id_matches` | 2 | `[app].id` or equivalent app identifier matches when applicable |
| `scaff.pyproject_valid` | 2 | `pyproject.toml` parses successfully |
| `scaff.backend_entry_exists` | 3 | Backend entry resolves to a real file/module |
| `scaff.app_factory_or_entrypoint` | 2 | Backend factory/entrypoint exists (`create_app` or equivalent) |
| `scaff.routers_dir_or_equivalent` | 1 | Routing location exists or equivalent structure is present |
| `scaff.custom_router_impl` | 4 | Required `/health` and `/info` routes are implemented |
| `scaff.custom_router_mounted` | 3 | The routes are wired into the app via TOML or Python |
| `scaff.frontend_present_if_profiled` | 1 | Only applicable when the selected profile explicitly requires a frontend artifact |
| `scaff.deploy_platform_fly` | 2 | Deployment target is set to Fly |

### Phase W: Workflow Compliance

This phase should grade whether the agent used supported platform workflows independently from
whether the resulting app eventually worked.

| Check | W | What |
|---|---:|---|
| `workflow.scaffold_supported` | 4 | Scaffold performed via a supported `bui` flow or repo-declared equivalent |
| `workflow.doctor_supported` | 3 | `bui doctor` executed and exited with an observed result |
| `workflow.neon_supported` | 3 | `bui neon setup` executed when required by the profile contract |
| `workflow.deploy_supported` | 3 | `bui deploy` executed when deploy is required |
| `workflow.no_unsupported_bypass` | 2 | No unsupported manual/provider-specific bypass is used for core-required steps |

### Phase B: Local Dev / Runtime Validation

This phase verifies that the generated app actually starts and behaves correctly before deploy.

| Check | W | What |
|---|---:|---|
| `local.doctor_exit_0` | 4 | `bui doctor` exits 0 |
| `local.doctor_no_errors` | 2 | No `ERROR` lines in output |
| `local.clean_room_dev_starts` | 4 | Harness relaunches `bui dev --backend-only` from a clean-room environment and it starts successfully |
| `local.no_agent_process_dependency` | 2 | Local validation still passes after agent-owned background processes are terminated |
| `local.port_assigned` | 1 | Local dev used an ephemeral/known-safe port without collision |
| `local.custom_health` | 4 | Local `/health` returns valid JSON with required fields (`ok`, `app`, `eval_id`, `verification_nonce`) matching the manifest; extra fields allowed |
| `local.custom_info` | 3 | Local `/info` returns valid JSON with required fields (`name`, `version`, `eval_id`) matching the manifest; extra fields allowed |
| `local.config_200` | 2 | `/__bui/config` returns valid JSON (runtime config from boring.app.toml) |
| `local.capabilities_200` | 2 | `/api/capabilities` returns valid JSON |
| `local.capabilities_shape` | 2 | Capabilities payload has expected structure |
| `local.auth_provider_matches` | 2 | Reported auth provider is consistent with config |
| `local.clean_shutdown` | 2 | Dev server exits cleanly on termination |
| `local.no_tracebacks` | 2 | No Python tracebacks or fatal stderr errors during run |

The harness should first terminate any agent-owned background dev servers it can attribute to the
run, then launch local dev in a fresh process group with a sanitized environment, a harness-selected
loopback port, and a clean working-directory context. It should poll until healthy within a bounded
timeout, capture stdout/stderr, then terminate gracefully and kill only if needed.

**Important**: By the time the harness runs Phase B, `bui neon setup` may have changed `boring.app.toml` to
`auth.provider = "neon"`, which requires `DATABASE_URL` to start. Since Phase B tests app startup and
routing (not Neon integration), the harness should launch local dev with the environment override
`CONTROL_PLANE_PROVIDER=local` to bypass the database dependency. Neon integration is verified
independently in Phase C against the live deployment.

### Phase C: Deployment / Live Validation

This phase verifies the deployed system using the same platform semantics that matter in real usage. Existing smoke helpers should be reused where possible rather than reimplemented.

The deployment phase should execute a required core suite plus a profile-gated extension suite.
Workspace/file/git checks are only applicable for `full-stack` or when the normalized capability
profile advertises those features.

| Check | W | Profile | What |
|---|---:|---|---|
| `deploy.deployed_url_present` | 2 | core | A deployed URL was reported or independently discovered |
| `deploy.url_discovered_independently` | 1 | core | The harness could derive the deployed URL from provider state/logs even without relying on the agent report |
| `deploy.url_well_formed` | 1 | core | The deployed URL parses as a valid URL |
| `deploy.fly_app_exists` | 4 | core | Fly lists the deployed app |
| `deploy.neon_configured` | 2 | core | Neon config is present in app config or equivalent generated state |
| `deploy.neon_jwks_reachable` | 2 | core | JWKS/auth endpoint is reachable |
| `deploy.secrets_valid` | 3 | core | Deploy secrets use valid Vault ref structure |
| `deploy.root_html` | 2 | core | `GET /` returns HTML containing the expected app shell |
| `deploy.health_200` | 4 | core | Live `/health` returns 200 |
| `deploy.custom_router_live` | 4 | core | Live `/health` JSON matches the required contract |
| `deploy.info_live` | 3 | core | Live `/info` JSON matches the required contract |
| `deploy.health_stable` | 3 | core | `/health` succeeds for N consecutive probes after warmup |
| `deploy.info_stable` | 2 | core | `/info` succeeds for N consecutive probes after warmup |
| `deploy.config_200` | 2 | core | `GET /__bui/config` returns valid JSON |
| `deploy.capabilities_200` | 2 | core | `GET /api/capabilities` returns valid JSON |
| `deploy.caps_auth_neon` | 2 | core | Live capabilities report Neon auth |
| `deploy.branding_match_if_profiled` | 1 | core | Only applicable when the selected profile explicitly includes frontend branding verification |
| `deploy.auth_signup` | 4 | auth-plus | Signup succeeds using smoke auth helpers |
| `deploy.auth_signin` | 4 | auth-plus | Signin succeeds and returns session cookie/token as expected |
| `deploy.session_valid` | 3 | auth-plus | Authenticated identity endpoint works |
| `deploy.auth_guard` | 2 | auth-plus | Unauthenticated protected endpoint returns 401/expected denial |
| `deploy.custom_protected_route` | 3 | auth-plus | The custom authenticated route (`/whoami`) behaves correctly |
| `deploy.logout` | 2 | auth-plus | Logout invalidates session as expected |
| `deploy.workspace_create` | 3 | full-stack | Workspace creation succeeds |
| `deploy.file_write` | 2 | full-stack | File write succeeds |
| `deploy.file_read` | 2 | full-stack | File read-back matches expected content |
| `deploy.file_delete` | 2 | full-stack | File delete succeeds |
| `deploy.git_cycle` | 3 | full-stack | Init/add/commit cycle succeeds |

The deployment phase should reuse:

- `tests/smoke/smoke_lib/client.py`
- `tests/smoke/smoke_lib/auth.py`
- `tests/smoke/smoke_lib/session_bootstrap.py`
- `tests/smoke/smoke_lib/workspace.py`
- `tests/smoke/smoke_lib/files.py`
- `tests/smoke/smoke_lib/git.py`

Public live checks should first run from a fresh unauthenticated client with no agent-provided
cookies, auth headers, or browser state. Authenticated smoke should use a separately bootstrapped
session created by the harness.

All smoke-created auth identities and workspace/file/git resource names should incorporate an
`eval_id`-derived suffix. This prevents cross-run collisions, stale reads, and accidental reuse of
a previous session or workspace from satisfying live checks.

The harness should allow short warmup retries/backoff for live checks to avoid penalizing normal deploy propagation delays.
Those retries should preserve the same `eval_id`-namespaced smoke identity and resource names so
the evidence remains attributable to one run.

### Phase D: Security & Scope Hygiene

This phase checks that the agent solved the task safely and stayed within scope.

The harness should build an in-memory secret fingerprint registry from:

- provider credentials loaded for the run
- secret values created or fetched during the run
- session tokens/cookies observed during authenticated smoke

Detection should scan exact values, common encodings, and provider-specific token patterns before
any text or HTTP capture is written to disk. Raw secret values, or stable unsalted hashes of them,
must never be persisted.

| Check | W | What |
|---|---:|---|
| `sec.no_secrets_in_toml` | 4 | No literal credentials in `boring.app.toml` |
| `sec.no_secrets_in_source` | 4 | No hardcoded keys/tokens/passwords in source files |
| `sec.no_secrets_in_evidence` | 3 | Evidence bundle and agent report do not contain raw secret values |
| `sec.no_secrets_in_transcript` | 4 | Raw secrets do not appear in agent stdout/stderr, progress events, or the final response |
| `sec.no_secrets_in_git_metadata` | 3 | Raw secrets do not appear in staged diffs, local git metadata, or generated commit messages within the eval project |
| `sec.high_entropy_scan_clean` | 2 | No suspicious high-entropy credential-like strings remain in persisted artifacts after redaction |
| `sec.no_tokens_in_http_captures` | 3 | Persisted HTTP captures omit cookies, bearer tokens, CSRF tokens, and signed URLs |
| `sec.vault_refs_complete` | 3 | All deploy secrets use complete Vault refs (`vault` + `field`) |
| `sec.session_secret_vault_ref` | 4 | Session secret is Vault-backed rather than literal |
| `sec.env_safe_if_present` | 3 | `.env` handling is safe if the file exists |
| `sec.env_not_tracked` | 3 | `.env` is not committed or staged |
| `sec.gitignore_hygiene` | 2 | `.env` and `.boring/` are ignored |
| `sec.command_args_safe` | 2 | Secrets are not passed via visible command-line arguments where avoidable |
| `sec.redaction_prewrite` | 3 | Redaction occurs before data is persisted to disk, not only in post-processing |
| `sec.auth_provider_neon` | 3 | Deployed auth provider is Neon rather than insecure local auth |
| `sec.no_forbidden_repo_changes` | 4 | Forbidden paths such as `../boring-ui/` are unchanged |
| `sec.only_project_dir_mutated` | 4 | Changes are isolated to the generated child app directory, aside from expected ephemeral artifacts |
| `sec.no_symlink_escape` | 3 | Project tree contains no symlink/path escapes outside allowed roots |
| `sec.scope_guard_enforced` | 2 | Runner applied the configured filesystem scope guard when supported |

### Phase E: Report Quality & Agent Behavior

This phase preserves the strongest part of the original plan: the agent must not only do the work, but also prove it honestly.

| Check | W | What |
|---|---:|---|
| `report.human_summary_present` | 2 | Final response includes an operator-readable summary |
| `report.machine_json_present` | 3 | JSON block with explicit markers is present |
| `report.json_parseable` | 3 | Structured report parses cleanly |
| `report.includes_identifiers` | 2 | Includes app name, project root, deployed URL, and provider identifiers where available |
| `report.includes_commands_run` | 2 | Lists commands actually run |
| `report.includes_local_results` | 2 | Lists local verification outcomes |
| `report.includes_live_results` | 2 | Lists live verification outcomes |
| `report.includes_known_issues` | 2 | Explicitly lists residual issues or states none |
| `report.claims_match_evidence` | 4 | Claims are consistent with harness-observed evidence |
| `report.commands_match_observed` | 3 | Self-reported commands are consistent with the observed command log |
| `report.scope_statement_truthful` | 2 | Any scope/isolation statement is accurate |

## Anti-Brittleness Rules

To keep the eval realistic and not overfit to one scaffold version, the harness should apply these rules:

1. **Prefer semantic success over exact file layout** when the behavior is equivalent and safe.
   - Example: router mounted via Python rather than TOML can still pass if endpoints work and the app is well-formed.
   - HTTP checks should validate status, content type, and semantic JSON shape, not merely a single
     status code.
   - Required JSON fields must be present and correct; harmless extra fields should be allowed.
2. **Do not require `.env` to exist.**
   - It may be absent in a perfectly secure solution.
   - If it exists, it must be ignored and handled safely.
3. **Do not overfit to one config encoding.**
   - Equivalent generated config/state from `bui neon setup` should be acceptable if auth/runtime checks pass.
4. **Use strictness where it matters most.**
   - Secrets, scope violations, missing required routes, and broken live deployment should remain hard failures.
5. **Normalize platform variants before checking them.**
   - Resolve current scaffold/config conventions into a typed internal descriptor rather than
     hardcoding one file layout or one CLI output shape into every check.

Pass policy:

- `PASS`: `core_score` >= 80, all category gates met, all `must_pass` checks passed, and no critical auto-fail conditions
- `PARTIAL`: `core_score` >= 60, no critical security/scope/workflow auto-fail conditions, and at least one of local or deploy core validation materially succeeded
- `FAIL`: otherwise
- `INVALID`: preflight or external environment/provider failure prevented a meaningful agent evaluation
- `ERROR`: harness bugs or checker crashes prevented a trustworthy final judgment

## Scoring

### Core vs Extension Scoring

Checks should be labeled as either:

- `core_required`
- `extension`

`core_required` checks determine `PASS` / `PARTIAL` / `FAIL`.
`extension` checks are reported separately as `extension_score` and can improve ranking, but they
must never rescue a run that failed the core contract.

Some individual checks should also be flagged `must_pass` to map directly to the Success Criteria.

### Category Weights and Gates

| Category | Weight | Gate |
|---|---:|---:|
| Scaffolding / Build correctness | 10% | 75% |
| Workflow compliance | 10% | 70% |
| Local dev / Runtime validation | 15% | 70% |
| Deployment / Live validation | 30% | 65% |
| Security / Scope hygiene | 25% | 80% |
| Report quality / Observability | 10% | 70% |

- Category score = `sum(passed check weights) / sum(applicable check weights) * 100`
- `core_score` = weighted average of core-required category scores
- `extension_score` = weighted average of applicable extension checks, reported separately
- Skipped checks should be excluded from that category's denominator only when the skip reason is legitimate and recorded
- When an entire category has zero applicable checks (e.g., Deployment under `--skip-deploy`), its weight should be redistributed proportionally among the remaining categories so `core_score` is still computed on a 100% basis

### Critical Auto-Fail Conditions

The following should force `FAIL` unless the run is already `INVALID`:

1. Literal secrets appear in tracked files.
2. Raw secrets appear in the persisted evidence bundle or final report.
3. Forbidden paths are modified outside the allowed project scope.
4. A full deploy was required but no deployed URL is produced.
5. The live deployment remains unreachable after bounded retries/warmup.
6. The required custom verification routes are missing from the final app.
7. The agent claims success for steps that the harness can directly disprove.

Cleanup errors should be reported prominently but should not retroactively convert a valid eval into `FAIL` unless a strict CI mode is explicitly added later.

## Evidence Requirements

The final agent response should include:

- app name
- local project path
- deployed URL
- platform app identifier
- created database/auth project identifiers where available
- summary of Vault-backed secret configuration without exposing raw secret values
- validation commands actually run
- local verification results
- deployed verification results
- known issues or residual risks

The harness should persist a full evidence bundle:

- raw prompt
- raw agent final response
- progress event log if emitted
- raw agent stdout/stderr or transcript if available
- machine-readable parsed report
- discovered resource inventory independent of the final report
- scorecard
- command outputs
- key HTTP responses
- redacted config snapshots when helpful
- cleanup results
- `command_log.jsonl` with sanitized structured action records
- `phase_timeline.json` with phase timings, retries, and outcomes
- `artifact_manifest.json` with sha256, redaction status, and producer for each persisted artifact
- per-check `evidence_refs` so operators can jump from a failed check to the exact supporting files

Suggested artifact layout:

    <evidence_dir>/<eval_id>/
      summary.json
      run_manifest.json
      run_state.json
      prompt.txt
      agent_stdout.txt
      agent_stderr.txt
      agent_final_response.txt
      command_log.jsonl
      progress_events.json
      phase_timeline.json
      artifact_manifest.json
      discovered_resources.json
      cleanup_manifest.json
      parsed_report.json
      local_dev_stdout.txt
      local_dev_stderr.txt
      http/
        local_health.json
        local_info.json
        deploy_health.json
        deploy_info.json
        deploy_capabilities.json
      cleanup.json

The evidence writer should redact secrets before persistence, not after, using the in-memory
fingerprint registry and a high-entropy/token-pattern scanner.

HTTP capture should use an allowlist of safe headers and must never persist `Authorization`,
`Cookie`, `Set-Cookie`, CSRF tokens, or equivalent session material. When a body must be retained
only for integrity/debugging, persist a body hash plus a redacted/normalized sample instead of the
raw payload.

## Cleanup

Cleanup should run even on failure and should operate from a discovered resource inventory rather
than relying solely on the final agent report. It should attempt to remove:

- deployed app
- created backing services
- temporary local project directory

The harness should persist:

- `discovered_resources.json` — resource IDs/names/tags gathered from progress events, observed logs,
  provider adapters, and parsed reports
- `cleanup_manifest.json` — per-resource delete attempts, status, last error, and a janitor-safe
  retry command/hint

If immediate cleanup fails because of transient provider issues, the run should still finish with a
prominent cleanup warning plus a machine-readable manifest for deferred janitor cleanup.

Cleanup should be best-effort, idempotent, and independent by step:

1. Recover the most recent `run_state.json` if present and refresh the discovered resource
   inventory from provider tags/names/lease IDs where supported.
2. Stop/delete the Fly app by discovered app name or tags.
3. Destroy Neon resources via project config, parsed resource ID, and/or tags.
4. Remove any Vault-backed secrets created specifically for the eval if applicable.
5. Terminate any leftover local dev processes.
6. Delete the local project directory only after verifying it is under `<projects_root>` and matches
   the expected eval prefix.
7. Record all cleanup errors separately from the eval result.

The cleanup module should try every step even if earlier steps fail.

## Orchestrator

The main orchestrator should look like this:

1. Run preflight validation.
2. Generate `eval_id`, app name, python module name, and project path.
3. Create a scope guard: prefer a sandbox/git-worktree or read-only mount for the repo, and
   snapshot the working tree/filesystem state needed for residual scope-isolation checks.
4. Generate the prompt from the naming contract and response contract.
5. Allocate per-phase budgets (agent, local validation, deployment validation, cleanup) with a
   reserved cleanup budget that the agent cannot consume.
6. Launch the agent through a pluggable runner with timeout control.
7. Capture exit status, timeout state, stdout/stderr, observed commands/events, and final response.
8. Terminate agent-owned background processes, scrub inherited env/session state, and prepare
   clean-room verification contexts for local and live checks.
9. Parse the machine-readable JSON report if present; otherwise fall back to heuristic parsing.
10. Resolve the check dependency graph from `check_catalog.py`, then execute ready checks in
   dependency order:
   - scaffolding
   - workflow
   - local_dev
   - deployment
   - security
   - report_quality
11. Compute blocked/skipped states from dependency outcomes and explicit applicability rules:
   - block local runtime if scaffolding failed catastrophically
   - block deployment if `--skip-deploy` is set or no deployed URL exists
   - always evaluate security and report-quality checks when their inputs exist
   - preserve exact `blocked_by` ancestry in the scorecard
12. Compute category scores, gate results, and final status.
13. Write the evidence bundle.
14. Run cleanup unless explicitly disabled.
15. Print a concise summary and return the appropriate exit code.

Read-only static checks may run in parallel. Live smoke checks should reuse a shared authenticated
session/bootstrap where possible to reduce redundant signup/signin churn.
The dependency DAG should be the source of truth for safe parallelization and skip behavior.

Retries should use bounded exponential backoff with jitter and record retry counts in evidence.

### CLI Surface

The harness should support:

    python tests/eval/eval_child_app.py
    python tests/eval/eval_child_app.py --profile core
    python tests/eval/eval_child_app.py --profile auth-plus
    python tests/eval/eval_child_app.py --profile full-stack
    python tests/eval/eval_child_app.py --resume ./out/<eval_id>
    python tests/eval/eval_child_app.py --cleanup-only ./out/<eval_id>
    python tests/eval/eval_child_app.py --projects-root /home/ubuntu/projects
    python tests/eval/eval_child_app.py --skip-deploy
    python tests/eval/eval_child_app.py --skip-cleanup
    python tests/eval/eval_child_app.py --eval-id child-eval-test-1
    python tests/eval/eval_child_app.py --evidence-dir ./out
    python tests/eval/eval_child_app.py --agent-timeout 900
    python tests/eval/eval_child_app.py --verification-timeout 300 --cleanup-timeout 180

Optional future flags:

- `--warmup-seconds`
- `--max-live-retries`
- `--parallel-checks`
- `--strict-cleanup`
- `--agent-runner`

## Key Files to Reuse

| Purpose | Path |
|---|---|
| HTTP client + recording | `tests/smoke/smoke_lib/client.py` |
| Neon auth flows | `tests/smoke/smoke_lib/auth.py` |
| Session bootstrap | `tests/smoke/smoke_lib/session_bootstrap.py` |
| Workspace helpers | `tests/smoke/smoke_lib/workspace.py` |
| File CRUD helpers | `tests/smoke/smoke_lib/files.py` |
| Git helpers | `tests/smoke/smoke_lib/git.py` |
| Vault secret access helpers | `tests/smoke/smoke_lib/secrets.py` |
| Runner pattern | `tests/smoke/run_all.py` |
| Existing child app smoke | `tests/smoke/smoke_child_app.py` |
| Root TOML example | `boring.app.toml` |
| Child app example(s) | existing examples under `examples/` |

## Evidence Output Shape

The summary artifact should be machine-readable and stable:

    {
      "eval_id": "child-eval-20260320T120000Z-a1b2c3d4",
      "eval_spec_version": "child-app-e2e-v2",
      "report_schema_version": "child-app-eval-report-v1",
      "capability_manifest_version": "child-app-capability-v1",
      "platform_profile": "full-stack",
      "repo_commit": "<sha>",
      "repo_dirty": false,
      "harness_version": "<sha-or-version>",
      "bui_version": "x.y.z",
      "lease_id": "lease-4c2b6f01",
      "timestamp": "2026-03-20T12:00:00Z",
      "status": "PASS",
      "status_detail": "agent_evaluated",
      "attribution_summary": {
        "agent_failures": 0,
        "provider_failures": 0,
        "harness_failures": 0
      },
      "core_score": 87.5,
      "extension_score": 72.0,
      "overall_score": 87.5,
      "critical_failures": [],
      "must_pass_failures": [],
      "categories": {
        "scaffolding": {"score": 95.0, "gate_met": true},
        "workflow": {"score": 100.0, "gate_met": true},
        "local_dev": {"score": 90.0, "gate_met": true},
        "deployment": {"score": 82.0, "gate_met": true},
        "security": {"score": 86.0, "gate_met": true},
        "report_quality": {"score": 92.0, "gate_met": true}
      },
      "checks": [
        {
          "id": "scaff.dir_exists",
          "category": "scaffolding",
          "weight": 3,
          "status": "PASS",
          "reason_code": "",
          "attribution": "agent",
          "retriable": false,
          "confidence": "high",
          "skipped": false,
          "blocked_by": [],
          "evidence_refs": ["artifact_manifest.json#project_root", "command_log.jsonl#12"],
          "detail": ""
        }
      ],
      "deployed_url": "https://...",
      "fly_app_name": "ce-0320-a1b2c3d4",
      "neon_project_id": "neon-xyz",
      "cleanup_errors": [],
      "run_state_path": "./out/child-eval-20260320T120000Z-a1b2c3d4/run_state.json",
      "redactions_applied": true,
      "operational_metrics": {
        "local_startup_s": 18.2,
        "live_warmup_s": 44.1,
        "retry_count": 3,
        "approx_cost_usd": 0.21,
        "evidence_bytes": 184320
      },
      "total_elapsed_s": 423.7
    }

## Validation of the Eval Itself

The harness itself should be tested before relying on it for benchmarking:

1. **Happy-path dry run**
   - Use a manually prepared known-good child app or a deterministic mock agent to ensure checks can all pass.
2. **Local-only mode**
   - Run with `--skip-deploy` to validate prompt generation, scaffolding checks, local checks, scoring, and evidence writing quickly.
3. **Intentional-failure fixtures**
   - secret leak fixture -> security auto-fail
   - missing custom route fixture -> functional fail
   - broken live URL fixture -> deployment fail
   - malformed final JSON fixture -> report-quality fail
   - forbidden path modification fixture -> scope/security fail
4. **Control agents**
   - liar agent -> emits a convincing success report without taking required actions; must fail
     workflow, deployment, and truthfulness checks
   - scaffold-only agent -> creates files but does not provision/deploy; should land in the expected
     `PARTIAL` or `FAIL` bucket
5. **INVALID-path fixtures**
   - missing CLI/tooling
   - missing credentials
   - simulated provider outage
6. **Cleanup idempotency**
   - run cleanup twice and verify the second pass is harmless
7. **Repeatability**
   - run the full eval multiple times in sequence and confirm timestamped names prevent collisions
8. **Canary governance**
   - run a known-good canary implementation on the current `eval_spec_version` before using scores
     for comparison or reporting regressions
9. **Mutation testing**
   - flip key checker predicates or remove critical evidence links in fixtures and verify the harness
     fails the run as expected
10. **Resume / cleanup crash recovery**
   - crash after resource creation, resume from `run_state.json`, and verify both continued scoring
     and cleanup-only mode
11. **Version bump discipline**
   - any substantive change to prompts, required checks, weights, gates, or profiles must bump
     `eval_spec_version`

## Implementation Plan

### Phase 1: Ground the contract

1. Finalize naming contract and derived paths.
2. Finalize the prompt contract and machine-readable report schema.
3. Decide which config checks are strict and which are semantic.

### Phase 2: Build the harness core

1. Implement preflight.
2. Implement agent launch/timeout/transcript capture.
3. Implement parsing and evidence writing.

### Phase 3: Build the verification modules

1. Scaffolding/build correctness
2. Local runtime validation
3. Deployment/live smoke tests
4. Security/scope hygiene
5. Report quality/truthfulness

### Phase 4: Scoring and status logic

1. Category scoring
2. Category gates
3. Critical auto-fails
4. `PASS` / `PARTIAL` / `FAIL` / `INVALID` / `ERROR`

### Phase 5: Cleanup and self-test

1. Best-effort teardown
2. Harness validation fixtures
3. Repeatability testing

## Recommendation

Implement this as a strict but not brittle end-to-end benchmark where the agent must both do the work **and** prove it did the work, while the harness independently verifies the local app, deployed system, security posture, scope discipline, and truthfulness of the report. That is the strongest practical design for measuring real autonomous delivery quality on this task.
