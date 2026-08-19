# Recommendation: S-B — import pi JSONL; abandon durable event-store rows

Pi's native JSONL is the only source that contains enough state to preserve the visible transcript **and** continue the session. Import it into the target schema under an explicitly supplied tenant/workspace scope. Do not promote `boring_event_stream_*` rows into conversation truth: they are a UI event projection, and their keys do not contain `tenant_id`.

Breaking the wire protocol makes the cutover manageable: reconnect open UIs on a new stream/cursor, but retain the session ID and continue from imported pi state.

## Executable result

Workspace: `/home/ubuntu/projects/spike-migration`

- `src/canonical-session-storage.ts`: parser, importer, canonical write path, and injectable pi `SessionStorage` adapter.
- `src/event-store-migration.ts`: real-shape legacy tables, path decoder, fail-closed promotion planner, and conditional archival promotion when an authoritative tenant mapping is supplied.
- `src/proof.ts`: copies a real transcript, imports it, injects storage into `pi-agent-core@0.80.7`, and runs a turn.
- `src/event-store-proof.ts`: creates/populates the three legacy tables and displays the missing-scope failures.
- `test/migration.test.ts`: Vitest coverage against real copied files and target-schema invariants.

Source line counts (`wc -l`):

```text
221 src/canonical-session-storage.ts
94 src/event-store-migration.ts
107 test/migration.test.ts
71 src/proof.ts
16 src/event-store-proof.ts
Σ 509
```

The JSONL import/storage implementation is 221 lines total. Its parse/write/import core occupies lines 29-137 (109 physical lines); the injectable continuation adapter occupies lines 139-221 (83 physical lines).

## 1. Pi native JSONL

### Feasibility

**Yes** for both required outcomes.

For UI rendering, every source line is preserved as a canonical record payload with:

- the parsed object;
- its exact original JSONL text (`rawLine`);
- its source line number;
- its original entry `id`, `parentId`, type, message/tool/custom payload, and timestamp.

A UI projection can select `type: "message"` records in source order, matching the existing `PiSessionStore.loadEntries()` behavior. Attachments and tool/custom payloads remain inside the original message objects.

For continuation, `CanonicalPiSessionStorage` implements the public `SessionStorage` methods used by `pi-agent-core@0.80.7`. It reconstructs the entry map, current leaf, labels, and path-to-root without flattening the graph. New pi entries go through the target schema's admission, claim/fence, batch, and settlement path rather than bypassing its invariants.

### Real tree evidence

The originals were read-only. Tests copied them into a temporary directory before import and compared the originals afterward.

Real branched/compacted file:

```text
{"file":"/home/ubuntu/.pi/agent/sessions/--home-ubuntu-projects-boring-macro--/2026-06-17T10-51-55-890Z_019ed535-8872-79cf-aa06-7b30cf97ce56.jsonl","lines":4229,"types":{"session":1,"model_change":3,"thinking_level_change":4,"custom":11,"message":4198,"compaction":11,"session_info":1},"branchParents":1,"maxChildren":2,"leafId":"df9563bf"}
```

Real continuation-proof file:

```text
{"file":"/home/ubuntu/.pi/agent/sessions/--home-ubuntu-projects-swissinfer--/2026-06-10T08-09-44-475Z_019eb094-871b-76f6-901f-8bbe94901f06.jsonl","lines":822,"types":{"session":1,"model_change":2,"thinking_level_change":1,"message":791,"custom":25,"compaction":2},"branchParents":0,"maxChildren":1,"leafId":"eb54cced"}
```

The 4,229 imported canonical records round-tripped to the exact 4,229 source `rawLine` strings. The test separately asserted 11 compaction entries, one parent with two children, the original leaf, the path from that leaf to root, all entries in original order, and unchanged original bytes.

Vitest output:

