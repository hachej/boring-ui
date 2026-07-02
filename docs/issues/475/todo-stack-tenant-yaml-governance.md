---
github: https://github.com/hachej/boring-ui/issues/475
issue: 475
state: active
phase: plan
track: owner
updated: 2026-07-02
source_plan: docs/issues/475/plan-tenant-yaml-governance.md
thermo_review: fable pass 1 found blockers; this revision addresses them
---

# gh-475 stacked TODOs — tenant YAML governance

## Stack rules

- Keep each PR reviewable; do not combine UI, policy parsing, model filtering, budget admission, and filesystem enforcement.
- Tenant-specific governance logic lives in `apps/full-app/src/server/governance/` unless a slice explicitly adds a generic seam/table to `@hachej/boring-agent` or `@hachej/boring-core`.
- Missing YAML policy = governance disabled and current behavior preserved.
- Present invalid YAML policy = fail closed; never silently disable governance.
- Policy-derived privileges require `emailVerified === true`.
- Use exact `(provider, model id)` matches only.
- Budgets are EUR monthly calendar budgets, converted to credit micros.
- Post proof comments on every PR.

---

## PR 1 — Admin shell + user-menu entry

Branch: `issue/475-admin-layout`  
Base: `origin/main`  
PR: #476

### Goal

Keep the admin shell small and make the entry point match the final IA: Company Admin is reachable from the user menu, not Workspace Settings.

### TODO

- [x] Keep `/w/:id/admin` route for the current shell.
- [x] Keep `CompanyAdminPage` tabs:
  - [x] Context access
  - [x] Model control
- [x] User menu:
  - [x] show Company Admin to workspace owners when governance is disabled/local-dev compatibility;
  - [x] do **not** add Workspace Settings Company Admin card;
  - [x] leave tenant-admin-only gating for PR 2 when the generic per-user admin-status seam exists.
- [x] Remove any Workspace Settings admin card/link from current branch.
- [x] Plan docs:
  - [x] mark old `plan.md` superseded;
  - [x] keep `plan-tenant-yaml-governance.md` as source of truth;
  - [x] include this TODO stack.

### Tests / proof

- [x] `pnpm --filter @hachej/boring-ui-kit build`
- [x] `pnpm --filter @hachej/boring-core exec vitest run src/front/__tests__/CompanyAdminPage.test.tsx src/front/__tests__/userNavComponents.test.tsx src/front/__tests__/WorkspaceSettingsPage.test.tsx src/front/__tests__/CoreFront.test.tsx --no-file-parallelism`
- [x] `pnpm --filter @hachej/boring-core run typecheck`
- [x] `git diff --check`

### Review focus

- No tenant/YAML semantics leak into core UI yet.
- No actual policy enforcement in PR 1.

---

## PR 2 — YAML governance policy loader + read-only admin status/view

Branch: `issue/475-governance-yaml`  
Base: `issue/475-admin-layout`

### Goal

Introduce full-app-owned tenant governance policy parsing and expose read-only effective governance state. No model/filesystem enforcement yet.

### TODO

- [ ] Add `yaml` dependency to `apps/full-app`.
- [ ] Add `apps/full-app/src/server/governance/` module:
  - [ ] `policyTypes.ts` — typed parsed policy model;
  - [ ] `loadPolicy.ts` — reads `BORING_GOVERNANCE_POLICY_PATH`;
  - [ ] `validatePolicy.ts` — validation + normalized policy;
  - [ ] `governanceService.ts` — request-time methods;
  - [ ] `routes.ts` — authenticated governance routes;
  - [ ] `index.ts` — public full-app wiring surface.
- [ ] Policy loading semantics:
  - [ ] missing env/path/file => governance disabled;
  - [ ] file present but parse/validation fails in production => refuse to boot;
  - [ ] file present but parse/validation fails in dev => visible startup error + all policy-dependent actions denied;
  - [ ] never silently disable governance when policy file exists but is invalid;
  - [ ] restart-only reload for v1;
  - [ ] max YAML size 256 KiB;
  - [ ] duplicate user emails rejected after the same lowercase/trim normalization used at request time.
