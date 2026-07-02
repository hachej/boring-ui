---
github: https://github.com/hachej/boring-ui/issues/475
issue: 475
state: active
phase: plan
track: owner
flag: not-needed
updated: 2026-07-02
supersedes: docs/issues/475/plan.md
---

# gh-475 tenant YAML governance plan

## Decision

Final product model:

- One app/company tenant for now.
- A preprovisioned **Company Context workspace** exists for the tenant.
- Tenant `admin` is separate from workspace `owner`.
- Admin users can:
  - see the Company Context workspace in the workspace switcher;
  - open Company Admin from the user menu;
  - invite app/tenant users;
  - assign tenant role `admin` or `user`;
  - decide which exact models each user can use;
  - set euro budgets per user per exact model;
  - decide which company-context paths each user can see.
- Normal users:
  - are invited to the app/tenant, not directly to the Company Context workspace;
  - never see the Company Context workspace in the workspace switcher;
  - only see `company_context` as a mounted/named filesystem inside their personal workspace, filtered by policy;
  - only see/use models allowed by policy;
  - get `Budget reached for this model.` when the model budget is exhausted.

Policy v1 is YAML-backed and read-only from the app UI. Admins edit the YAML on the host/volume for v1; the Company Admin UI shows the effective policy and status. UI editing and DB-backed policy persistence are later work.

Usage accounting uses the existing metering ledger; budget admission adds a minimal governance hold table so concurrent runs cannot all pass the same limit check.

## Superseded plan

`docs/issues/475/plan.md` is superseded by this plan. Keep it only as historical context for the admin shell PR. This plan is the source of truth for tenant/admin/model/company-context governance.

## Policy shape v1

Environment variable:

```bash
BORING_GOVERNANCE_POLICY_PATH=/data/boring-governance-policy.yaml
```

Example:

```yaml
tenant:
  id: company
  companyContextWorkspaceId: 00000000-0000-0000-0000-000000000001
  defaultMonthlyModelBudgetEur: 0
  perRunHoldEur: 1

users:
  - email: admin@example.com
    role: admin
    models:
      - provider: infomaniak
        id: Qwen/Qwen3.5-122B-A10B-FP8
        monthlyBudgetEur: 25
    companyContext:
      allow:
        - '^/.*'

  - email: user@example.com
    role: user
    models:
      - provider: infomaniak
        id: Qwen/Qwen3.5-122B-A10B-FP8
        monthlyBudgetEur: 5
    companyContext:
      allow:
        - '^/public/.*'
```

Rules:
- Missing policy file means governance is disabled, preserving existing behavior.
- Present-but-invalid policy means fail closed: refuse to boot the full app in production; in dev, return a visible startup error and deny policy-dependent actions. Never silently disable governance when the file exists but is invalid.
- Policy present means deny-by-default for users/models/company context not listed.
- Any policy-derived privilege requires `emailVerified === true` when governance is enabled. This includes tenant role, admin access, model access/budgets, and company-context path grants. Unverified accounts get deny-by-default. If email verification is not configured, governance-enabled boot must fail unless an explicit dev-only override is set.
- User emails are normalized to lowercase trimmed strings; duplicate emails are rejected.
- Model IDs are exact (`provider` + `id`) for v1; no glob/regex model matching.
- Budgets are UTC calendar-month budgets in EUR, converted to credit micros using the existing `1 EUR = 1_000_000 credit micros` convention.
- `monthlyBudgetEur: 0` means deny usage for that exact model. Absence of a model row means deny. No unlimited budget in v1.
- Budgets are hard admission caps against ledger usage plus active governance holds, with bounded overshoot only if real usage exceeds the configured per-run hold.
- Company-context regexes must compile and must pass a safe subset/safety check before use.
- YAML size is bounded (initial cap: 256 KiB). Policy reload is restart-only for v1.

## Implementation slices

### Slice A — Company Admin entry point + effective-policy view

- Restore the Company Admin shortcut in the user menu.
- Keep `/w/:id/admin` shell only as the current admin page route for PR #476; the route target for the menu is the current workspace until a tenant-level `/admin` route is introduced.
- Entry point visibility:
  - governance disabled: workspace owner shortcut remains for local/dev compatibility;
  - governance enabled: only verified tenant `admin` users see Company Admin.
- Remove the Workspace Settings Company Admin card; this is tenant/company admin, not workspace settings.
- Company Admin UI v1 is read-only: show effective tenant policy summary, loaded policy path/status, admin/user rows, model rows, and company-context rules. It does not edit policy.

