---
github: https://github.com/hachej/boring-ui/pull/471
issue: 471
state: active
phase: plan
track: owner
flag: not-needed
updated: 2026-07-02
---

# Plan: generated-pane profiles + BI dashboard profile cleanup

## Goal

Make `@hachej/boring-generated-pane` the first-class agent-generated UI runtime, and make `@hachej/boring-bi-dashboard` a clean BI profile/plugin built on top of it.

This is a **gap-closure plan**, not a greenfield plan. The branch already has a working generated-pane renderer, a BI dashboard profile inside `BiDashboardPane.tsx`, `bi-dashboard.v1.validate`, Arrow-backed Perspective rendering, and release-list coverage in most scripts. The remaining work is to make the architecture explicit, remove drift, and make validation/skills/release behavior consistent.

## Target mental model

- `generated-pane` = generic engine/runtime.
- `vocabulary` = React-free shared contract: allowed component types, prop schemas, descriptions, slots, and static diagnostics.
- `profile` = front-end binding: a vocabulary plus React components for rendering.
- `bi-dashboard` = a generated-pane vocabulary/profile plus dashboard query semantics and data-bridge integration.
- `data-bridge` = query execution and data source adapters.

Important split:

```txt
shared/server-safe vocabulary
  can be imported by validate ops and skills/tests

front profile bindings
  can import React and render components
```

Do **not** put React components on the server-importable validation object.


## Decision

Implement the generated-pane vocabulary/profile split as a follow-up to PR #471 so BI dashboard becomes a first-class generated-pane profile without making generated-pane know BI/data semantics.

## Flag

`not-needed`: this is a package/API refactor for newly introduced plugin architecture. It lands through small slices with compatibility wrappers and focused validation; no runtime feature flag is required.

## Owner gate

Do not start code before owner approval of this plan. Direct pushes to `main` are allowed only through the approved release procedure.

## Proof

Each slice must record commands run and results. Minimum proof:

- `pnpm --filter @hachej/boring-generated-pane typecheck`
- `pnpm --filter @hachej/boring-generated-pane test`
- `pnpm --filter @hachej/boring-generated-pane build`
- `pnpm --filter @hachej/boring-bi-dashboard typecheck`
- `pnpm --filter @hachej/boring-bi-dashboard test`
- `pnpm --filter @hachej/boring-bi-dashboard build`
- `pnpm audit:publish-manifests`
- `pnpm audit:imports`
- `pnpm lint:workspace-plugin-invariants`
- `pnpm lint:invariants` for final/broad boundary changes

## Current state verified by review

Already shipped or mostly shipped:

- `GeneratedPaneProfile`, `defineGeneratedPaneProfile`, `mergeGeneratedPaneProfiles`, `GeneratedPaneRenderer` exist in `plugins/generated-pane/src/front/catalog.tsx`.
- BI dashboard already constructs its profile at module scope and uses `BiDashboardRenderContext`; no per-render profile creation remains.
- `bi-dashboard.v1.validate` exists in `plugins/bi-dashboard/src/server/index.ts`.
- BI validation already composes `parseGeneratedPaneSpec()` and component prop schemas.
- Most BI diagnostics exist: `chart.category_as_measure`, `chart.measure_missing`, `chart.category_missing`, `perspective.group_field_in_columns`.
- Skills already broadly describe validate/repair and BI chart authoring rules.
- `scripts/version.mjs`, `scripts/set-ci-package-version.mjs`, release workflow, and publish audit mostly know dashboard packages.

Review closure:

| Finding | Status in this plan |
| --- | --- |
| Stale greenfield plan | Closed: rewritten as a gap-closure plan with current-state inventory. |
| React profile imported by server | Closed: vocabulary/profile split makes validation React-free. |
| No profile-resolution design | Closed: no global registry in this plan; routing stays surface-resolver based. |
| API sketch conflicted with existing actions/renderer | Closed: `GeneratedPaneRenderer` remains the only render entrypoint; actions are de-scoped from this plan and must be removed from docs/skills/API promises until a separate action plan defines capability boundaries. |
| Examples drift from schemas | Open work item in Phase 4 with validation tests. |
| `queries` contradiction | Closed: `queries` is generic opaque manifest in base contract. |
| validate op raw path / casts | Open work item in Phase 3; must be fixed, not deferred. |
| BI file too broad | Open work item in Phase 2 with concrete extraction targets. |
| Generic validate-loop promise | Planned: generated-pane will ship `generated-pane.v1.validate` for base/absent profile only in Phase 3c; profile plugins own profile-specific validate ops. |
| Release hazards | Open work item in Phase 0b; must land before any version bump/release. |

Real remaining gaps:

1. No React-free `GeneratedPaneVocabulary` abstraction.
2. No generic structured diagnostics API in generated-pane shared code.
3. `GeneratedPaneRenderer` still rebuilds merged profile/catalog/registry and validates on every render.
4. BI profile is still embedded in `BiDashboardPane.tsx` instead of exported as an explicit profile binding.
5. BI shared schemas are not presented as a named vocabulary.
6. Validation returns mixed string errors and structured diagnostics; generic/profile error codes are not normalized.
7. `bi-dashboard.v1.validate` hand-rolls handler registration and raw path resolution.
8. Generic generated-pane skill cannot honestly require a WorkspaceBridge validate loop until generated-pane ships a server op.
9. Release script `scripts/cut-release.sh` historically omitted dashboard package manifests from its `git add` block.
10. Root `release:*` scripts point at `scripts/release.mjs`; verify or fix before relying on them.
11. Skills/examples contain schema-drift risk and need tests.
12. npm access for dashboard/generated packages must be fixed before a successful public release.

## Non-goals

- Do not merge all code into one package.
- Do not make generated-pane know SQL/BSL/Perspective.
- Do not allow arbitrary React components from JSON.
- Do not expose DB credentials or raw paths to the browser.
- Do not reintroduce Perspective websocket as the default dashboard path.
- Do not add cross-plugin profile auto-discovery in this plan.

## Profile resolution decision

No global profile registry for now.

The `profile` string is a declaration validated by the owning plugin, not a dispatch key. Routing remains file-extension/surface-resolver driven:

- `*.pane.json` -> generated-pane surface/pane.
- `*.dashboard.json` -> bi-dashboard surface/pane.

If a generic pane declares an unknown non-base profile, generated-pane should report a diagnostic explaining that profile-specific validation belongs to the owning plugin. Exact rules: omitted `profile` means `base`; the default/base surface and `generated-pane.v1.validate` reject non-base profiles with `generated-pane.unsupported_profile`; `GeneratedPaneRenderer` with an explicit profile accepts only `spec.profile === profile.vocabulary.id`; BI passes `biDashboardGeneratedPaneProfile`; unknown or mismatched profiles return `generated-pane.unsupported_profile`; `bi-dashboard.v1.validate` accepts only `profile: "bi-dashboard"`. A future cross-plugin profile registry would require a workspace plugin contribution point and deserves its own plan.

## Base `queries` field decision

`GeneratedPaneSpec` already has `queries?: Record<string, unknown>`. Treat this as a generic, profile-opaque data manifest field. `generated-pane` must not interpret SQL/BSL/Perspective. Profiles may interpret `queries` according to their own shared vocabulary/diagnostics.

## Target package responsibilities

### `@hachej/boring-generated-pane`

Owns:

- Base JSON element graph contract.
- React-free vocabulary contract.
- Structured diagnostic types.
- Generic validator: structural checks, unknown component checks, prop schema checks, slot/children checks.
- Front profile binding contract.
- `GeneratedPaneRenderer`.
- Generic generated-pane explorer and surface resolver for `*.pane.json`.
- Planned generic `generated-pane.v1.validate` op for `*.pane.json` validate/repair workflows when `profile` is absent or `base`.

### `@hachej/boring-bi-dashboard`

Owns:

