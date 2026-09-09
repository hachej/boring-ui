# R-33-01 — Make the durable log the only owner of session state

**Status:** proven
**Confidence:** executed
**Subsystem:** durability
**Filed:** —

## Claim

pi should be constructed with an in-memory `messages` array and a host-injected record writer, making our
durable log the single owner of session content **and** ordering. Today three owners disagree and the
snapshot fabricates a cursor.

## Why

`harnessPiChatService.readStateBeforeDispose` consults pi's native transcript, the live pi adapter, and
our replay buffer — four sources when `BORING_CHAT_DURABLE_STREAM` is on — then manufactures a cursor:

```ts
seq: Math.max(persisted.seq, liveSeq)
```

`messages` and `seq` have different owners, which is why `canRefreshFromPersistedState`,
`persistedStateDropsLiveMessages` and `harnessMayHaveLiveSession` exist at all.

## Evidence

| source | what it establishes |
|---|---|
| `research/flue-storage-seam.md` | Flue solves this by never using pi's persistence: pi gets an in-memory array, a `ConversationRecordWriter` is injected, and "the durable input record is the precondition for invoking pi" |
| `research/pi-session-storage-api.md` | `pi-agent-core@0.80.7` exposes `SessionStorage`/`SessionRepo` publicly — two viable seams, not one |
| `spike/RESULT.md` | Proven on our **pinned** version: two separate PIDs, real Gemini turns, continuity across process death, `~/.pi/agent/sessions` byte-identical throughout |

## What it costs

Deletes the reconciliation predicates and the fabricated cursor. Upper bound on code touched by the
seam is 3,035 lines (`harnessPiChatService` reconciliation ~600 · `piChatReducer` 852 ·
`remotePiSession` 838 · `usePiSessions` 745) — an upper bound, **not** a delete list; those files also
carry transport, auth headers and UI projection that survive.

Requires the durable store on by default (currently flag-gated off) and per-session storage.

## What it breaks

pi's native transcript stops being a read source — it becomes an export/compat artefact. That needs a
migration (see R-33-04), not just a successor. No ratified decision is violated.

## Refutation

If pi could not be driven from host-supplied storage on 0.80.7, or if a second process could not
continue a session from the host store alone. Both were tested; neither held.
