# Durable human-in-the-loop pause spike

## Current failure mode: CONFIRMED

Verified against `boring-ui-v2` `origin/main` at `d44a689bb47638227cf7f930041ee593026f08bf` without modifying that repository.

The review is correct. The durable object is only the question record; the continuation of the tool call is an unresolved `Promise` stored in a process-local `Map`.

`plugins/ask-user/src/server/askUserRuntime.ts:38-60`:

```ts
private readonly waiters = new Map<string, Waiter>()

registerWaiter(questionId: string, sessionId: string, signal?: AbortSignal): Promise<AskUserToolResult> {
  // ...
  return new Promise((resolve) => {
    // ...
    this.waiters.set(questionId, waiter)
  })
}

hasWaiter(questionId: string): boolean {
  return this.waiters.has(questionId)
}
```

The runtime registers that waiter, writes the question to the file-backed store, and then awaits the same in-memory promise. `askUserRuntime.ts:144-153`:

```ts
const pendingAnswer = this.coordinator.registerWaiter(question.questionId, question.sessionId)
try {
  await this.store.createPending(question)
  await this.store.appendTranscriptEvent({ type: "created", question, at: this.isoNow() })
  await this.store.appendTranscriptEvent({ type: "ready", questionId: question.questionId, sessionId: question.sessionId, schema: parsed.data, at: this.isoNow() })
  // ...
  return await this.waitForAnswer(question, pendingAnswer, request.timeoutMs, signal)
}
```

On startup, the server actively abandons every persisted pending question for which the new process has no waiter. `plugins/ask-user/src/server/askUserServerPlugin.ts:36-39`:

```ts
const lifecycle: FastifyPluginAsync = async (app) => {
  const pending = await store.listPending()
  await runtime.abandonOrphanedPending(pending.map((question) => question.sessionId))
  ensurePublisher()
```

The abandonment decision is explicit in `askUserRuntime.ts:117-122`:

```ts
const pending = await this.store.getPending(sessionId)
if (pending && !this.coordinator.hasWaiter(pending.questionId)) {
  await this.abandon(pending.questionId, pending.sessionId)
}
```

Answer submission has the same ownership test. `askUserRuntime.ts:160-166`:

```ts
const question = await this.store.getByQuestionId(questionId)
if (!question || question.sessionId !== sessionId) throw new AskUserRuntimeError(/* ... */)
if (!this.coordinator.hasWaiter(questionId)) {
  await this.abandon(questionId, sessionId)
  return "abandoned"
}
```

The bridge turns that result into the reported error. `plugins/ask-user/src/server/questionsBridge.ts:51-55`:

```ts
const status = await this.options.runtime.submitAnswer(question.questionId, question.sessionId, command.params.values)
if (status === "abandoned") {
  const latest = await this.options.store.getByQuestionId(question.questionId)
  if (latest?.status === "answered") return { ok: true, status: "answered" }
  throw new QuestionsBridgeError(ASK_USER_ERROR_CODES.QUESTION_NOT_FOUND, "question waiter is no longer available", 409)
}
```

Finally, abandonment mutates the surviving JSON row to `abandoned` and removes it from the pending index (`askUserStore.ts:129-136`). There is no code on `origin/main` that reconstructs the waiter, re-enters the tool call, or journals a continuation.

## Executable spike

The spike is in `/home/ubuntu/projects/spike-durable-pause` and uses Node 22 `node:sqlite`, WAL mode, ES modules, and Vitest. Its pause row contains all requested fields:

`pause_id`, `session_id`, `submission_id`, `tool_call_id`, `continuation_key`, `kind`, `action_name`, `canonical_args`, `args_digest`, `state`, `answer_policy`, `responded_by`, `response_payload`, `created_at`, and `expires_at`.

The agent model has no answer promise. `requestToolPause()` persists a checkpoint and returns `{status: "yielded", pauseId, continuationKey, toolCallId}`. A later process calls `resumeToolCall()` with only identifiers loaded from the durable record. Consumption inserts into a one-row-per-pause table and returns the stored response.

T1 uses a shell-owned child, waits until SQLite contains the pause, sends real `SIGKILL`, starts a second Node process, answers, and consumes the original `tool_call_id`. The first worker's interval exists only to make the kill observable; no answer promise or waiter is held.