- `biDashboardVocabulary` in shared code.
- `biDashboardGeneratedPaneProfile` in front code.
- BI component schemas and diagnostics.
- Dashboard query manifest contract.
- Dashboard file explorer/source for `*.dashboard.json`.
- `bi-dashboard.v1.validate` WorkspaceBridge op.
- BI dashboard authoring skill.

### `@hachej/boring-data-bridge`

Owns:

- `data.v1.query.run`.
- JSON and Arrow result contracts.
- SQL/BSL execution routing.
- trusted server adapters such as DuckDB/ClickHouse.
- no BI-specific semantics.

## Target APIs

### Shared vocabulary API

In `plugins/generated-pane/src/shared/index.ts` or a new `src/shared/vocabulary.ts`:

```ts
export type GeneratedPaneDiagnosticSeverity = "error" | "warning" | "info"

export interface GeneratedPaneDiagnostic {
  severity: GeneratedPaneDiagnosticSeverity
  code: string
  message: string
  elementId?: string
  path?: string
}

export interface GeneratedPaneComponentVocabularyEntry {
  description: string
  props: z.ZodTypeAny
  slots?: string[]
}

export interface GeneratedPaneVocabulary {
  id: string
  label: string
  components: Record<string, GeneratedPaneComponentVocabularyEntry>
  diagnostics?: Array<(spec: GeneratedPaneSpec) => GeneratedPaneDiagnostic[]>
}

export function defineGeneratedPaneVocabulary(vocabulary: GeneratedPaneVocabulary): GeneratedPaneVocabulary
export function validateGeneratedPaneSpec(value: unknown, vocabulary?: GeneratedPaneVocabulary): {
  spec: GeneratedPaneSpec | null
  diagnostics: GeneratedPaneDiagnostic[]
}
```

Notes:

- Use zod only. Do not introduce `ZodSchema | JsonSchemaLike` unless there is a real consumer.
- Result semantics: root/envelope/graph parse failures return `spec: null`; prop/profile/whole-spec failures return diagnostics with parsed `spec` when possible.
- WorkspaceBridge handlers throw only for transport/auth/malformed-request failures; validation failures return diagnostics.
- Keep diagnostics whole-spec for now. Per-component diagnostics are speculative and not needed by current BI cases.
- Keep compatibility wrappers such as `parseGeneratedPaneSpec()` if already exported, but implement them through the new structured validator.

### Front profile API

Actions are out of scope for this cleanup. Current action mentions in package description/docs/skills should be removed or marked future until a separate action contract defines event JSON, handler ownership, WorkspaceBridge routing, and capability checks.

In `plugins/generated-pane/src/front/catalog.tsx`:

```ts
export interface GeneratedPaneComponentBinding {
  component: React.ComponentType<GeneratedPaneComponentProps>
}

export interface GeneratedPaneProfile {
  vocabulary: GeneratedPaneVocabulary
  components: Record<string, GeneratedPaneComponentBinding>
}
```

Notes:

- De-scope `actions` from this plan: remove action promises from generated-pane docs/skills/package description or mark them explicitly future-only.
- `GeneratedPaneRenderer` remains the render entrypoint; do not add a duplicate `renderGeneratedPane()` function.
- Component metadata lives in `vocabulary.components`; front `profile.components` are render bindings only.
- Strict profile/vocabulary mismatch rejection is enabled only after BI has migrated to the new shape; until then legacy profile compatibility remains explicit.
- Memoize merged profile/catalog/registry/validation where appropriate.

## Implementation phases

### Phase 0a — Agent validation workflow safety patch

This phase must be the first implementation slice and must land before any Phase 1/2 vocabulary/profile refactor work.

Tasks:

- [ ] Fix current BI and generated-pane skills so agents do not call validation with `{ path }`; agents should read JSON then call validate with `{ spec }` once validate ops exist.
- [ ] Fix BI skill examples to match `dashboardQuerySchema`: SQL queries use `{ id, source, sql, params?, limit? }`, not a fake `language` field or `model/groupBy/measures` shape.
- [ ] Add README/eval/example JSON checks so skill/docs examples cannot drift from schemas.
- [ ] Remove or mark generic generated-pane validate-loop instructions as “planned” until Phase 3c lands.
- [ ] Update current `bi-dashboard.v1.validate` to be `{ spec }`-only, remove `data:read`, use `bi-dashboard:validate`, and remove raw path reads before any release that teaches agents to use it.

