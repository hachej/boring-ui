> **Status: historical snapshot/evidence; non-dispatchable.**
> Decision 28 and `docs/issues/391/plan.md` govern current sequencing. This file
> cannot dispatch work; any retained idea requires explicit adoption by the
> active child plan and Decision 28 Bead graph.

# TODO-02 — `@hachej/boring-bash` package and providers

## Purpose

Create the optional files/bash working-environment package after dependency inversion is safe. It owns providers, source-of-truth rules, file/search/watch abstractions, and provider capability facts.

This TODO is self-contained for the package/provider slice. It embeds the key architectural reasons:

- `@hachej/boring-agent` must remain usable with no filesystem, no sandbox, no cwd, and no bash.
- `@hachej/boring-agent` must not value-import `@hachej/boring-bash`.
- `@hachej/boring-bash` owns concrete working-environment providers and provider capability facts.
- Host/core/CLI composition wires agent + optional boring-bash together.
- Provider labels are not enough: each provider must declare real capabilities such as fs mode, exec, real Bash, real binaries, network isolation, persistence/source-of-truth, watch/search, and provisioning support.
- When boring-bash is active, file API/search/watch/bash/git/status must share one source of truth. No file/bash split brain.
- `direct` is trusted host mode, not isolation. `local` mode maps to a `bwrap` provider. `vercel-sandbox` and `remote-worker` are remote/provider-backed modes with different lifecycle and provisioning semantics.

## Beads / tasks

### BBA-020 — Create package skeleton and exports

**Depends on:** BBA-012, BBA-000.

**Scope:**

- Add `packages/boring-bash` with exact package name `@hachej/boring-bash`.
- Add package build plumbing: `package.json`, tsup config, tsconfig/build integration, workspace package registration, docs README, and export map.
- Exports:
  - `/shared` for types only safe for front/shared;
  - `/server` for server-only routes/env builders;
  - `/agent` for agent feature/tool factories;
  - `/plugin` for front plugin composition;
  - `/providers` for concrete provider adapters.
- `/shared` must not import server/provider/front implementation code.
- `/shared` must obey project shared-code invariants: no `node:*`, no `Buffer`; use `Uint8Array` for bytes.
- Do not add value imports from `@hachej/boring-agent` into shared/front code unless they are explicitly type-only and safe.
- Document intended import direction:
  - host/core/CLI may import both agent and boring-bash;
  - boring-bash may expose agent integration factories from `/agent`;
  - agent must not import boring-bash values.

**Tests/proof:**

- Typecheck package.
- Package build emits expected subpaths.
- Export-map test imports `/shared`, `/server`, `/agent`, `/plugin`, and `/providers` from a small fixture.
- Shared-import invariant: `/shared` import graph does not pull server/provider/front code, `node:*`, or `Buffer`.
- A minimal host fixture can import agent + boring-bash together without a package cycle.

**E2E/smoke logging:**

- Add a package smoke script that logs package version, resolved export subpaths, and whether each subpath is front-safe/server-only/provider-only.

**Acceptance:** `@hachej/boring-bash` exists as a buildable package with safe subpath boundaries and no agent↔bash value cycle.

### BBA-021 — Define mode/provider capability contracts

**Depends on:** BBA-020, BBA-003, BBA-006.

**Scope:**

- Define provider capability types for:
  - fs mode: `none | readonly | readwrite`;
  - exec availability;
  - real Bash availability;
  - real binary/toolchain availability;
  - network isolation level;
  - watch/search support;
  - persistence/source-of-truth model;
  - provisioning adapter support;
  - path namespace semantics (`/workspace`, direct host path, remote runtime cwd, readonly facade);
  - provider contract version.
- Encode mode/provider mapping:
  - `direct` mode → `direct` provider;
  - `local` mode → `bwrap` provider;
  - `vercel-sandbox` mode → `vercel-sandbox` provider;
  - remote-worker adapter → `remote-worker` provider;
  - pure/headless → `none` provider/no boring-bash;
  - readonly facade → fs/search/watch without exec.
- Add stable error codes for unsupported provider requirements and unsafe fallback attempts.
- Add policy rule: provider fallback is never automatic if it reduces isolation/capability. Fallback must be host-policy-approved and logged.
- Include provider diagnostics shape that can be surfaced to readiness/UI/plugin diagnostics without leaking host paths or secrets.

**Unit tests:**

- Mapping table tests for every current mode/provider pair.
- Provider capability validation tests.
- Unsupported requirement returns stable error code.
- Unsafe fallback fails closed.
- `local`/`bwrap` distinction is preserved.
- Provider diagnostics redact host paths/secrets where required.

**E2E logging:**

- Provider handshake/smoke logs mode, provider, provider contract version, fs mode, exec, realBash, realBinaries, networkIsolation, sourceOfTruth, workspace id, agent id, and decision/error code.

**Acceptance:** Hosts and plugins can decide whether a provider satisfies a requirement without guessing from a provider name.

### BBA-022 — Move concrete provider adapters after injection

**Depends on:** BBA-020, BBA-021, BBA-012, BBA-006.

**Scope:**

- Move direct, bwrap/local, and vercel-sandbox provider implementations to `boring-bash/providers` after Phase 1 dependency injection is complete.
- Remote-worker client/provider movement is coordinated in BBA-024 because it has a separate client/server/protocol split.
- Implement readonly facade in v1 unless BBA-006 explicitly defers it; if deferred, gate all readonly tests/features as v2.
- Ensure `none` and `readonly` short-circuit the closed provisioning adapter mode union instead of failing it.
- Do not add value re-exports from old agent paths to moved boring-bash providers/tools/routes; that would violate the no agent→bash value import invariant.
- Type-only runtime adapter contracts may remain temporarily in agent; concrete `resolveMode()` and concrete adapters move to host/boring-bash composition.
- Any value compatibility shim must live outside `@hachej/boring-agent` in host/composition packages, or users must migrate imports to `@hachej/boring-bash`.
- Preserve existing direct/local/vercel behavior and tests.
- Preserve path-safety ownership: provider/adapters validate containment; routes/tools do not accept raw unchecked host paths.