- [ ] Email verification boot check:
  - [ ] governance-enabled boot requires core email verification configured;
  - [ ] define production detection explicitly (prefer `NODE_ENV === 'production'` unless codebase has a better existing signal);
  - [ ] name the dev-only override env var before implementation;
  - [ ] if verification is not configured, refuse production boot unless that explicit dev-only override is set;
  - [ ] test both production fail and dev override behavior.
- [ ] Validation:
  - [ ] one tenant block;
  - [ ] optional `companyContextWorkspaceId` now, but PR 5a will make it required before company-context enforcement;
  - [ ] roles only `admin | user`;
  - [ ] exact model rows require non-empty `provider` and `id`;
  - [ ] `monthlyBudgetEur` finite and `>= 0`;
  - [ ] `defaultMonthlyModelBudgetEur` is documented but not used for absent rows in v1; absent model row still denies;
  - [ ] `perRunHoldEur` finite positive when model-budget enforcement is enabled; hold amount is `perRunHoldEur * 1_000_000` micros;
  - [ ] regex rules compile and pass safe subset/safety check.
- [ ] Request-time user policy:
  - [ ] normalize request user email;
  - [ ] if governance enabled and `emailVerified !== true`, all policy-derived privileges deny;
  - [ ] `roleForUser`, `isAdmin`, `allowedModelsForUser`, `assertModelAllowed`, `monthlyBudgetMicros`, `companyContextRules`.
- [ ] Per-user admin-status seam for shared core UI:
  - [ ] before coding PR2, pick exactly one seam in a short branch note: generic core hook/prop/context vs full-app-injected menu item;
  - [ ] do **not** hard-code `/api/v1/governance/me` into `@hachej/boring-core` UserMenu as a full-app-only dependency;
  - [ ] add a small generic hook/prop/context in core for optional admin entry status, where absence/404 = disabled; or inject the user-menu extra item from full-app;
  - [ ] full-app implements `/api/v1/governance/me` returning `{ enabled, role, admin }` to normal users and admin-only `policyStatus` details;
  - [ ] per-user admin status must not use app-global capabilities because capabilities are cached globally.
- [ ] CompanyAdminPage v1:
  - [ ] read-only policy/status view;
  - [ ] clear copy: “YAML-managed in v1”; no fake edit controls;
  - [ ] tenant invites shown as deferred/not implemented if present in copy.

### Tests / proof

- [ ] Governance loader unit tests:
  - [ ] missing policy disabled;
  - [ ] valid policy normalizes;
  - [ ] invalid YAML production boot fails;
  - [ ] invalid YAML dev mode returns visible error and denies policy-dependent actions;
  - [ ] duplicate users rejected after normalization;
  - [ ] invalid roles rejected;
  - [ ] invalid budgets rejected;
  - [ ] invalid/unsafe regex rejected;
  - [ ] governance-enabled boot fails without email verification config unless dev override;
  - [ ] unverified admin denied;
  - [ ] unverified normal user with configured model/context grants denied.
- [ ] Governance route tests for `/api/v1/governance/me`.
- [ ] UserMenu/admin-entry tests for governance admin visible/user hidden/disabled fallback/404 absence.
- [ ] CompanyAdminPage read-only view tests.
- [ ] `pnpm --filter full-app test -- governance`
- [ ] targeted core/front tests affected by UserMenu/admin page.
- [ ] typecheck for affected packages.

### Review focus

- Full-app owns tenant semantics.
- No app-global capabilities for per-user admin status.
- No policy enforcement yet beyond UI visibility/read-only status.

---

## PR 3 — Model picker filtering via generic agent seam

Branch: `issue/475-model-picker-policy`  
Base: `issue/475-governance-yaml`

### Goal

Filter visible/selectable models per user from YAML policy. No budget admission yet.

### TODO

- [ ] Add generic model filtering seam to `@hachej/boring-agent`:
  - [ ] `modelsRoutes(app, { filterModels? })` accepts request-aware callback;
  - [ ] callback receives immutable served model summaries and candidate default;
  - [ ] callback returns filtered `{ models, defaultModel? }`;
  - [ ] no mutation of cached registry arrays.
- [ ] Register routes plumbing:
  - [ ] `RegisterAgentRoutesOptions` adds model policy/filter option;
  - [ ] `registerAgentRoutes` passes it to `modelsRoutes`;
  - [ ] `createAgentApp` keeps no-policy behavior;
  - [ ] when policy callback configured, `/api/v1/agent/models` is not workspace-agnostic and has request user/workspace context.
