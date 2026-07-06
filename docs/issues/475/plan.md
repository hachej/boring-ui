---
github: https://github.com/hachej/boring-ui/issues/475
issue: 475
state: superseded
phase: plan
track: owner
flag: not-needed
updated: 2026-07-02
---

# gh-475 company admin controls

> Superseded by [`plan-tenant-yaml-governance.md`](./plan-tenant-yaml-governance.md). Historical sections below are obsolete where they conflict with the tenant YAML governance plan and [`todo-stack-tenant-yaml-governance.md`](./todo-stack-tenant-yaml-governance.md). For PR #476 specifically, the final IA is **user-menu Company Admin shortcut**, not Workspace Settings.

## Decision

Add a workspace/company owner-only admin surface in core, reachable from workspace settings, then stack two policy features on top:

1. **Admin layout:** `/w/:id/admin` page with tabs, linked from workspace settings only when the current workspace role is `owner`.
2. **Company context access:** owner-managed simple regex allow rules that filter the advertised `company_context` filesystem binding per user.
3. **Model controls:** owner-managed per-user model allowlist plus per-model token/credit budgets, enforced at model discovery and run admission/metering.

This belongs in `@hachej/boring-core` because core owns users/workspaces/members/persistence and already composes the agent/workspace app. Enforcement seams stay in agent/workspace through existing injection points rather than value-importing core from front/shared workspace code.

## Research summary

