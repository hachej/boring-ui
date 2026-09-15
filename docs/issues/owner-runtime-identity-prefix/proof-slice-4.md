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
evidence detail, and timestamp. Ordinary reconciliation always refuses and
audits an active lease; there is no policy flag that weakens this rule. The
exceptional force capability is a separately constructed host-only object. Its
methods require `expectedGeneration`, and the PostgreSQL `SELECT ... FOR UPDATE`
and mutation predicates both match that exact generation. Evidence gathered for
generation 1 therefore cannot mutate or audit generation 2. Provider closures
receive only the ordinary interface.

## Packaging and migration

The main `@hachej/boring-core/server` entry exports only the fenced-handle type
contracts. The concrete `PostgresFencedSandboxHandleStore`, separate
`PostgresFencedSandboxHandleAdmin`, and cipher constructor are exported from the
Node-only `@hachej/boring-core/server/db` subpath. The in-memory deterministic
fixture is not in a package export. The db entry is built independently so its
concrete adapter does not inflate the main server shared chunk. Normal builds
serialize the main and db tsup configs, clean `dist` only in the first config,
and then assert every runtime and `exports.types` target. The only no-DTS flow
is the explicit Docker build, which serializes the same configs and runs the
runtime-only assertion. A packed-package smoke compiles a strict TypeScript
consumer of `@hachej/boring-core/server/db`.

Migration `0029_fenced_sandbox_handles.sql` uses exact `CREATE TABLE` statements
(no `IF NOT EXISTS`) for the handle and immutable audit tables. The compatibility
smoke constructs the actual 0028 base-revision tables, applies migrations 0028
and 0029, and uses the pre-0029 `WorkspaceRuntimeSandboxHandleStore` plus
`PostgresWorkspaceStore` persistence path before and during a simulated rollback
cohort. The cohort updates its legacy runtime-resource row while the 0029 fenced
row remains byte-for-byte unchanged; a restored fenced adapter then reclaims the
row at generation 2 and decrypts its handle. The smoke also proves a second 0029
application fails with PostgreSQL duplicate-table error. The migration and
schema contain no EFS ownership fields.

## Verification

- `pnpm --filter @hachej/boring-core exec vitest run src/server/runtime/__tests__/PostgresFencedSandboxHandleStore.test.ts src/server/runtime/__tests__/FencedSandboxHandleStore.test.ts src/server/db/__tests__/fencedSandboxHandles.migration.test.ts src/server/runtime/__tests__/WorkspaceRuntimeSandboxHandleStore.test.ts --no-file-parallelism` — passed: 4 files, 15 tests, including two independent real PostgreSQL connections, crash ambiguity, tombstone generation 1→2, old-ciphertext replay rejection, unconditional ordinary active-lease refusal, stale force-evidence fencing, and the 0028 → 0029 → rollback cohort → restored adapter proof.
- `pnpm --filter @hachej/boring-core typecheck` — passed.
- `pnpm --filter @hachej/boring-core run build:docker` plus explicit absence checks for both declaration entrypoints — passed: both serialized runtime entries built and the runtime-only export assertion covered 10 artifacts.
- `pnpm --filter @hachej/boring-core build` plus explicit presence checks for `dist/server/index.d.ts` and `dist/server/db/index.d.ts` — passed: the serialized normal build asserted all 18 runtime/type export targets and retained both declarations.
- `pnpm --filter @hachej/boring-core run test:pack-types` — passed: a strict TypeScript consumer resolved the packed `@hachej/boring-core/server/db` declaration and concrete adapters.
- `pnpm --filter @hachej/boring-core check:bundle-size` — passed; main server is 75.07 KB gzip (+3.0% against baseline, below the 10% budget).
- `pnpm typecheck:changed` — not accepted as evidence: dependency prebuild exceeded the bounded 300-second run before workspace typechecks completed. The focused Core typecheck above passed.
- `pnpm lint:invariants` — not rerun after parent steering required bounded commands only; the immediately preceding PR revision passed this unchanged gate.