- [ ] Provider capability leak check:
  - [ ] `getAvailableModelProviders()` duplicates registry/provider discovery;
  - [ ] either filter provider names using the same policy or explicitly accept provider-name leakage with rationale;
  - [ ] prefer filtering to keep model governance coherent.
- [ ] Full-app wiring:
  - [ ] pass governance model filter callback from `createCoreWorkspaceAgentServer` options/wiring;
  - [ ] governance disabled preserves existing model list;
  - [ ] governance enabled filters exact `(provider,id)` rows;
  - [ ] unverified user sees no policy-derived models;
  - [ ] default model omitted if denied.
- [ ] Front behavior:
  - [ ] existing `useChatModelSelection` clearing behavior is likely sufficient; add regression coverage rather than new logic unless tests fail;
  - [ ] define what “Default model (automatic)” means under governance;
  - [ ] hide/disable “Default model (automatic)” when the resolved default would be denied; do not wait for PR 4 admission because PR3 lands first.

### Tests / proof

- [ ] Agent route tests:
  - [ ] no callback = current behavior;
  - [ ] callback filters models;
  - [ ] denied default removed;
  - [ ] callback does not mutate cached models;
  - [ ] workspace context is required when callback configured;
  - [ ] provider names are filtered or accepted with explicit test/rationale.
- [ ] Full-app wiring test verifies callback is passed.
- [ ] Front test for empty allowed models / denied stored selection / automatic default behavior.
- [ ] `pnpm --filter @hachej/boring-agent test -- models`
- [ ] targeted full-app/core tests.
- [ ] typecheck for affected packages.

### Review focus

- Agent seam stays generic; no YAML/tenant semantics in agent.
- Filtering is not security by itself; run admission lands in PR 4.

---

## PR 4 — Model run admission + EUR monthly budget holds

Branch: `issue/475-model-budget-governance`  
Base: `issue/475-model-picker-policy`

### Goal

Enforce exact model allowlist and monthly EUR budget before execution. Use existing usage ledger plus a minimal governance hold table to prevent concurrent over-admission.

### TODO

- [ ] Generic agent strict model seam:
  - [ ] add `strictModelResolution` (or equivalent generic option) to register/harness options;
  - [ ] default preserves current silent fallback behavior;
  - [ ] full-app enables strict model resolution when governance is enabled;
  - [ ] do **not** add tenant/governance conditionals inside agent harness.
- [ ] Agent metering changes:
  - [ ] propagate resolved session model into follow-up metering reserve;
  - [ ] when strict model resolution is active, reject unknown/unavailable requested model instead of silent fallback;
  - [ ] ensure reserve sees the model that will actually execute.
- [ ] Stable error:
  - [ ] add `MODEL_BUDGET_EXCEEDED` (or repo-conformant equivalent) to `packages/agent/src/shared/error-codes.ts` because agent routes serialize this enum;
  - [ ] user message: `Budget reached for this model.`
- [ ] Core generic persistence:
  - [ ] add migration for `boring_model_budget_reservations`;
  - [ ] add schema export;
  - [ ] add a new sibling store file; do **not** grow `PostgresMeteringStore.ts` past 1k lines;
  - [ ] add indexes for `(user_id, provider, model, period)` and stale active holds.
- [ ] Hold lifecycle:
  - [ ] active/settled/released/expired statuses;
  - [ ] expiresAt TTL;
  - [ ] stale hold sweep;
  - [ ] idempotent reserve per run;
  - [ ] per-user advisory transaction lock.
- [ ] Budget calculation:
  - [ ] UTC month period key;
  - [ ] ledger `created_at` is timestamp without time zone, so month truncation must explicitly use UTC semantics;
  - [ ] sum existing `boring_usage_ledger` rows by `(user, provider, model, period)`;
  - [ ] include active holds;
  - [ ] double-count prevention mechanism: exclude ledger rows whose `run_id` has an active governance hold for the same tuple;
  - [ ] no unlimited budget in v1.
- [ ] Hold amount:
  - [ ] `holdMicros = perRunHoldEur * 1_000_000`;
  - [ ] use existing credits reservation sizing patterns as reference, but keep governance config independent.
