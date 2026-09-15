# Slice 4 proof — fenced durable sandbox handles

Bead: `factory-plugin-owner-runtime-identity-prefix-8pdn.4`

The Core contract keys disposable provider handles by host scope, workspace,
provider, and application-owned mode. The encrypted payload is generation-bound;
lease ownership is opaque and all ordinary mutations compare generation/token
and require an unexpired lease. Shared EFS paths, namespaces, mounts, and data are
not represented or deleted by this lifecycle.

## Provider and host capabilities

`FencedSandboxHandleStore` is the provider-facing contract. It has no operational
`get` or reconciliation method. A successful `claim` is the only operation that
returns a lease token or decrypted handle; `renew`, `update`, `release`, and
`delete` return status only. A restarted process must wait for lease expiry and
claim. Redacted host inspection is available only from the separate
`FencedSandboxHandleAdmin` capability and reports neither token nor handle.

`beginCreate` atomically persists a provider idempotency key and `started` state
before returning the key for an external create call. The initial encrypted
handle update is rejected unless that attempt exists, and the same update marks
it `completed`. If a process stops after provider success but before the handle
update, every takeover returns `create-ambiguous`, without a lease token or
handle. It remains blocked until an operator certifies provider absence through
the host-only reconciliation capability.

Successful ordinary deletion atomically records the cleanup-success receipt and
turns the row into a tombstone. It clears the encrypted handle, encryption
metadata, create attempt, and lease, but retains the discriminator and
generation. Claiming the tombstone recreates generation 1 as generation 2, so
old ciphertext cannot be replayed under the new generation-bound AAD. Failed or
ambiguous cleanup remains durable without tombstoning.

The explicit host administrator requires non-empty audit ID, operator identity,
evidence detail, and timestamp. Reconciliation writes an immutable audit row in
the same transaction. An active lease is refused and audited unless the caller
passes the explicit `allowActiveLease` policy. Provider closures receive only
the ordinary interface; the administrator is a separately constructed object.

## Packaging and migration

The main `@hachej/boring-core/server` entry exports only the fenced-handle type
contracts. The concrete `PostgresFencedSandboxHandleStore`, separate
`PostgresFencedSandboxHandleAdmin`, and cipher constructor are exported from the
Node-only `@hachej/boring-core/server/db` subpath. The in-memory deterministic
fixture is not in a package export. The db entry is built independently so its
concrete adapter does not inflate the main server shared chunk.

Migration `0029_fenced_sandbox_handles.sql` uses exact `CREATE TABLE` statements
(no `IF NOT EXISTS`) for the handle and immutable audit tables. The migration
smoke applies it in a fresh isolated schema, proves a representative pre-existing
old-code table still reads/writes after upgrade, and proves a second accidental
application fails with PostgreSQL duplicate-table error. The migration and
schema contain no EFS ownership fields.

## Verification

- `pnpm --filter @hachej/boring-core exec vitest run src/server/runtime/__tests__/PostgresFencedSandboxHandleStore.test.ts src/server/runtime/__tests__/FencedSandboxHandleStore.test.ts src/server/db/__tests__/fencedSandboxHandles.migration.test.ts src/server/runtime/__tests__/WorkspaceRuntimeSandboxHandleStore.test.ts --no-file-parallelism` — passed: 4 files, 15 tests, including two independent real Postgres connections, crash ambiguity, tombstone generation 1→2, old-ciphertext replay rejection, audited active-lease refusal, fresh migration, and rollback compatibility smoke.
- `pnpm --filter @hachej/boring-core typecheck` — passed.
- `pnpm --filter @hachej/boring-agent typecheck` — passed.
- `pnpm --filter @hachej/boring-core build` — passed, including declaration output and package artifact assertions.
- `pnpm --filter @hachej/boring-core check:bundle-size` — passed; main server is 75.07 KB gzip (+3.0% against baseline, below the 10% budget).
- `pnpm lint:invariants` — passed all Agent, boring-bash, boring-sandbox, Workspace plugin, alignment, and skill-digest phases.