- Company FS stack (merged on `main` as #416):
  - `origin/main` now contains the company-fs stack through `ccbc5f92` (`#416 company-fs: enforce readonly company viewers`).
  - The merged stack preserves explicit filesystem identity in chat references, adds named runtime filesystem bindings, exposes a company file-tree root, and supports binding-driven access (`readonly` or `readwrite`) without company-specific tool names.
  - Tools/routes accept `filesystem: 'company_context'` and route read/list/find/grep/stat and supported mutations through `RuntimeFilesystemBindingOperations` when the binding permits them.
  - Readonly company viewers reject writes; denied company-context reads are sanitized as 403/404 without leaking path existence.
  - The key seam is `RuntimeBundle.filesystemBindings?: RuntimeFilesystemBinding[]`, consumed by file/tree routes and filesystem tools. Policy should wrap/filter the `company_context` binding for the current request/session, not create separate company-specific tools.
- Model/metering stack:
  - Model selector fetches `GET /api/v1/agent/models`; the server builds from Pi `ModelRegistry` plus configured custom/Infomaniak providers (`modelConfig.ts`).
  - Chat payload includes `{ provider, id }`; Pi metering reserves before execution and records native token/cost usage through `AgentMeteringSink`.
  - Core credits persist `boring_usage_reservations` and `boring_usage_ledger` with `provider`, `model`, input/output/cache token counts, and billed/provider cost micros. `CreditsService.reserveRun` is currently a user-level credit hard stop; token→credit rates live in `credits/pricing.ts`.
  - Existing billing is account/user-level credits. Per-model budgets should layer as an additional policy gate and usage query, not replace the credit ledger.

## Flag

`not-needed`: owner-only routes are fail-closed; when no policy rows exist, preserve current behavior:

- company context binding behavior remains whatever the merged company-fs stack advertises today;
- model list remains the existing registry-derived list;
- credits/billing admission remains unchanged.

## Acceptance

- A workspace owner can open **Company admin** from workspace settings and see two tabs: **Context access** and **Model control**.
- Non-owners cannot see the menu item and receive 403 from admin APIs/pages that require owner privileges.
- Context access rules support simple regex strings, validate invalid regex at write time, reject unsafe regex shapes or run on a safe regex engine/subset, and are enforced before company-context tree/file/tool operations are exposed.
- Context policy semantics are exact: if a workspace has no context-policy rows, preserve existing company-fs behavior; once any context policy exists for the workspace, a user with no matching allow rule is deny-all for `company_context`.
- Model controls support per-user allowed models and per-model budget limits, validate against the served model catalog, and prevent disallowed/over-budget model runs before tokens are spent.
- Model policy semantics are exact: if a workspace has no model-policy rows, preserve existing model behavior; once any model policy exists for the workspace, a user/model with no allow row is denied/unlisted.
- Model selector shows only the current user's allowed available models and clears/falls back safely if the stored model becomes disallowed.
- Usage/budget enforcement reuses the existing usage ledger fields (`userId`, `provider`, `model`, token counts, billed micros) plus budget reservations/holds so concurrent runs cannot over-admit; all admission remains idempotent with run reservation/settlement.

## Slices / stacked branches

### PR 1 — admin layout

Branch: `issue/475-admin-layout` from `origin/main`.

Scope:
- Add `routes.companyAdmin = '/w/:id/admin'` and legacy `/workspace/:id/admin` route.
- Add `CompanyAdminPage` shell in `packages/core/src/front/workspace/` with two tabs: Context access and Model control.
- Add a Workspace settings **Company admin** card guarded by `useWorkspaceRole() === 'owner'` and current workspace id. Do not add this to the user menu; this is workspace/company settings, not user settings.
- Add read-only placeholder copy and test coverage for owner visibility/non-owner hiding in workspace settings, route rendering, and tab switching.

Proof:
- `pnpm --filter @hachej/boring-core test -- UserMenu CompanyAdminPage CoreFront`
- `pnpm --filter @hachej/boring-core run typecheck`

### PR 2 — company context regex access

Branch: `issue/475-context-access` from `issue/475-admin-layout`.

Scope:
- Add migration/table for workspace-scoped context policies, e.g. `boring_company_context_access_rules` with `workspace_id`, `user_id`, `pattern`, `created_by`, timestamps. Rules are allow rules; no rows means unchanged behavior for compatibility.
- Add store/service APIs to list/upsert/delete rules and compile regex safely. Bound length/count; invalid regex returns `VALIDATION_FAILED`.
- Add owner-only routes under `/api/v1/workspaces/:id/admin/company-context-access`.
- In the core→agent runtime binding composition, add a request/user-scoped policy layer for `company_context` operations so list/find/grep/read/stat and any binding-permitted mutations only operate on paths matching the current user's compiled allow rules. Do **not** bake one user's rules into a cached runtime bundle; include a cross-user cache/leak regression test.
- Preserve the merged binding's access mode: readonly stays readonly; readwrite may mutate only matched paths. For denied reads/stat, return sanitized forbidden/not-found consistent with #416.
- Regex safety: either use RE2/safe-regex-compatible matching or restrict to an anchored/simple subset; bound rule length/count and list/find/grep path evaluation count.
- UI: Context access tab lists members and regex rules, with add/remove controls and inline validation.

Proof:
- Core route/store tests for owner-only access and regex validation.
- Agent/workspace integration tests using fake `company_context` bindings: allowed path passes, denied path is sanitized, readonly mutation remains denied, and readwrite mutation is allowed only for matched paths.
- `pnpm --filter @hachej/boring-core test -- CompanyAdmin companyContext`
- `pnpm --filter @hachej/boring-agent test -- file tree filesystem`

### PR 3 — model controls and budgets

Branch: `issue/475-model-controls` from `issue/475-context-access`.

Scope:
- Add workspace-scoped model policy tables, e.g. `boring_workspace_model_policies` (`workspace_id`, `user_id`, `provider`, `model`, optional `token_budget_input`, `token_budget_output`, optional `credit_budget_micros`, period key) and optional aggregate/materialized query helpers over `boring_usage_ledger`.
- Add owner-only routes under `/api/v1/workspaces/:id/admin/model-control` to list served models, list member policies, and upsert/delete per-user model limits.
- Add an agent/core model policy seam:
  - pass a host-provided policy callback into `modelsRoutes` and `registerAgentRoutes`;
  - make `/api/v1/agent/models` authenticated/workspace-scoped when policy is enabled (remove/avoid workspace-agnostic handling for this route in the composed core app);
  - filter returned models/default by current user/workspace allowlist;
  - reject prompt/follow-up reservation when the selected/default model is disallowed;
  - reserve/check budget remaining transactionally before run admission using `(workspaceId,userId,provider,model,period)` budget holds plus ledger totals, so concurrent runs cannot all pass the same pre-run check.
- Ensure custom model list per user is derived from `registry.getAll()` intersected with policy rows, preserving configured custom/Infomaniak providers and default-model semantics. When any workspace model policy exists, omission is deny; admins must create explicit allow rows.
- UI: Model control tab lists members × models, supports allow/deny and per-model token/credit limits, and displays current usage from ledger totals.

Proof:
- Model route tests: user sees only allowed models; disallowed stored selection is not returned as available/default.
- Metering/admission tests: disallowed model rejects before reserve/execute; over-budget rejects before tokens are spent; allowed in-budget usage records normally.
- UI tests for policy editing and validation.
- `pnpm --filter @hachej/boring-core test -- modelControl credits`
- `pnpm --filter @hachej/boring-agent test -- models metering`

## Open Questions

- Should empty context/model policy mean **compatibility allow existing behavior** (planned) or **fail-closed deny until configured**? For rollout safety this plan uses compatibility behavior.
- Budget period: monthly calendar, rolling 30 days, or lifetime? Planned schema should support a period key; initial UI can use monthly if owner confirms. Until confirmed, use calendar-month period keys internally and keep the UI copy explicit.
- Are budgets token-only, credit-only, or both? Plan supports both but can ship credit budget first because credits are already product policy.

## Review notes

- Owner-track: permissions and billing-adjacent changes are not fast-track.
- Keep enforcement server-side. Frontend filtering is convenience only.
- Do not fork company-context filesystem semantics from #416; consume the generic named-filesystem binding seam.
- Do not mutate provider/API-key configuration per user; user custom model list is a policy-filtered view over the served registry.