- [ ] Full-app governance metering decorator:
  - [ ] wraps `AgentMeteringSink`, not `CreditsService`;
  - [ ] runs before delegated credits reserve;
  - [ ] checks verified user, exact model allowed, budget remaining;
  - [ ] reserves governance hold;
  - [ ] delegates to credits sink;
  - [ ] releases governance hold immediately if delegated credits reserve fails;
  - [ ] settles/releases governance hold when run settles/releases.
- [ ] Keep code out of `apps/full-app/src/server/credits.ts`; use sibling governance module.

### Tests / proof

- [ ] Store tests:
  - [ ] idempotent reserve;
  - [ ] concurrent reserve cannot exceed budget;
  - [ ] release frees hold;
  - [ ] expiry sweep frees stale holds;
  - [ ] ledger + active hold double-count prevention.
- [ ] Governance decorator tests:
  - [ ] disallowed model fails before credits reserve;
  - [ ] over-budget fails before execution with stable code/message;
  - [ ] delegated credits failure releases governance hold;
  - [ ] settle/release lifecycle correct;
  - [ ] unverified user denied.
- [ ] Agent metering tests:
  - [ ] prompt reserve uses resolved model;
  - [ ] follow-up reserve uses session resolved model;
  - [ ] unknown requested model fails under strict model resolution.
- [ ] `pnpm --filter @hachej/boring-core test -- budget governance metering`
- [ ] `pnpm --filter @hachej/boring-agent test -- metering piChat`
- [ ] typecheck for affected packages.

### Review focus

- No Stripe/LiteLLM dependency.
- Governance is policy/admission, not invoicing.
- Budget races are actually closed.

---

## PR 5a — Company Context workspace bootstrap + membership visibility

Branch: `issue/475-company-context-bootstrap`  
Base: `issue/475-model-budget-governance`

### Goal

Make the preprovisioned Company Context workspace a real tenant resource with correct admin-only workspace visibility. No filesystem mount yet.

### TODO

- [ ] Before PR 5a, resolve ownership of existing `packages/boring-bash` work; do not duplicate or collide with another agent’s binding model.
- [ ] Update policy validation:
  - [ ] `companyContextWorkspaceId` becomes required when company-context enforcement is enabled;
  - [ ] test required-when-enabled behavior.
- [ ] Bootstrap/reconcile Company Context workspace:
  - [ ] governance policy names `companyContextWorkspaceId`;
  - [ ] admins have workspace membership/visibility;
  - [ ] normal users do not get workspace membership;
  - [ ] document/create bootstrap command if auto-reconcile is deferred;
  - [ ] bootstrap must not let the normal default-workspace autocreate path create/claim the Company Context workspace.
- [ ] Workspace list/direct access:
  - [ ] admins see Company Context workspace;
  - [ ] normal users do not see Company Context workspace;
  - [ ] normal users cannot direct-open `/w/:companyContextWorkspaceId`.

### Tests / proof

- [ ] Admin workspace list/direct open tests.
- [ ] Normal user workspace list/direct forbidden tests.
- [ ] Bootstrap/reconcile tests.
- [ ] Policy validation test for missing companyContextWorkspaceId when enforcement enabled.

### Review focus

- Membership remains the workspace-visibility mechanism.
- Normal users are not workspace members of Company Context.

---

## PR 5b — Generic per-request/per-run filesystem binding seam

Branch: `issue/475-filesystem-binding-seam`  
Base: `issue/475-company-context-bootstrap`

### Goal

Add/choose the generic binding resolver seam with parity behavior and no tenant policy semantics yet.

### Pre-coding gate

Evaluate existing `packages/boring-bash` before building anything new:

- `FilesystemBindingResolver.resolveBindings(ctx)` already exists.
- `runtimeBindingManager` already scopes by `humanUserId`.
- readonly/management projection operations and fixture company-context provider already exist.
- Decide whether to bridge boring-bash into `RuntimeBundle.filesystemBindings` or create a smaller agent-native resolver. Document the decision before code.

### TODO

- [ ] Fix production binding wiring gaps:
  - [ ] `fileRoutes` supports `getFilesystemBindings`, but production registration currently omits it; wire it;
  - [ ] tree routes already have shape but read from shared bundle; make it use the chosen resolver;
  - [ ] agent tools must not capture user-agnostic bindings at bundle creation.
