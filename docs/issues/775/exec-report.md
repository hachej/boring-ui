# #775 execution report — host-owned native Pi sessions

Date: 2026-07-25  
Branch: `integrate/775-pr811-final`  
Starting commit: `8d1beacbf`

## Outcome

Implemented the plan's opt-in-everywhere native Pi session capability and
full-app user isolation seam. Both public composition entry points default
closed, trusted first-party hosts explicitly opt in, generic core/workspace
helpers only pass through explicit true, and the full-app MCP binding rejects
missing user identity instead of falling back to `anonymous`.

## Changes

### Capability ownership

- Removed runtime-mode-derived native session gating and its obsolete helper.
- Added `nativeSessionStartEnabled?: boolean` to `createAgentApp` and
  `registerAgentRoutes`.
- Both entry points enable native session start only for
  `nativeSessionStartEnabled === true`.
- Kept native session storage and first-send behavior unchanged.

### First-party call-site inventory

Explicit trusted-host opt-ins are covered by a source contract test:

- Agent app hosts:
  - `apps/agent-playground/src/server/index.ts`
  - `packages/agent/src/bin/boring-agent.ts`
  - `packages/agent/src/server/dev.ts`
  - the agent example, eval, provisioning, and capability-readiness scripts
- Workspace hosts:
  - workspace playground server, eval, and bridge E2E
  - both CLI folder and registered-workspace compositions
- Full-app hosts:
  - production server, dev server, and remote-worker smoke composition
  - frontend native-first capability prop
- Plugin playground/eval hosts:
  - BI dashboard server/eval
  - generated-pane eval

Generic exported composition remains disabled by default:

- `createWorkspaceAgentServer` passes through only explicit true.
- `createCoreWorkspaceAgentServer` passes through only explicit true.
- Generic core `runServer` and `devServer` do not opt in.

### Verified-user isolation

`plugins/boring-mcp/src/server/appServerBinding.ts` now:

- accepts identity only from the trusted dispatcher context or authenticated
  HTTP request;
- preserves the existing workspace segment;
- hashes the verified user ID into the namespace;
- throws stable `401 unauthorized` when no identity is available.

The full-app isolation test uses one session root, creates a native transcript
for user A, and proves user B sees an empty list and receives non-disclosing
not-found for user A's known native ID.

### Tests

- Default-disabled and explicit-enabled route tests cover direct, local, and
  representative remote/custom adapters.
- First-party host source contract enumerates all intentional opt-ins and
  generic opt-outs.
- MCP binding tests cover HTTP/dispatcher namespace equality, user/workspace
  separation, and missing-identity rejection.
- Full-app integration covers the cross-user native list/load boundary.
- Workspace and core composition tests cover false-by-default and explicit
  capability pass-through.

## Proof results

Required commands:

| Command | Result |
| --- | --- |
| `pnpm --filter @hachej/boring-agent test` | Environment-blocked: 137 files and 1,514 tests passed; failures require denied loopback/process capabilities, unavailable home storage, or hit the unrelated installed React patch mismatch |
| `pnpm --filter @hachej/boring-agent typecheck` | Baseline-blocked by unchanged Vite plugin-array TS2321 at `src/bin/boring-agent.ts:90` |
| `pnpm --filter @hachej/boring-agent build` | Passed, including declarations and artifact assertion |
| `pnpm --filter full-app test` | Passed: 5 files, 46 tests |
| `pnpm lint:invariants` | Passed |

Focused evidence:

- Agent route/default/host-wiring seams: 3 files, 102 tests passed.
- Boring MCP namespace guard: 1 file, 11 tests passed.
- Workspace composition: 1 file, 31 tests passed.
- Core composition: 1 file, 6 tests passed.
- `git diff --check`: passed.

Detailed sanitized evidence and residual manual proof items are recorded in
`docs/issues/775/proof.md`.

## Review

- Tier 1 fresh-eyes: clean.
- Tier 2 initially requested two corrections: remove unsafe generic core
  opt-ins and strengthen the source contract test.
- Both findings were fixed; Tier 2 re-review was clean.

## Residual proof

Manual remote-worker adoption, two-user deployed-host validation, and
standalone Pi resume could not run in this sandbox. The environment denies
loopback binding and does not supply the required deployed identities, remote
worker, or standalone Pi runtime.

## Commit blocker

The requested logical commits could not be created because this worktree's Git
metadata is mounted read-only. `git add apps packages plugins` failed while
creating the parent checkout's `index.lock`. No push was attempted.

The working tree is ready to commit once Git metadata is writable. Keep the
pre-existing `docs/issues/775/plan.md` modification out of the issue commits.
