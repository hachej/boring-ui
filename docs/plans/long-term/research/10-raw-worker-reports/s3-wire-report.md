# Wire recommendations against the real boring-ui `ChatPanel`

| Recommendation | Result | Browser observation |
|---|---|---|
| R1 — opaque cursors | **BREAKS** | Initial `/state` hydration loops with `Expected number, received string` at `seq`; the panel never connects to events. |
| R2 — implicit session creation | **BREAKS** | The panel immediately calls explicit session creation, gets 404, leaves the composer disabled, and never has a session ID with which to address the first prompt. |
| R3 — `message-end.final` authoritative, deltas advisory | **PARTIAL** | The final answer is correct after dropped delta frames, but `message-end` does not heal the hole. Numeric gap detection aborts event reduction and a full `/state` rehydrate supplies the correct final message. A stale-outbox warning is shown. |

## Rig and baseline

The Vite app imports the real `ChatPanel` from `@hachej/boring-agent/front`, aliased to `/home/ubuntu/projects/boring-ui-v2/packages/agent/dist`. The existing shim now has four deterministic modes selected with `WIRE_MODE`: `baseline`, `opaque-cursors`, `implicit-session`, and `drop-deltas`. `src/node-server.ts` re-hosts the same Hono shim handlers with a deterministic local agent so the wire behavior is independent of celld/model availability.

This container rejects all listening sockets with `EPERM`, so Playwright fulfilled the built Vite assets and Hono requests in-process at the same browser-visible URLs (`127.0.0.1:5199` and `127.0.0.1:8787`). Chromium was also rejected by the kernel process sandbox; Firefox from the same installed Playwright package ran successfully. This changes transport plumbing only: the browser executed the real bundled panel, its fetch calls, Zod schemas, remote-session code, reducer, and rendering.

Baseline request trace:

```text
GET  /shim/api/v1/agent/pi-chat/sessions                         -> 200
POST /shim/api/v1/agent/pi-chat/sessions                         -> 200
GET  /shim/api/v1/agent/pi-chat/<id>/state                       -> 200
POST /shim/api/v1/agent/pi-chat/<id>/prompt                      -> 202
GET  /shim/api/v1/agent/pi-chat/<id>/events?cursor=0             -> 200
```

Observed baseline: the submitted text `playwright baseline probe` and the deterministic assistant response both rendered; `data-pi-chat-last-seq` reached `8`. The duplicate user bubble is an existing shim limitation (the projected user event does not carry the optimistic `clientNonce`) and is unrelated to R1–R3. The visible reconnect banner is a harness artifact from deliberately closing the normally long-lived event stream after six polling ticks.

Screenshot: [`s3-wire-baseline.png`](/home/ubuntu/projects/spike-flue-celld/s3-wire-baseline.png)

## R1 — opaque cursors: BREAKS

### Real observation

The shim emitted opaque tokens such as `resume_c2VxOjA` in state, receipts, and event sequence positions without changing the front end. The panel created a session, then every `/state` response failed validation:

```text
Expected number, received string
path: ["seq"]
```

Observed request trace stopped at repeated state hydration; no `/events` request was made. `data-pi-chat-last-seq` stayed `0` and the UI remained on “Loading chat history…” plus reconnecting.

Screenshot: [`s3-wire-opaque-cursors.png`](/home/ubuntu/projects/spike-flue-celld/s3-wire-opaque-cursors.png)

### Exact front-end decisions (`origin/main`)

The first break is the shared runtime schema in `packages/agent/src/shared/chat/piChatSchemas.ts:22,120-132,251-254`:

```ts
const seqNumber = z.number().int().nonnegative()

export const PiChatSnapshotSchema = z.object({
  // ...
  seq: seqNumber,
})

const baseEvent = z.object({ seq: seqNumber })

export const CommandReceiptSchema = z.object({
  accepted: z.literal(true),
  cursor: seqNumber,
})
```

The addressed stream parser additionally hard-requires a numeric envelope sequence in `pi/piChatStream.ts:52-65`:

```ts
const eventSeq = typeof envelope.event === 'object' && envelope.event !== null
  ? (envelope.event as { seq?: unknown }).seq
  : undefined
if (typeof envelope.seq !== 'number' || envelope.seq !== eventSeq) {
  return { type: 'schema-error', line, error: new Error('addressed event envelope seq mismatch') }
}
```

The complete production list of cursor/sequence ordering arithmetic in `packages/agent/src/front` is:

1. `pi/piChatStream.ts:116-120` — stale comparison, `lastSeq + 1`, gap comparison, and replacement of `lastSeq`:

   ```ts
   if (event.seq <= lastSeq) return { type: 'stale', event, lastSeq }
   const expectedSeq = lastSeq + 1
   if (event.seq > expectedSeq) return { type: 'gap', ... }
   return { type: 'applied', event, lastSeq: event.seq }
   ```

2. `pi/piChatReducer.ts:198-200,218-221` — receipt cursor and snapshot rewind comparisons:

   ```ts
   if (cursor <= state.lastSeq) return { ... }
   // ...
   snapshot.seq < state.lastSeq
   ```

3. `pi/piChatReducer.ts:316-327` — the same stale/`+ 1`/gap arithmetic again on reducer application:

   ```ts
   if (event.seq <= state.lastSeq) return state
   const expectedSeq = state.lastSeq + 1
   if (event.seq > expectedSeq) return { ...needsResync... }
   ```

4. `piChatPanelUtils.ts:25-29` — receipt cursor comparison used to decide whether to retain local submitted state:

   ```ts
   return receiptCursor === undefined || state.lastSeq < receiptCursor
   ```

There are also number-only boundaries without arithmetic: `buildPiChatEventsUrl` accepts `cursor: number` (`piChatStream.ts:189-201`), reload uses `snapshot.seq` as that cursor (`204-209`), and remote/session/debug state types store `lastSeq: number`.

### Required front-end change

Separate the opaque resume token from any optional diagnostic ordering number. Model `cursor` as an opaque branded string, store and resend it verbatim, and remove client stale/gap/rewind comparisons. If the product still wants UI diagnostics for delivery gaps, expose a separate non-resumable event ordinal; do not overload the resume token.

Rough estimate: **90–140 production lines and 150–250 test lines** across shared schemas/types, `piChatStream`, `piChatReducer`, `remotePiSession`, `piChatPanelUtils`, and their tests.

## R2 — implicit session creation: BREAKS

### Real observation

Both explicit session-create routes were removed while prompt handling retained its ability to create a missing session on first send. On an empty session list the panel issued:

```text
GET  /shim/api/v1/agent/pi-chat/sessions -> 200 []
POST /shim/api/v1/agent/pi-chat/sessions -> 404
```

It rendered “Failed to create session: 404”, kept the composer disabled, and made no prompt request. Therefore the server’s implicit-on-prompt behavior was unreachable.

Screenshot: [`s3-wire-implicit-session.png`](/home/ubuntu/projects/spike-flue-celld/s3-wire-implicit-session.png)

### Exact front-end decision (`origin/main`)

`PiChatPanel.tsx:547-556` turns the empty list into an explicit create call before any user send:

```ts
useEffect(() => {
  if (externalSessionId || sessionsLoading || sessionsError || activeSessionId || sessionList.length > 0) return
  if (resetInProgressRef.current) return
  if (autoCreateInFlightRef.current) return
  autoCreateInFlightRef.current = true
  void sessions.create({ resumeSessionId: sessions.resumeSessionId }).catch((error) => {
    autoCreateInFlightRef.current = false
    addLocalNotice({ id: 'session-auto-create-error', /* ... */ })
  })
}, [/* ... */])
```

`session/usePiSessions.ts:400-420` refuses to construct a `RemotePiSession` until an active, known session exists:

```ts
if (!enabled || !connectActiveSession || !activeSessionId || !activeSessionKnown) {
  setActivePiSession(undefined)
  return
}
```

And `usePiSessions.ts:422-444` defines creation as an explicit POST whose returned session is installed as active:

```ts
const response = await fetchImpl(sessionsUrl(), {
  method: 'POST',
  headers: { ...requestHeaders(), 'Content-Type': 'application/json' },
  body: JSON.stringify(init ?? {}),
})
if (!response.ok) throw new Error(`Failed to create session: ${response.status}`)
// ...
setActiveSessionId(session.id)
```