- [ ] Add generic resolver context:
  - [ ] `workspaceId`;
  - [ ] authenticated human user id/email where available;
  - [ ] session/run/request id as needed;
  - [ ] no tenant/YAML concepts in generic agent/workspace packages.
- [ ] Parity behavior:
  - [ ] when no resolver configured, current `runtimeBundle.filesystemBindings` behavior unchanged;
  - [ ] when resolver configured, both HTTP file/tree routes and agent filesystem tools resolve bindings through the same user-aware seam.
- [ ] Add cross-user cache-leak regression test with two users and one workspace.

### Tests / proof

- [ ] Agent file route binding tests now cover `getFilesystemBindings` wiring.
- [ ] Agent tool tests prove per-user bindings are not cached across users.
- [ ] Tree route tests still pass.
- [ ] No policy semantics in this PR.

### Review focus

- Avoid a third parallel binding abstraction if boring-bash can be reused.
- Do not multiply runtime bundles unnecessarily.
- No tenant-specific logic in agent generic seam.

---

## PR 5c — Company Context policy-filtered mount + front discovery

Branch: `issue/475-company-context-policy`  
Base: `issue/475-filesystem-binding-seam`

### Goal

Expose Company Context as a filtered `company_context` filesystem mount inside normal users’ personal workspaces.

### TODO

- [ ] Binding source:
  - [ ] `company_context` operations read from Company Context workspace storage/root;
  - [ ] not from the user's personal workspace;
  - [ ] preserve #416 binding access mode.
- [ ] Binding advertisement / front discovery:
  - [ ] personal workspace file tree can discover allowed `company_context` root;
  - [ ] per-user root discovery cannot use app-global capabilities;
  - [ ] choose concrete mechanism: extend `/api/v1/governance/me` with allowed roots or add a dedicated per-user roots endpoint;
  - [ ] wire the workspace filesystem plugin/FileTree props from that per-user source, without tenant semantics in workspace package.
- [ ] Enforcement:
  - [ ] policy present = deny by default;
  - [ ] only matched regex paths are visible/usable;
  - [ ] denied paths use #416 sanitized `not_found_or_denied` / 403/404 semantics;
  - [ ] readonly mutation denied;
  - [ ] readwrite mutation allowed only on matched paths;
  - [ ] agent filesystem tools and HTTP file/tree routes both enforced;
  - [ ] no user rules baked into shared cached runtime bundle.
- [ ] Regex safety:
  - [ ] compile at policy-load time;
  - [ ] safe subset/safe-regex check;
  - [ ] path/rule count bounds for list/find/grep.

### Tests / proof

- [ ] Binding tests:
  - [ ] allowed read/stat/list;
  - [ ] denied read/stat sanitized;
  - [ ] find/grep filtered;
  - [ ] readonly mutation denied;
  - [ ] readwrite mutation allowed only on matched path.
- [ ] Agent tool tests for the same policy paths.
- [ ] Front file-tree test for mounted `company_context` root visibility.
- [ ] Cross-user cache-leak regression remains green.

### Review focus

- Highest-risk security slice.
- Must prove agent tools cannot bypass HTTP-layer policy.
- Must prove normal users only get a filtered mount, never workspace visibility.

---

## PR 6 — Tenant invites (optional/deferred)

Branch: `issue/475-tenant-invites`  
Base: `issue/475-company-context-policy`

### Goal

Only do this if owner wants app-managed tenant invites in v1. Otherwise keep invites YAML/auth-managed and copy says deferred.

### TODO if implemented

- [ ] Define tenant invite model separate from workspace invites.
- [ ] Add DB table + routes for tenant invites.
- [ ] Invite accepts create/sign in account and apply tenant `user` role.
- [ ] Invited normal users do not become Company Context workspace members.
- [ ] Admin UI can create/revoke tenant invites.
- [ ] Email verification remains required before policy privileges apply.

### Tests / proof

- [ ] Tenant invite route tests.
- [ ] Accept flow tests.
- [ ] Normal user workspace visibility tests.

---

## Required reviews

- [ ] Fable/Claude plan review before implementation starts. ✅ done once; rerun after major plan edits.
- [ ] Thermo review this TODO stack before implementation starts.
- [ ] Thermo review after each implementation PR before finalizing.
- [ ] Extra strict review for PR 4 and PR 5b/5c because they touch budget and filesystem access enforcement.
