# Plan: generated-pane profiles + BI dashboard profile cleanup

## Goal

Make `@hachej/boring-generated-pane` the first-class agent-generated UI runtime, and make `@hachej/boring-bi-dashboard` a clean BI profile/plugin built on top of it.

This is a **gap-closure plan**, not a greenfield plan. The branch already has a working generated-pane renderer, a BI dashboard profile inside `BiDashboardPane.tsx`, `bi-dashboard.v1.validate`, Arrow-backed Perspective rendering, and release-list coverage in most scripts. The remaining work is to make the architecture explicit, remove drift, and make validation/skills/release behavior consistent.

## Target mental model

- `generated-pane` = generic engine/runtime.
- `vocabulary` = React-free shared contract: allowed component types, prop schemas, descriptions, slots, and static diagnostics.
- `profile` = front-end binding: a vocabulary plus React components/actions for rendering.
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
| API sketch conflicted with existing actions/renderer | Closed: actions are preserved; `GeneratedPaneRenderer` remains the only render entrypoint. |
| Examples drift from schemas | Open work item in Phase 4 with validation tests. |
| `queries` contradiction | Closed: `queries` is generic opaque manifest in base contract. |
| validate op raw path / casts | Open work item in Phase 3; must be fixed, not deferred. |
| BI file too broad | Open work item in Phase 2 with concrete extraction targets. |
| Generic validate-loop promise | Closed: generated-pane ships `generated-pane.v1.validate` for base/absent profile only; profile plugins own profile-specific validate ops. |
| Release hazards | Open work item in Phase 0; must land before API refactor release. |

Real remaining gaps:

1. No React-free `GeneratedPaneVocabulary` abstraction.
2. No generic structured diagnostics API in generated-pane shared code.
3. `GeneratedPaneRenderer` still rebuilds merged profile/catalog/registry and validates on every render.
4. BI profile is still embedded in `BiDashboardPane.tsx` instead of exported as an explicit profile binding.
5. BI shared schemas are not presented as a named vocabulary.
6. Validation returns mixed string errors and structured diagnostics; generic/profile error codes are not normalized.
7. `bi-dashboard.v1.validate` hand-rolls handler registration and raw path resolution.
8. Generic generated-pane skill cannot honestly require a WorkspaceBridge validate loop unless generated-pane ships a server op.
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

If a generic pane declares an unknown non-base profile, generated-pane should report a diagnostic explaining that profile-specific validation belongs to the owning plugin. `generated-pane.v1.validate` validates only `profile` absent/`base`. `bi-dashboard.v1.validate` validates `profile: "bi-dashboard"`. A future cross-plugin profile registry would require a workspace plugin contribution point and deserves its own plan.

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
- Generic `generated-pane.v1.validate` op for `*.pane.json` validate/repair workflows when `profile` is absent or `base`.

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
- Keep diagnostics whole-spec for now. Per-component diagnostics are speculative and not needed by current BI cases.
- Keep compatibility wrappers such as `parseGeneratedPaneSpec()` if already exported, but implement them through the new structured validator.

### Front profile API

In `plugins/generated-pane/src/front/catalog.tsx`:

```ts
export interface GeneratedPaneComponentBinding {
  component: React.ComponentType<GeneratedPaneComponentProps>
}

export interface GeneratedPaneProfile {
  vocabulary: GeneratedPaneVocabulary
  components: Record<string, GeneratedPaneComponentBinding>
  actions?: Record<string, GeneratedPaneActionDefinition>
}
```

Notes:

- Preserve existing `actions`; do not regress the published generic `Button` action surface.
- `GeneratedPaneRenderer` remains the render entrypoint; do not add a duplicate `renderGeneratedPane()` function.
- Component metadata lives in `vocabulary.components`; front `profile.components` are render bindings only.
- `defineGeneratedPaneProfile()` must reject render bindings without matching vocabulary entries, and tests must cover this.
- Memoize merged profile/catalog/registry/validation where appropriate.

## Implementation phases

### Phase 0 — Release hazard cleanup first

This phase is independent of the API refactor and should land first.

- [ ] Confirm owner/Kanzen release authorization before any direct push to `main`; release script is the only allowed direct-main path here.
- [ ] Prepare release from clean `main` or an isolated clean release worktree aligned with `origin/main`.
- [ ] Verify `scripts/cut-release.sh` stages all publishable package manifests, including:
  - `plugins/generated-pane/package.json`
  - `plugins/data-bridge/package.json`
  - `plugins/bi-dashboard/package.json`
- [ ] Verify/fix root `release:patch`, `release:minor`, `release:major` scripts. They currently reference `scripts/release.mjs`; either provide that script or point them at the real release path.
- [ ] Add/verify a `*.tgz` ignore rule if generated package tarballs are expected locally.
- [ ] Ensure `pnpm-lock.yaml` is staged when versioning changes it.
- [ ] Add release dirty-tree proof: before commit/tag, `git status --short` must contain only intended release files and no untracked tarballs.
- [ ] Keep npm access/package-permission work as an explicit ops precondition before release.

Acceptance:

- `node scripts/version.mjs --check` passes after a version bump.
- `pnpm audit:publish-manifests` passes.
- `scripts/cut-release.sh` can no longer silently drop dashboard package version bumps.
- Release commit includes package manifests plus `pnpm-lock.yaml` if changed, and no accidental tarballs.

### Phase 1 — Add shared generated-pane vocabulary + diagnostics

Files:

- `plugins/generated-pane/src/shared/index.ts`
- `plugins/generated-pane/src/shared/*.test.ts`
- `plugins/generated-pane/src/front/catalog.tsx`

Tasks:

- [ ] Add `GeneratedPaneDiagnostic` types.
- [ ] Add `GeneratedPaneVocabulary` and `defineGeneratedPaneVocabulary()`.
- [ ] Add `validateGeneratedPaneSpec(value, vocabulary?)`.
- [ ] Make structural/base parse errors produce structured diagnostics.
- [ ] Make unknown component types produce stable diagnostic codes.
- [ ] Make invalid props produce stable diagnostic codes with element id/path.
- [ ] Keep `parseGeneratedPaneSpec()` as compatibility wrapper, implemented through the structured validator.
- [ ] Update `GeneratedPaneRenderer` to use the same validator instead of a separate ad-hoc path.
- [ ] Keep Phase 1 additive/compat-only: existing profile shape remains accepted and strict binding/vocabulary rejection is not enabled yet.
- [ ] Memoize expensive renderer setup (`mergeGeneratedPaneProfiles`, catalog, registry, validation) by stable profile/spec inputs.

Acceptance:

- Existing generated-pane tests pass.
- BI dashboard typecheck/build still pass after the generated-pane API change.
- New tests cover unknown component, invalid props, binding-without-vocabulary rejection, and compatibility `parseGeneratedPaneSpec()`.
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
- [ ] Export `biDashboardGeneratedPaneProfile` from `@hachej/boring-bi-dashboard/front`.

Acceptance:

- `BiDashboardPane.tsx` is shell/orchestration, not the profile owner.
- BI profile is reusable by a host app.
- No per-render profile construction.
- BI shared validation imports no React/front code.

### Phase 3 — Normalize validation and bridge ops

Files:

- `plugins/bi-dashboard/src/shared/validation.ts`
- `plugins/bi-dashboard/src/server/index.ts`
- generated-pane server files if adding generic op

Tasks:

- [ ] Make `bi-dashboard.v1.validate` run:
  1. generated-pane structured validation with BI vocabulary
  2. BI query manifest validation
  3. BI whole-spec diagnostics
- [ ] Export diagnostic code constants/unions for generated-pane and BI.
- [ ] Normalize existing string errors into stable diagnostic codes with tests asserting exact codes:
  - generated-pane structural errors
  - generated-pane unknown component
  - generated-pane invalid props
  - `query.unknown`
  - `filter.target_unknown`
  - `dashboard.schema`
  - existing chart/perspective codes
- [ ] Do **not** execute queries inside validate by default. Runtime/query checks should be separate calls to `data.v1.query.run` unless a future explicit `includeRuntimeChecks` option is designed with budgets/capabilities.
- [ ] Before advertising validation workflow in skills, fix BI skill examples to match `dashboardQuerySchema`: SQL queries use `{ id, source, sql, params?, limit? }`, not a fake `language` field or `model/groupBy/measures` shape.
- [ ] Fix this plan and docs examples to use the real schema.
- [ ] Add tests that parse/validate example dashboard JSON files.
- [ ] Add tests or doc checks for skill-embedded JSON examples if practical.
- [ ] Replace `as unknown as WorkspaceBridgeHandlerContribution` with `defineTrustedDomainBridgeHandler` plus a small typed contribution adapter, following the ask-user pattern.
- [ ] Remove `{ path }` from `bi-dashboard.v1.validate` and require `{ spec }` until a proper Workspace/file adapter is exposed to server plugins. Skills should read JSON first, then call validation with `{ spec }`.
- [ ] Add generic `generated-pane.v1.validate` for absent/`base` profile only; reject non-base profiles with a diagnostic pointing to profile-specific validate ops.
- [ ] Add `plugins/generated-pane/src/server/index.ts`, a server entry in `plugins/generated-pane/tsup.config.ts`, `package.json` `boring.server`, `exports["./server"]`, bridge tests, and publish manifest coverage for that server entry.
- [ ] Define exact validation op contracts: caller classes `["browser", "runtime", "server"]`, minimal capability `generated-pane:validate` / `bi-dashboard:validate` (or an explicit empty-capability rationale), max input/output sizes, timeout, idempotency, and error mapping.
- [ ] Validation failures return diagnostics in output; handlers should throw only for transport/auth/malformed-request failures.

Acceptance:

- Agent can call `bi-dashboard.v1.validate` with `{ spec }` and get structured, stable diagnostics.
- Agent can call `generated-pane.v1.validate` for base panes only.
- Validation ops do not require `data:read`.
- Server code stays within repo invariants.

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

1. `generated-pane.v1.validate` ships, but only validates absent/`base` profile specs.
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
