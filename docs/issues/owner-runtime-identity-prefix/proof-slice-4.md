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

## Production adapter and host seam

`PostgresFencedSandboxHandleStore` is the production implementation. Claim uses
a Postgres transaction, a discriminator-row `SELECT ... FOR UPDATE`, and a
conditional generation/expiry update. Renew, update, and release use one
conditional statement; delete first conditionally records cleanup under the
same generation/token/unexpired fence and deletes only a successful outcome in
the same transaction. The privileged reconciliation method likewise records
its operator outcome before delete. This makes the database row lock and
conditional SQL—not process-local state—the concurrency authority.

The adapter uses the reference AES-256-GCM `SandboxHandleCipher`. AAD includes
host scope, workspace, provider, mode, generation, handle version, and encryption
version. A takeover decrypts and re-encrypts the opaque handle for its incremented
generation. The plaintext is never stored.

The adapter is exported from `@hachej/boring-core/server` for an application
provider closure to consume. Per the slice-3 seam ruling, that closure is
injected only through `createCoreWorkspaceAgentServer({ runtimeModeAdapter })`;
no handle fields were added to Agent provider/runtime contracts and Core does
not select a custom store from a mode string. The existing
`SandboxHandleStore` option and `WorkspaceRuntimeSandboxHandleStore` behavior
are unchanged.

## Postgres integration proof

`PostgresFencedSandboxHandleStore.test.ts` runs against real Postgres using two
independent `postgres` clients and independently constructed store adapters. It
covers simultaneous claim, adapter restart, expiry takeover, generation
increment, stale renew/update/release/delete, provider/mode isolation, AAD replay
rejection, cleanup ambiguity/failure debt, successful cleanup deletion, and raw
ciphertext/nonce/tag/version assertions at rest.

The in-memory reference suite remains as a deterministic protocol proof and now
also rejects handle-version AAD replay. It is not cited as production database
evidence.

Commands:

- `pnpm --filter @hachej/boring-agent build` — passed; Agent JavaScript and declaration outputs built and artifact assertions passed.
- `pnpm --filter @hachej/boring-core typecheck` — passed.
- `pnpm --filter @hachej/boring-core exec vitest run src/server/runtime/__tests__/PostgresFencedSandboxHandleStore.test.ts src/server/runtime/__tests__/FencedSandboxHandleStore.test.ts src/server/runtime/__tests__/WorkspaceRuntimeSandboxHandleStore.test.ts --no-file-parallelism` — 3 files, 12 tests passed, including the real Postgres suite.
- `pnpm lint:invariants` — passed all Agent, boring-bash, boring-sandbox, Workspace plugin, alignment, and skill-digest phases.