### Final `npm test` output

```text
> test
> vitest run --reporter=verbose
 RUN  v3.2.7 /home/ubuntu/projects/spike-durable-pause
stdout | test/durable-pause.test.js > durable human-in-the-loop pause > T1 restart continuation survives a real process kill
T1 requester_pid=246 resumer_pid=260 killed=SIGKILL pause_id=fc734a63-9a8c-4909-9d01-085b1f29ea0a status=completed
stdout | test/durable-pause.test.js > durable human-in-the-loop pause > T2 stale answer is demoted and cannot authorize the call
T2 pause_id=83d9fd74-7ec9-49af-beb8-777cfa06d582 disposition=demoted state=pending resumed=false
stdout | test/durable-pause.test.js > durable human-in-the-loop pause > T3 approval is consumed once; bypassing the app guard still hits SQLite
T3 pause_id=c79ae989-c26b-434a-8b05-0f524c7df8b9 first=consumed replay=SQLITE_CONSTRAINT count=1
stdout | test/durable-pause.test.js > durable human-in-the-loop pause > T4 expired pause cannot be answered
T4 pause_id=8e6a52c6-37b6-4bff-a698-e8d373c8bbe6 disposition=demoted state=expired
stdout | test/durable-pause.test.js > durable human-in-the-loop pause > T5 unauthorized principal cannot answer
T5 pause_id=25fe5611-e1ac-49db-8691-2cc175776352 responder=mallory disposition=demoted state=pending
 ✓ test/durable-pause.test.js > durable human-in-the-loop pause > T1 restart continuation survives a real process kill 209ms
 ✓ test/durable-pause.test.js > durable human-in-the-loop pause > T2 stale answer is demoted and cannot authorize the call 8ms
 ✓ test/durable-pause.test.js > durable human-in-the-loop pause > T3 approval is consumed once; bypassing the app guard still hits SQLite 5ms
 ✓ test/durable-pause.test.js > durable human-in-the-loop pause > T4 expired pause cannot be answered 4ms
 ✓ test/durable-pause.test.js > durable human-in-the-loop pause > T5 unauthorized principal cannot answer 4ms
 ✓ test/durable-pause.test.js > raw constraint probes used by mutation testing > T1 continuation keys are unique so store-only lookup is unambiguous 3ms
 ✓ test/durable-pause.test.js > raw constraint probes used by mutation testing > T2 match constraint survives adapter guard bypass 3ms
 ✓ test/durable-pause.test.js > raw constraint probes used by mutation testing > T4 expiry constraint survives adapter guard bypass 3ms
 ✓ test/durable-pause.test.js > raw constraint probes used by mutation testing > T5 authorization constraint survives adapter guard bypass 3ms
 Test Files  1 passed (1)
      Tests  9 passed (9)
   Duration  1.08s
```

## Mutation checks

Each mutation edits `src/schema.sql`, runs only the corresponding guard-bypass probe, and restores the schema in a shell trap. A killed mutant means removing that SQLite rule made the expected safety test fail. This avoids counting an unrelated test failure as a kill.

| Invariant | Removed DB enforcement | Result | Classification |
|---|---|---|---|
| T1 unambiguous durable continuation | `UNIQUE` on `continuation_key` | Duplicate lookup became possible; targeted test failed | **CONSTRAINT** |
| T2 stale/superseded answer | `accepted_response_must_match` trigger | Guard-bypass stale answer was accepted; targeted test failed | **CONSTRAINT** |
| T3 one-shot consumption | `PRIMARY KEY` on `pause_consumptions.pause_id` | Second consume succeeded with the app guard disabled; targeted test failed | **CONSTRAINT** |
| T4 expiry | `accepted_response_must_be_live` trigger | Guard-bypass expired answer was accepted; targeted test failed | **CONSTRAINT** |
| T5 responder authorization | `accepted_response_must_be_authorized` trigger | Guard-bypass unauthorized answer was accepted; targeted test failed | **CONSTRAINT** |

