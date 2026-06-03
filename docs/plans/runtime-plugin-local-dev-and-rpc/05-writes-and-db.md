# Runtime Plugin Writes + DB Plan

## Status

Deferred. This is intentionally **not V1**.

## Why defer

Writes are a different problem from reading a workspace file. They require choices about:

- storage engine
- writable source declaration
- key columns
- version columns
- optimistic concurrency
- idempotency
- transactions
- conflict UX
- audit/logging

Those choices should not block the first plugin DX fixes.

## Preconditions

Start this only after:

1. plugin self-test works
2. file-backed paginated reads work
3. workspace links work
4. already-installed dependency imports work

## Likely direction

Writable data should use a real transactional store, not JSON/CSV rewrites.

V1 write store should be explicit, not magic:

```ts
interface WritableSourceDescriptor {
  name: string
  kind: "sqlite" | "duckdb"
  path: string
  table: string
  keyColumns: string[]
  versionColumn: string
}
```

Mutation should be constrained:

```ts
interface MutateArgs {
  source: string
  op: "update" | "upsert"
  key: Record<string, unknown>
  set: Record<string, unknown>
  expectedVersion: string | number
  idempotencyKey: string
}
```

Conflict handling must be atomic in one transaction:

```sql
update table
set ..., version = version + 1
where key = ? and version = ?
```

No shadow `_version` table unless the transaction model is explicitly proven.

## Non-goals until this plan is reopened

- No `/api/v1/data/mutate`.
- No optimistic row concurrency in file reads.
- No file-format writes.
- No Quack/DuckLake work.
- No remote DB credentials.