Acceptance:

- Skills do not teach invalid JSON or unavailable `{ path }` validation.
- README/eval/example JSON checks pass.
- `bi-dashboard.v1.validate` no longer performs raw path reads and no longer requires `data:read`.


### Phase 0b — Release hazard cleanup before version bump/release

This phase is independent of the API refactor and must land before any version bump or release, but after Phase 0a if both are in the same PR.

- [ ] Verify `scripts/cut-release.sh` stages all publishable package manifests, including:
  - `plugins/generated-pane/package.json`
  - `plugins/data-bridge/package.json`
  - `plugins/bi-dashboard/package.json`
- [ ] Verify/fix root `release:patch`, `release:minor`, `release:major` scripts. They currently reference `scripts/release.mjs`; either provide that script or point them at the real release path.
- [ ] Add/verify a `*.tgz` ignore rule if generated package tarballs are expected locally.
- [ ] Ensure `scripts/cut-release.sh` stages `pnpm-lock.yaml` when versioning changes it.
- [ ] Add script-level dirty-tree proof before release commit/tag creation: `git status --short` must contain only intended release files and no untracked tarballs.
- [ ] Add an executable dry-run/test for release staging: after a version bump, staged files must equal the publishable package manifest list plus `pnpm-lock.yaml` when changed.
- [ ] Run/prove `node scripts/version.mjs --check` after the hardening change.
- [ ] Existing local `*.tgz` artifacts must be covered by ignore rules or cleaned only with explicit owner approval.
- [ ] Do not cut a release in Phase 0; this phase only hardens scripts.

Acceptance:

- `node scripts/version.mjs --check` passes.
- `pnpm audit:publish-manifests` passes.
- Release staging dry-run/test passes.
- `scripts/cut-release.sh` can no longer silently drop dashboard package version bumps.
- Script diff proves future release commits include package manifests plus `pnpm-lock.yaml` if changed, and no accidental tarballs.

### Phase 1 — Add shared generated-pane vocabulary + diagnostics

Files:

- `plugins/generated-pane/src/shared/index.ts`
- `plugins/generated-pane/src/shared/*.test.ts`
- `plugins/generated-pane/src/front/catalog.tsx`

Tasks:

- [ ] Add `GeneratedPaneDiagnostic` types.
- [ ] Add `baseGeneratedPaneVocabulary`, `GeneratedPaneVocabulary`, and `defineGeneratedPaneVocabulary()`.
- [ ] Define profile/vocabulary merge semantics explicitly: base vocabulary + extension vocabulary, base bindings + extension bindings, extension keys override base keys only when vocabulary and binding are both present.
- [ ] Add `validateGeneratedPaneSpec(value, vocabulary?)` with exact profile rules: omitted profile means `base`; spec profile must match active vocabulary id when an explicit vocabulary is provided; unsupported profile returns `generated-pane.unsupported_profile`; root/graph parse failures return `spec: null`; prop/profile/whole-spec failures return diagnostics with parsed `spec` when possible.
- [ ] Make structural/base parse errors produce structured diagnostics.
- [ ] Make unknown component types produce stable diagnostic codes.
- [ ] Make invalid props produce stable diagnostic codes with element id/path.
- [ ] Keep `parseGeneratedPaneSpec()` as compatibility wrapper, implemented through the structured validator.
- [ ] Update `GeneratedPaneRenderer` to use the same validator instead of a separate ad-hoc path.
- [ ] Keep Phase 1 additive/compat-only: existing profile shape remains accepted and strict binding/vocabulary rejection is not enabled yet.
- [ ] Remove/de-scope action promises from docs/skills/package description and remove action API from the new vocabulary/profile contract; keep any existing legacy action code only as compatibility internals until a separate action plan exists.
- [ ] Memoize expensive renderer setup (`mergeGeneratedPaneProfiles`, catalog, registry, validation) by stable profile/spec inputs.

