# Slice 4 proof — fenced durable sandbox handles

Bead: `factory-plugin-owner-runtime-identity-prefix-8pdn.4`

The Core contract keys disposable provider handles by host scope, workspace,
provider, and application-owned mode. The encrypted payload is generation-bound;
lease ownership is opaque and all ordinary mutations compare generation/token
and require an unexpired lease. Takeover increments generation. Cleanup failure
or ambiguity remains durable; deletion requires a recorded successful outcome or
the explicitly named operator reconciliation method.

The migration deliberately contains no EFS path, namespace, mount, or deletion
field. Shared EFS data is not part of the disposable handle lifecycle.

## Deterministic proof

`FencedSandboxHandleStore.test.ts` uses two independently-created store adapters
against one serializable backend. It covers concurrent claim, restart, expiry
takeover, stale renew/update/release/delete, ambiguous create, cleanup failure and
debt, provider/mode isolation, ciphertext-at-rest/AAD replay rejection, and
privileged reconciliation/rollback behavior.

Commands:

- `pnpm --filter @hachej/boring-core exec vitest run src/server/runtime/__tests__/FencedSandboxHandleStore.test.ts src/server/runtime/__tests__/WorkspaceRuntimeSandboxHandleStore.test.ts --no-file-parallelism` — 2 files, 9 tests passed.
- `pnpm --filter @hachej/boring-core typecheck` — blocked by pre-existing missing built Agent declarations in this worktree; no diagnostic referenced this slice.
- `pnpm lint:invariants` — Agent and boring-bash phases passed before the 180-second command budget expired.