**Unit tests:**

- Old type-only import paths work where explicitly allowed, or produce clear migration errors.
- New provider imports work.
- Readonly facade exposes fs/search/watch and no exec when enabled by BBA-006.
- `none` and `readonly` do not call provisioning adapters unless explicitly configured.
- Direct/local/vercel provider tests still pass after import move.
- Agent package has no value import from boring-bash.
- Provider adapters still reject path escapes at the adapter boundary.

**E2E logging:**

- Start direct/local/vercel smoke where possible; log old/new import path compatibility decision, mode, provider id, runtime cwd, workspace id, agent id, sourceOfTruth, and provider diagnostics.

**Acceptance:** Concrete non-remote-worker providers live under boring-bash without breaking current runtime behavior or agent package boundaries.

### BBA-023 — Implement provider-level one-namespace source-of-truth tests

**Depends on:** BBA-021, BBA-022.

**Scope:**

- Add provider-level tests that prove workspace/provider API writes are visible to sandbox exec and sandbox-created files are visible to workspace/provider API/search for each provider that claims fs+exec.
- Test readonly facade exposes provider fs/search/watch without exec.
- Test denied partial file is not physically present inside the provider view when exec is enabled.
- Ensure storage-primary and sandbox-primary modes report their source-of-truth model clearly; detailed implementation of `sourceOfTruth` metadata is owned by BBA-037.
- Do not include route-level file/git assertions here; those live in BBA-026 after routes move.

**Unit/e2e:**

- Provider unit tests for direct, bwrap/local, vercel-sandbox, and remote-worker mock.
- Readonly facade unit tests.
- `none` provider unit tests proving no fs/exec/watch/search capabilities.
- Smoke script with detailed logs:
  - provider;
  - provider contract version;
  - sourceOfTruth;
  - workspace/provider root;
  - runtime cwd;
  - file path;
  - operation id;
  - provider API path used;
  - stdout/stderr;
  - assertion summary.

**Acceptance:** No provider can claim fs+exec support while splitting provider file API and provider exec roots.

### BBA-026 — Add route-level source-of-truth regression tests after routes move

**Depends on:** BBA-030, BBA-037.

**Scope:**

- Add route-level tests, after BBA-030 moves routes, proving file route writes are visible to bash and bash-created files are visible to file routes/search.
- Test git/status routes use the same source as file routes and bash.
- Test file tree/search/watch/UI roots agree with route/bash source-of-truth metadata from BBA-037.
- Do not duplicate provider-level assertions from BBA-023; this bead covers route/tool/UI integration.

**Unit/e2e:**

- Route integration tests for file write ↔ bash read, bash write ↔ file route read/search, git/status root equality.
- Smoke script with detailed logs:
  - route path;
  - provider;
  - sourceOfTruth;
  - git root;
  - file API root;
  - runtime cwd;
  - operation id;
  - assertion summary.

**Acceptance:** Moved routes cannot regress into host-file-tree vs remote-bash split brain.

### BBA-024 — Clarify and split remote-worker client/server ownership

**Depends on:** BBA-020, BBA-021, BBA-022.

**Scope:**

- Move shared remote-worker protocol/types to `boring-bash/shared`.
- Move remote-worker client/provider adapter to `boring-bash/providers/remote-worker`.
- Decide whether full-app worker server stays app-owned or moves to `boring-bash/server/remote-worker`.
- Worker server must not depend on agent core.
- Widen or short-circuit provisioning adapter mode union for remote-worker/readonly/none.
- Add remote-worker provider handshake that reports capability matrix and hardening facts needed by BBA-046.
- Preserve protocol compatibility with existing full-app worker routes during migration.

**Tests:**

- Protocol compatibility unit tests.
- Worker handshake reports provider capability matrix.
- Handshake rejects missing/unknown contract version with stable error.
- Fail closed when required hardening or source-of-truth claims are missing.
- Full-app worker server import graph has no agent-core dependency after split.

**E2E logging:**

- Remote-worker smoke logs worker version, protocol version, isolation claims, provider matrix, workspace id, agent id, sourceOfTruth, network policy result, and fail-closed reason when blocked.

**Acceptance:** Remote-worker can be provided by boring-bash without coupling the worker server to agent core or hiding isolation/source-of-truth uncertainty.

### BBA-025 — Preserve type compatibility and migration docs without cycles

**Depends on:** BBA-022, BBA-024.

**Scope:**

- Preserve only type-only old-path exports from `@hachej/boring-agent` where they do not create runtime imports.
- Do not re-export moved boring-bash values from agent old paths.
- If a value compatibility shim is required, place it in host/composition packages that already depend on both agent and boring-bash, not in agent.
- Document migration windows and required import changes.
- Add changelog notes and migration snippets for app authors.
- Include examples for direct/local/vercel/remote-worker provider imports and readonly/none usage.

**Tests:**

- Compile current apps after migrating value imports or using host-level shims.
- Compile sample using new `@hachej/boring-bash` imports.
- Static test proves agent old paths have no value import from boring-bash.
- Static test proves workspace↔boring-bash plugin imports stay acyclic when host-level shims are used.
- Migration docs links and code snippets typecheck where possible.

**Acceptance:** No package cycle and no silent public API break: users either get working host-level compatibility or clear migration diagnostics.