Acceptance:

- Existing generated-pane tests pass.
- BI dashboard typecheck/build still pass after the generated-pane API change.
- New tests cover invalid root, invalid element graph, unknown component, invalid props, unsupported profile, active-vocabulary/profile mismatch, base vocabulary validation, legacy profile compatibility, explicit action de-scoping, BI diagnostic aggregation, and compatibility `parseGeneratedPaneSpec()`.
- No React imports in generated-pane shared code.

### Phase 2 — Extract BI shared vocabulary and front profile

Files:

- `plugins/bi-dashboard/src/shared/schemas.ts`
- `plugins/bi-dashboard/src/shared/validation.ts`
- `plugins/bi-dashboard/src/front/BiDashboardPane.tsx`
- new `plugins/bi-dashboard/src/front/profile.tsx`
- optional new `plugins/bi-dashboard/src/front/perspective.tsx`
- optional new `plugins/bi-dashboard/src/front/DashboardFiltersBar.tsx`

Tasks:

- [ ] Rename/shape `componentPropsSchemas` into an exported `biDashboardVocabulary` or equivalent shared object.
- [ ] Keep BI-specific diagnostics in shared/server-safe code.
- [ ] Extract render state context into mandatory `plugins/bi-dashboard/src/front/renderContext.tsx`; `BiDashboardPane` owns state/provider, while profile components import only the context hook.
- [ ] Extract `biDashboardGeneratedPaneProfile` into mandatory `plugins/bi-dashboard/src/front/profile.tsx`; it must not import `BiDashboardPane`.
- [ ] Extract Perspective runtime/viewer helpers into mandatory `plugins/bi-dashboard/src/front/perspective.tsx` to avoid dragging viewer lifecycle into the profile shell.
- [ ] Include all actual BI components in inventory: `DashboardGrid`, `BSLMetric`, `BSLChart`, `BSLPerspectiveViewer`, `BSLFilter`, `BSLText`.
- [ ] Export `BiDashboardRenderProvider`, `BiDashboardRenderState`, and `biDashboardGeneratedPaneProfile` from `@hachej/boring-bi-dashboard/front`, so host apps can actually reuse the profile with the required runtime context.
- [ ] After BI migrates to the vocabulary/profile split, enable strict mismatch rejection in `defineGeneratedPaneProfile()` and add tests for binding-without-vocabulary and vocabulary-without-binding diagnostics.

Acceptance:

- `BiDashboardPane.tsx` is shell/orchestration, not the profile owner.
- BI profile is reusable by a host app via the exported provider/runtime-state contract.
- Strict profile/vocabulary mismatch tests pass after BI migration.
- No per-render profile construction.
- BI shared validation imports no React/front code.

### Phase 3a — Shared diagnostic code model

Files:

- `plugins/generated-pane/src/shared/index.ts`
- `plugins/bi-dashboard/src/shared/validation.ts`

Tasks:

- [ ] Export diagnostic code constants/unions for generated-pane and BI.
- [ ] Generated-pane codes must include at least: `generated-pane.invalid_root`, `generated-pane.invalid_elements`, `generated-pane.missing_element`, `generated-pane.element_cycle`, `generated-pane.unknown_component`, `generated-pane.invalid_props`, `generated-pane.unsupported_profile`.
- [ ] BI codes must include at least: `dashboard.schema`, `query.unknown`, `filter.target_unknown`, `chart.category_as_measure`, `chart.category_missing`, `chart.measure_missing`, `perspective.group_field_in_columns`, `layout.controls_top`. Do not emit duplicate `chart.missing_category` / `chart.missing_measure` codes; if needed, keep them only as temporary internal aliases mapped to the canonical `chart.category_missing` / `chart.measure_missing`.
- [ ] Normalize existing string errors into stable diagnostic codes with tests asserting exact codes:
  - generated-pane structural errors
  - generated-pane unknown component
  - generated-pane invalid props
  - `query.unknown`
  - `filter.target_unknown`
  - `dashboard.schema`
  - exact chart/perspective/layout codes listed above