Implementation seam:
- Do not put tenant/YAML logic in shared core front code.
- Add a full-app-owned authenticated route, e.g. `/api/v1/governance/me`, returning `{ enabled, role, admin, policyStatus }`.
- `UserMenu` can consume that route or a core extension prop; per-user admin status must not ride app-global capabilities because capabilities are cached globally.

Proof:
- User menu tests for admin visible/non-admin hidden.
- Company admin shell tests still pass.
- Governance route tests for missing policy, admin, user, unverified user.

### Slice B — YAML policy loader

- Add full-app server governance module under `apps/full-app/src/server/governance/`.
- Add `yaml` as a full-app dependency.
- Parse/validate/cache policy at startup; restart-only reload for v1.
- Validate:
  - tenant is present;
  - companyContextWorkspaceId exists when governance is enabled;
  - user emails are normalized and unique;
  - roles are `admin | user`;
  - all policy-derived privileges require a verified user at request time; unverified users get deny-by-default;
  - model rows have exact `provider` + `id`;
  - budgets are finite non-negative EUR;
  - company-context regex rules compile and pass safety constraints.
- Expose service methods:
  - `isEnabled()`;
  - `policyStatus()`;
  - `roleForUser(user)`;
  - `isAdmin(user)`;
  - `allowedModelsForUser(user, servedModels)`;
  - `assertModelAllowed(user, model)`;
  - `monthlyBudgetMicros(user, model)`;
  - `companyContextRules(user)`;
  - `companyContextWorkspaceId()`.

Proof:
- Unit tests with missing policy, valid policy, invalid file, duplicate users, invalid role/model/budget/regex, unverified admin, and unverified normal user with configured model/context grants denied.

### Slice C — model picker filtering

- Add a generic agent seam for model filtering; full-app supplies tenant policy callback.
- `modelsRoutes` gets an options object like other subroutes:
  - `filterModels?: (request, models, defaultModel) => Promise<{ models; defaultModel? }>`.
- `GET /api/v1/agent/models` remains existing behavior when no policy callback is configured.
- When configured, the route must be request/workspace/user aware and not workspace-agnostic. Remove/avoid `/api/v1/agent/models` from workspace-agnostic handling when policy filtering is enabled.
- Filter served models through policy; do not mutate shared registry/model arrays.
- Return `defaultModel` only if it is allowed.
- UI model picker naturally receives only allowed models. Add UI coverage for no allowed models and denied default.

Proof:
- Agent `modelsRoutes` tests: filtered models, denied default removed, no-policy unchanged.
- Register routes test verifies model-policy callback disables workspace-agnostic model route behavior.
- Full-app wiring test verifies callback is passed to `registerAgentRoutes`.

### Slice D — model run admission + monthly budget governance

- Wrap the existing credits metering sink in a full-app governance metering decorator. Keep this outside `apps/full-app/src/server/credits.ts`; add `apps/full-app/src/server/governance/`.
- On `reserveRun` when governance is enabled:
  - require authenticated verified user;
  - resolve the actual model that will execute;
  - reject unknown/unavailable requested model instead of silently approving one model while the harness falls back to another;
  - require model allowed by policy;
  - reserve budget against `(userId, provider, model, utcMonth)` before delegating to credits sink;
  - if delegated credits reserve fails, release the governance hold immediately.
- Follow-up runs must carry the session's resolved model into metering reserve. Add the required agent-package change; do not assume follow-up model is present today.
- Add stable error code and message for budget admission:
  - code: `MODEL_BUDGET_EXCEEDED` (exact naming can follow existing error-code conventions);
  - message: `Budget reached for this model.`

Governance hold persistence:
- Add a generic, currency-neutral core table/store, similar in spirit to existing credit reservations:
  - `boring_model_budget_reservations`
  - columns: `id`, `user_id`, `workspace_id`, `provider`, `model`, `period`, `run_id`, `amount_micros`, `status`, `expires_at`, timestamps.
- Use core migrations because full-app currently only runs core migrations.
- Keep table/store generic; full-app owns tenant/YAML semantics.
- Admission is serialized with a Postgres advisory transaction lock. Prefer per-user lock (same precedent as credit admission) unless a narrower lock is clearly simpler.
- Remaining budget formula:
  - monthly ledger usage for `(user, provider, model, period)`
  - plus active governance holds for that tuple
  - avoid double-counting ledger rows for runs whose governance hold is still active.
- Add expired-hold sweep, matching the existing credit reservation lifecycle pattern.
- On `settleRun` / `releaseRun`, settle/release governance hold alongside the delegated credits sink.
- Actual usage remains recorded in existing `boring_usage_ledger`; governance uses ledger sums plus active holds for admission.