```text
> test
> /home/ubuntu/projects/spike-l0-schema/node_modules/.bin/vitest run
 RUN  v3.2.7 /home/ubuntu/projects/spike-migration
 ✓ test/migration.test.ts (3 tests) 3261ms
   ✓ pi native JSONL -> canonical target schema > imports a copied real transcript without mutating or flattening its graph  3213ms
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

### Real pi continuation

The proof imports the 822-line real file, reopens it through injected canonical storage, and calls `AgentHarness.prompt()`. The offline faux provider is deterministic, but the session/context construction and both appended turn records are the real pinned pi code.

```text
{"source":"/home/ubuntu/.pi/agent/sessions/--home-ubuntu-projects-swissinfer--/2026-06-10T08-09-44-475Z_019eb094-871b-76f6-901f-8bbe94901f06.jsonl","copiedSource":"/tmp/pi-migration-offline.4UyYUX/2026-06-10T08-09-44-475Z_019eb094-871b-76f6-901f-8bbe94901f06.jsonl","mode":"faux","importedLineCount":822,"originalEntryCount":821,"entriesBefore":821,"entriesAfter":823,"appendedEntries":2,"leafBefore":"eb54cced","leafAfter":"fc6c1597-2c44-44fa-9764-fb648bbed395","compactionCount":2,"reply":"CONTINUED_FROM_IMPORTED_CONTEXT messages=93","originalUnchanged":true}
```

This proves that pi consumed imported compaction/tree state, built a 93-message active context, and appended the new user and assistant entries. The changed leaf is expected and proves continuation rather than a read-only replay.

The Gemini attempt was made. Vault access is blocked by the sandbox, so there is no claimed model output:

```text
Get "http://127.0.0.1:8200/v1/sys/internal/ui/mounts/secret/agent/gemini": dial tcp 127.0.0.1:8200: socket: operation not permitted
Error: GEMINI_API_KEY is required for gemini mode
```

## 2. `boring_event_stream_*`

### Path tenancy: confirm, with an important qualification

The prior review is **confirmed if “tenancy” means target `tenant_id`**.

At `origin/main`:

- `shared/events.ts:64-65` defines `sessionStreamPath(x)` as `sessions/${x}`.
- `harnessPiChatService.ts:793` calls it with `sessionKey`.
- `harnessPiChatService.ts:1051` serializes that key as `JSON.stringify([sessionId, workspaceId, userId])`.
- `eventStreamStore.ts:178-203` accepts the opaque path and stores an envelope containing only `v`, `eventIndex`, `timestamp`, `sessionId`, and `chunk`.

Therefore a scoped key such as:

```text
sessions/["scoped-session","workspace-a","user-a"]
```

contains session/workspace/user, but **not tenant**. If “do not carry tenancy” was intended to mean “carry no contextual scope,” that stronger claim is refuted: newer keys do carry workspace and user. Older/plain paths such as `sessions/legacy-session` carry neither workspace nor user.

The three tables in the spike match the real store's columns and constraints. Population follows the real store: create stream, atomically increment `next_offset`, store the `AgentEvent` envelope in entries, and store the chunk under its idempotency key.

Failing output:

```text
{
  "tables": [
    "boring_event_streams",
    "boring_event_stream_entries",
    "boring_event_stream_keys"
  ],
  "results": [
    {
      "path": "sessions/[\"scoped-session\",\"workspace-a\",\"user-a\"]",
      "decoded": {
        "sessionId": "scoped-session",
        "workspaceId": "workspace-a",
        "userId": "user-a"
      },
      "error": "cannot promote sessions/[\"scoped-session\",\"workspace-a\",\"user-a\"]: tenant_id is absent from the legacy key and no authoritative mapping was supplied"
    },
    {
      "path": "sessions/legacy-session",
      "decoded": {
        "sessionId": "legacy-session"
      },
      "error": "cannot promote sessions/legacy-session: tenant_id is absent from the legacy key and no authoritative mapping was supplied"
    }
  ]
}
```

With an explicit authoritative resolver, the scoped row can be inserted into the target schema as `legacy_pi_chat_event`; Vitest proves one such record is committed. Without that resolver, promotion fails closed. A plain path still fails because it also lacks `workspace_id`.

### Canonical-state feasibility

These rows can be **archived as canonical records only when external scope is supplied**, but they cannot become canonical *session state* on their own.

`PiChatEvent` envelopes are a live UI projection. They do not contain the native entry graph, all original message objects, active `leafId`, branch choices, compaction entries, model/thinking changes, or all custom records. Reconstructing a pi-continuable transcript from them would be lossy even if tenancy were known. Their useful data overlaps the native JSONL and creates a difficult deduplication/reconciliation problem.

## 3. Strategy comparison

| Strategy | What is retained | What is lost | Cost/risk | User with an open session |
|---|---|---|---|---|
| **S-A: import both** | Full native state plus legacy UI-event history where external scope can be resolved. | Rows with no authoritative tenant/workspace mapping; native tree still cannot be reconstructed from event-only rows. | Highest: scope-resolution service, JSONL/event reconciliation, duplicate/conflicting ordering rules, two importers, and indefinite ambiguity. A guessed tenant risks cross-tenant disclosure. | Wire reconnect is still required. User may see duplicated/reordered UI history if sources disagree; unresolved sessions must be quarantined. |
| **S-B: import pi JSONL; abandon event rows** | Full visible transcript from messages; IDs, parents, branches, leaf, compactions, model/thinking/custom records; pi continuation. | Event-only transport details such as token deltas, progress events, transient errors, and any event tail not represented in the final native transcript. | Moderate one-time importer plus an explicit source-to-target scope mapping. One source of truth after cutover. | Existing request/stream disconnects and old cursor is invalid. UI reconnects on the new protocol; settled native history renders and the next prompt continues the same session. An in-flight partial turn may disappear and should be reported/retried. |
| **S-C: clean break; legacy read-only** | Old transcripts remain viewable through legacy code; new schema stays clean. | Continuation of every old session; no unified querying/retention semantics; eventual legacy-reader rot. | Lowest immediate migration cost, highest ongoing product/maintenance cost: two readers forever or until forced retirement. | Open old session becomes read-only. Sending a follow-up fails or forces a new session with no automatic working context. |

## 4. Decision and migration contract

Choose **S-B**.

Migration contract:

1. Stop new writers or take a consistent snapshot of the pi tree.
2. Resolve each source directory/header to an authoritative target `tenant_id` and `workspace_id`; never infer tenant from the event path or user ID.
3. Parse and validate unique IDs and backward-only parent references.
4. Insert the header and every native entry through the target schema's fenced batch/settlement flow.
5. Verify record count, exact `rawLine` equality, leaf/path-to-root, branch count, and compaction count before marking migrated.
6. Start new-protocol streams at new cursors. Do not translate v1 cursors.
7. Retain old event DBs only for a bounded rollback/audit window, then delete under the normal retention process.

## Blunt unrecoverable-data statement

Under S-B, **all data that exists only in `boring_event_stream_*` is deliberately abandoned**: token-by-token deltas, ephemeral progress/status/error events, old cursor positions, idempotency keys, event timestamps/order not represented by the native transcript, and any partially streamed turn that never reached pi JSONL.

Also, **tenant ownership is not recoverable from either an unscoped native header or an event-stream path**. Such sessions cannot be safely auto-assigned. They require an authoritative external mapping; without one they must be quarantined or left inaccessible, not guessed into a tenant.
