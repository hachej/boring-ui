# Session stream identity

This contract governs durable agent event-stream addressing. The code in
`src/shared/events.ts` is authoritative when this document and the
implementation disagree.

## Durable key

A session stream is keyed by `(workspaceScopeId, sessionId)`. Its path is:

```text
sessions/<enc(workspaceScopeId)>/<enc(sessionId)>
```

`enc` percent-encodes every byte outside `[A-Za-z0-9._-]`, using uppercase
hex. Both fields are opaque, non-empty strings; session ids need not be UUIDs.
`sessionStreamPath(identity)` is the only constructor and
`parseSessionStreamPath(path)` accepts only the canonical encoding.

The process-local Pi cache may still use a JSON tuple, but it is not a durable
key. Gateway host maps use `(workspaceScopeId, agentTypeId, sessionId)`, and
Pi transcript directories use their existing agent and workspace namespace.
Neither grammar may be embedded into a durable stream path.

## Owner attributes

`boring_event_stream_owners` stores one row for each addressed session stream:

- `path` is the primary key.
- `workspace_scope_id` and `session_id` repeat the durable identity and are
  indexed together.
- `agent_type_id` is required for newly opened channels but is an attribute,
  not part of the stream key.
- `auth_subject_id` is execution attribution, never ownership.
- `seat_id` and `thread_id` are reserved nullable columns; A1 defines no
  semantics or foreign keys for them.
- `key_version` is `2` for streams created with this grammar and `1` for
  migrated rows.

There is deliberately no foreign key. SQLite foreign-key enforcement is not
enabled on this connection; migration validation and store transactions enforce
the relationship instead.

## Schema v1 to v2

Opening a v1 database runs one `BEGIN IMMEDIATE` migration. It preflights every
old stream into `boring_event_stream_migration_v2`, validates unique targets,
per-stream row counts and maximum sequence values, and ensures every child row
is accounted for before swapping paths across all three event tables.

The collision rules are exhaustive:

1. A single old row rekeys to its v2 path.
2. For an empty-user row colliding with user-bearing rows, the empty-user row
   wins and the others are quarantined.
3. If several user-bearing rows collide without an empty-user row, all are
   quarantined because their sequence spaces cannot be merged safely.
4. Non-matching, malformed, or otherwise ambiguous old paths are quarantined.

Quarantine destinations are `quarantine/v1/<enc(oldPath)>`; rows are never
dropped. The swap is validated again before `schema_version` becomes `2`.
Concurrent openers serialize on the immediate transaction, re-read the version
under the lock, and only one migrates. A migrated owner has
`agent_type_id = NULL` until the next legitimate channel open backfills it from
the composition's explicit agent type.

The migration is a rollback fence, not a reversible downgrade. Disable
`BORING_CHAT_DURABLE_STREAM` before running an old binary; an old binary pointed
at a v2 file refuses it with `EventStreamSchemaVersionError` rather than writing
mixed path grammars.