### Required front-end change

Remove auto-create-on-empty, keep the empty composer enabled, and add a first-send admission path that does not require an existing `RemotePiSession`. That response must return the new session ref plus cursor; the panel then inserts/activates the returned session, creates the remote session, and reconciles the optimistic message. Reset/new-chat semantics and failure recovery also need updating.

Rough estimate: **80–120 production lines and 100–180 test lines** in `PiChatPanel`, `usePiSessions`, submit/policy plumbing, and session tests.

## R3 — final authoritative, deltas advisory: PARTIAL

### Real observation

For assistant text the shim assigned normal sequence slots, omitted every third delta deterministically, omitted `message-part-end`, and still emitted the complete canonical `message-end.final`. The panel ultimately rendered the exact complete answer and advanced to sequence `21`, so the visible message was neither corrupt nor missing.

However, the browser trace contains an extra `GET /state` after the event stream, and the UI shows:

```text
Some pending messages were not present in the recovered session and were cleared.
```

That proves recovery came from snapshot rehydration, not from accepting the authoritative `message-end.final` across missing advisory deltas.

Screenshot: [`s3-wire-drop-deltas.png`](/home/ubuntu/projects/spike-flue-celld/s3-wire-drop-deltas.png)

### Exact front-end decision (`origin/main`)

`piChatReducer.ts:316-327` returns early on the first sequence hole. A later `message-end` cannot reach `reduceEvent`:

```ts
if (event.seq <= state.lastSeq) return state
const expectedSeq = state.lastSeq + 1
if (event.seq > expectedSeq) {
  return {
    ...state,
    connection: { ...state.connection, state: 'reconnecting' },
    needsResync: { expectedSeq, actualSeq: event.seq, lastSeq: state.lastSeq },
  }
}
```

If it does reach the switch, `message-end.final` is already authoritative (`piChatReducer.ts:343-350`):

```ts
case 'message-delta':
  return updateMessageById(state, event.messageId, (message) => appendPartDelta(/* ... */))
case 'message-part-end':
  return updateMessageById(state, event.messageId, (message) => finishPart(/* ... */))
case 'message-end':
  return commitFinalMessage(state, event.messageId, event.final)
```

`remotePiSession.ts:439-445,476-480` sees `needsResync`, aborts the stream, and hydrates state:

```ts
this.store.dispatch({ type: 'event', event: frame })
if (this.store.getState().needsResync && this.isStreamActive(generation, runId)) {
  this.gapCount += 1
  this.rehydrateAfterStreamReset(generation)
}

// ...
this.abortEventStream()
void this.hydrateAndConnect(generation, options)
```

### Required front-end change

For the recommendation to work directly, advisory deltas must not consume the authoritative replay sequence, or the protocol must identify a gap as delta-only. A smaller but riskier client-only patch could allow a gapped `message-end` to commit and advance the cursor, but a bare numeric gap cannot prove that only deltas—not tool, queue, error, or lifecycle events—were lost. The safer change is a protocol distinction plus reducer/stream handling that stores the opaque resume cursor and accepts canonical finals independently of advisory frame delivery.

Rough estimate: **20–40 production lines and 40–80 test lines** for a protocol-supported advisory-delta distinction; more if the wire schema must be versioned.

## Verification

- `npm run check:types` in `spike-flue-celld`: pass.
- Vite production build of the real panel (`npx vite build --base ./ --outDir dist-wire`): pass.
- Playwright/Firefox baseline plus R1/R2/R3: pass as executable observations; four 1440×1000 PNGs captured.
- Focused upstream Vitest invocation could not start because this checkout lacks `packages/agent/node_modules/vitest/vitest.mjs`; no dependency installation or upstream-tree mutation was performed.

Executable files:

- `/home/ubuntu/projects/spike-flue-celld/src/shim.ts`
- `/home/ubuntu/projects/spike-flue-celld/src/node-server.ts`
- `/home/ubuntu/projects/spike-flue-celld/scripts/wire-playwright.mjs`