Proof:
- Unit/integration tests:
  - disallowed model fails before credits reserve;
  - over-budget model returns `Budget reached for this model.` before execution;
  - concurrent reserves cannot exceed budget + holds;
  - delegated credits failure releases governance hold;
  - release frees a hold;
  - expired-hold sweep frees stale holds;
  - settlement leaves actual usage in existing ledger as source of truth;
  - follow-up reserves use the resolved session model.

### Slice E — Company Context workspace + filesystem policy enforcement

Preprovisioning:
- Governance policy names the preprovisioned Company Context workspace id.
- Admin users must be members/owners of the Company Context workspace. Add startup/reconcile logic or a documented bootstrap command to ensure YAML admins have membership.
- Normal users are not added as members of the Company Context workspace.
- Workspace list behavior follows membership:
  - admins see Company Context workspace;
  - normal users do not.

Binding source:
- Full-app must create/advertise the `company_context` binding for personal workspaces when governance is enabled and policy allows any paths for the user.
- Define the storage source explicitly: the binding operations read from the Company Context workspace storage/root, not from the user's personal workspace.
- Wire `company_context` bindings into every consumer path that can touch files:
  - file/tree HTTP routes;
  - agent filesystem tools;
  - front file tree root discovery/props.

Policy enforcement seam:
- Do not bake user policy into cached workspace runtime bundles.
- Current runtime bundles are workspace-scoped, and agent filesystem tools capture bindings from the bundle. Therefore implement one of these before enforcing:
  1. user-scoped runtime bundle/cache key; or
  2. a per-request/per-run filesystem-binding resolver seam used by both HTTP routes and agent tool execution.
- Prefer option 2 if it avoids multiplying runtime bundles.
- Add a cross-user cache-leak regression test.

Rules:
- Policy present means deny by default.
- Normal users never see Company Context as a workspace, only filtered `company_context` mount in personal file tree.
- Admins can see Company Context workspace and broad context rules.
- Preserve binding access mode:
  - readonly stays readonly;
  - readwrite mutates only matched paths.
- Policy-denied paths use #416 sanitized `not_found_or_denied`/403/404 semantics in both HTTP and agent tool paths.

Proof:
- Fake binding tests: allowed read, denied sanitized read/stat, readonly mutation denied, readwrite mutation allowed only for matched paths.
- Agent tool tests, not only HTTP route tests.
- Workspace list/direct-access tests: normal user cannot list/open Company Context workspace; admin can.
- Front file tree test: normal user sees only mounted allowed `company_context` root/paths.
- Cross-user cache-leak regression test.

### Slice F — tenant invites and roles

V1 must not pretend workspace invites are tenant invites.

- Existing workspace invites remain workspace-scoped.
- Add tenant invite semantics only if UI promises invites in Company Admin.
- If tenant invites are not implemented in this stack, Company Admin v1 must show them as `not implemented`/read-only and the plan must not claim invitation support is shipped.
- Recommended v1 scope: policy YAML lists users and roles; app signup is still existing auth. Tenant invite UI is deferred.

Proof if deferred:
- Company Admin copy says policy is YAML-managed and tenant invites are not implemented in v1.

## Open implementation questions

Resolved by owner:
- one tenant now;
- deny-by-default when policy exists;
- app-level `admin | user` roles;
- YAML v1;
- EUR monthly budgets;
- exact model IDs;
- tenant invite for normal users;
- normal users never see Company Context workspace, only filtered mount.

Remaining design choice before Slice E implementation:
- choose user-scoped runtime bundles vs per-request/per-run filesystem binding resolver. This should be settled after a short code spike/review, before coding enforcement.

## Thermo/Fable review notes addressed

This revision incorporates Fable blockers from the first plan review:
- restores cache-leak mechanism and test for company-context enforcement;
- scopes real production binding/provisioning work instead of assuming playground bindings exist;
- requires model enforcement against the resolved executed model and follow-up model propagation;
- closes email-keyed policy privilege escalation via verified-email requirement for all policy-derived privileges;
- defines invalid-policy fail-closed behavior;
- resolves incoherent workspace-owner vs tenant-admin gating by adding a full-app governance/me route and read-only v1 admin UI;
- avoids over-promising tenant invites in YAML v1;
- gives governance holds a migration home, lifecycle, and delegated-credit-failure release behavior.

## Review bar before implementation

- Get Fable Claude Code CLI review on this plan.
- Do not start implementation until Fable says implementation may start or all blockers are explicitly resolved.
- After implementation, run thermo review again before finalizing PRs.