```text
=== RESULT: KILLED (CONSTRAINT); targeted npm test exit 1 ===  # T1
=== RESULT: KILLED (CONSTRAINT); targeted npm test exit 1 ===  # T2
=== RESULT: KILLED (CONSTRAINT); targeted npm test exit 1 ===  # T3
=== RESULT: KILLED (CONSTRAINT); targeted npm test exit 1 ===  # T4
=== RESULT: KILLED (CONSTRAINT); targeted npm test exit 1 ===  # T5
Mutation summary: 5/5 killed; 0 survived.
```

No tested safety invariant is adapter-only. The scheduling fact that a new process must notice and re-enter a responded continuation is architectural rather than something a SQL constraint can guarantee; T1 proves that re-entry executable, while uniqueness makes its store-only lookup structurally unambiguous.

## What landing this in `plugins/ask-user` takes

### Ask-user-local work

Approximately 700-1,000 changed lines:

- `plugins/ask-user/src/server/askUserStore.ts`: replace or supplement the JSON snapshot with a transactional SQLite pause/response/consumption store and migrations; about 250-350 lines.
- `plugins/ask-user/src/server/askUserRuntime.ts`: remove `InProcessAskUserCoordinator`, stop abandoning questions based on process-local ownership, add request/respond/consume transitions, digests, expiry, and policy checks; about 150-220 lines.
- `plugins/ask-user/src/server/createAskUserTool.ts`: return a durable-yield result instead of awaiting a promise, and format a re-entered answer; about 40-80 lines.
- `plugins/ask-user/src/server/askUserServerPlugin.ts`, `questionsBridge.ts`, and bridge/routes handlers: stop startup abandonment, take the authenticated responder principal from server context, record answer attempts, and enqueue continuation wake-up; about 80-140 lines.
- `plugins/ask-user/src/shared/types.ts`, schema, and error codes: pause states, continuation identity, action/argument digest, policy, and response-attempt types; about 80-120 lines.
- Existing store/runtime/workflow/bridge/server tests plus real process restart tests and mutation runner; about 300-450 lines.

The existing front end can mostly continue projecting `pending/responded/cancelled` records. It needs small mapping changes for `denied`, `expired`, and `consumed`, not a redesign.

### Dependency boundary

The pause store itself does **not** need the full L1 durability system. A smaller single-writer SQLite component with explicit transactions, WAL, migrations, busy handling, and DB-enforced transitions is sufficient for request/answer integrity.

The full claim — “the original tool call completes after its process dies” — **does** cross out of `plugins/ask-user`. Today `createAskUserTool.execute()` awaits `runtime.ask()`, and the agent tool contract expects that promise to return a result. Persisting a better question row alone cannot recreate that JavaScript stack.

Production therefore needs one of these:

1. Integrate pauses with the L1 durable submission/attempt/stream machinery: journal the tool-call checkpoint, settle the current attempt as yielded, and claim/re-enter it when a response is committed. This is the preferred path because it reuses attempt fencing, idempotency, and durable tool-result publication.
2. Build an ask-user-specific durable continuation dispatcher in the agent host. That is smaller initially but still needs durable claim/fencing, retry, idempotent result insertion, and session re-entry; it recreates a narrow version of L1 and is likely false economy.

Rough agent-host/L1 integration: another 400-800 lines across the tool execution contract, Pi/harness adapter, durable submission/checkpoint writer, wake-up dispatcher, and process-boundary tests. End-to-end landing estimate: roughly 1,200-1,800 changed lines across 10-15 production/test files.

It also depends on a canonical argument serializer shared by request and resume, an authenticated principal at the bridge boundary, a stable `submission_id`/`tool_call_id`, and exactly-once-or-idempotent publication of the resumed tool result. Cross-machine or multiple-server deployment additionally needs a shared database or an owner-routing/claim protocol; a workspace-local SQLite file only proves same-filesystem restart durability.

## Blunt verdict

**The current implementation does not provide durable pause. The review is correct.** It provides durable question display plus an in-memory blocked call, and startup deliberately destroys the surviving question's ability to answer.

**The claim is technically achievable and the spike proves the storage/re-entry shape across a real `SIGKILL` and a new PID.** SQLite can enforce all five tested invariants. But changing only `askUserStore.ts` would be cargo-cult durability: the feature is not real until the agent runner journals and re-enters the original tool call. Use the smaller transactional writer for the pause rows, and connect it to L1 for execution continuity.