- [ ] Do **not** execute queries inside validate by default. Runtime/query checks should be separate calls to `data.v1.query.run` unless a future explicit `includeRuntimeChecks` option is designed with budgets/capabilities.

Acceptance:

- Shared diagnostic codes are typed and stable.
- Tests assert exact codes for generic and BI static validation cases.

### Phase 3b — BI validate op bridge/capability fix

Files:

- `plugins/bi-dashboard/src/server/index.ts`
- `plugins/bi-dashboard/src/shared/validation.ts`
- `plugins/bi-dashboard/skills/bi-dashboard-authoring/SKILL.md`

Tasks:

- [ ] Before advertising validation workflow in skills, fix BI skill examples to match `dashboardQuerySchema`: SQL queries use `{ id, source, sql, params?, limit? }`, not a fake `language` field or `model/groupBy/measures` shape.
- [ ] Fix this plan and docs examples to use the real schema.
- [ ] Add tests that parse/validate example dashboard JSON files.
- [ ] Add tests or doc checks for skill-embedded JSON examples if practical.
- [ ] Make `bi-dashboard.v1.validate` run generated-pane structured validation with BI vocabulary, BI query manifest validation, and BI whole-spec diagnostics.
- [ ] Replace `as unknown as WorkspaceBridgeHandlerContribution` with `defineTrustedDomainBridgeHandler` plus a small typed contribution adapter, following the ask-user pattern.
- [ ] Remove `{ path }` from `bi-dashboard.v1.validate` and require `{ spec }` until a proper Workspace/file adapter is exposed to server plugins. Skills should read JSON first, then call validation with `{ spec }`.
- [ ] Define exact op contract: caller classes `["browser", "runtime", "server"]`, capability `bi-dashboard:validate`, max input/output sizes, timeout, idempotency, and error mapping.
- [ ] Validation failures return diagnostics in output; handlers should throw only for transport/auth/malformed-request failures.

Acceptance:

- Agent can call `bi-dashboard.v1.validate` with `{ spec }` and get structured, stable diagnostics.
- Validation op does not require `data:read`.
- Server code stays within repo invariants.

### Phase 3c — generated-pane base-only validate op

Files:

- `plugins/generated-pane/src/server/index.ts`
- `plugins/generated-pane/tsup.config.ts`
- `plugins/generated-pane/package.json`
- `plugins/generated-pane/skills/generated-pane-authoring/SKILL.md`

Tasks:

- [ ] Add generic `generated-pane.v1.validate` for absent/`base` profile only; reject non-base profiles with `generated-pane.unsupported_profile` pointing to profile-specific validate ops.
- [ ] Add renderer and validate-op tests for unsupported profile handling.
- [ ] Add server entry in `plugins/generated-pane/tsup.config.ts`, `package.json` `boring.server`, `exports["./server"]`, bridge tests, and publish manifest coverage for that server entry.
- [ ] Define exact op contract: caller classes `["browser", "runtime", "server"]`, capability `generated-pane:validate`, max input/output sizes, timeout, idempotency, and error mapping.
- [ ] Validation failures return diagnostics in output; handlers should throw only for transport/auth/malformed-request failures.

Acceptance:

- Agent can call `generated-pane.v1.validate` for base panes only.
- Generic generated-pane skill accurately describes base-only validation.
- Server/package manifests expose the new server entry cleanly.

### Phase 4 — Final skill/docs wording pass

Files:

- `plugins/generated-pane/skills/generated-pane-authoring/SKILL.md`
- `plugins/bi-dashboard/skills/bi-dashboard-authoring/SKILL.md`
- `plugins/bi-dashboard/example/**/*.dashboard.json`
- tests under generated-pane/bi-dashboard

Tasks:

- [ ] Finalize wording after Phase 1-3 implementation:
  - generated-pane validate op is base-only
  - BI dashboard validate op is BI-profile specific
  - agents read files then call validate with `{ spec }`
- [ ] Update wording:
  - generated-pane = “agent-generated UI runtime”
  - vocabulary = shared allowed component contract
  - profile = front render binding for a vocabulary
  - bi-dashboard = “BI generated-pane profile + data bridge integration”

Acceptance:

- Skills do not contradict implemented validation ops.
- Agent workflow is consistent: generate/read -> validate `{ spec }` -> repair -> open.

### Phase 5 — Release after npm access is fixed

Tasks:

- [ ] Confirm npm token/org access can publish:
  - `@hachej/boring-generated-pane`
  - `@hachej/boring-data-bridge`
  - `@hachej/boring-bi-dashboard`
- [ ] Cut a follow-up release after permissions are fixed.
- [ ] Verify release workflow publishes all packages.
- [ ] Only then update global CLI/restart hub if requested by release procedure.

Acceptance:

- npm shows aligned published versions for all publishable packages.
- Release workflow completes successfully.

## Loop-plan workflow

Use before coding:

1. Read current implementation:
   - `plugins/generated-pane/src/front/catalog.tsx`
   - `plugins/generated-pane/src/shared/index.ts`
   - `plugins/bi-dashboard/src/front/BiDashboardPane.tsx`
   - `plugins/bi-dashboard/src/shared/schemas.ts`
   - `plugins/bi-dashboard/src/shared/validation.ts`
   - `plugins/bi-dashboard/src/server/index.ts`
   - `plugins/bi-dashboard/skills/bi-dashboard-authoring/SKILL.md`
   - `plugins/generated-pane/skills/generated-pane-authoring/SKILL.md`
2. Update this plan with exact file changes only; delete already-shipped checkboxes.
3. Run strict review.
4. Integrate revisions that reduce API surface or improve package boundaries.
5. Stop planning when:
   - vocabulary/profile split is explicit
   - validation ownership is server-safe
   - profile resolution is intentionally not global
   - examples match schemas
   - release hazards are front-loaded

## Loop-implement workflow

Use after the plan is accepted:

1. Implement one phase at a time.
2. After each phase, run focused checks:
   - `pnpm --filter @hachej/boring-generated-pane typecheck`
   - `pnpm --filter @hachej/boring-generated-pane test`
   - `pnpm --filter @hachej/boring-generated-pane build`
   - `pnpm --filter @hachej/boring-bi-dashboard typecheck`
   - `pnpm --filter @hachej/boring-bi-dashboard test`
   - `pnpm --filter @hachej/boring-bi-dashboard build`
   - `pnpm audit:publish-manifests`
   - `pnpm audit:imports` for import-boundary changes
   - `pnpm lint:workspace-plugin-invariants` for plugin manifest/API changes
   - `pnpm lint:invariants` before final merge or broad shared/server/front boundary changes
3. Run strict review after non-trivial refactors.
4. Repair findings immediately.
5. Do not merge until:
   - shared vocabulary is React-free
   - front profile is explicit and exported
   - generated-pane validation is structured
   - BI validation uses stable codes
   - skills/examples validate
   - release scripts stage all publishable package manifests

## Closed decisions

1. `generated-pane.v1.validate` is planned in Phase 3c, and only validates absent/`base` profile specs.
2. `bi-dashboard.v1.validate` owns `profile: "bi-dashboard"` specs.
3. Runtime/query diagnostics are not part of validation. Agents can call `data.v1.query.run` separately for runtime proof.
4. generated-pane exposes a tiny `baseGeneratedPaneVocabulary`; no arbitrary React.
5. There is no global profile registry in this plan. File routing stays with surface resolvers.

## Success criteria

- An agent can generate a profile-backed pane without knowing React.
- BI dashboard is clearly “generated-pane vocabulary/profile + BI components + data bridge”.
- Custom apps can add profile components without forking the renderer.
- Validation feedback is structured and repairable by agents.
- Server validation does not import React/front code.
- Release can publish the whole generated-pane/dashboard stack together once npm permissions are fixed.
