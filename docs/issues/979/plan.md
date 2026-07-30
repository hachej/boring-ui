# Plan: single prompt path — addressed native first send (issue #979)

Status: **for review**. Sized on the assumption stable-session-id lands first
(same branch).

## Why

Today a new chat's **first** message goes to the legacy route
`POST /api/v1/agent/pi-chat/sessions/native-prompt`, and **every subsequent**
message goes to the addressed route
`POST /api/v1/agents/:agentTypeId/sessions/:sessionId/prompt`.

Two paths for one action means two request contexts, two derived
`sessionCacheKey`s, and one session resolving to two live channels. That is
exactly the defect that made the first message of every new chat go unanswered:
the legacy send published its turn to a channel the addressed reader never
subscribed to. `liveSessionScopeId` exists solely to force those two key domains
back together — a shim for a split that should not exist.

Symptom shape worth remembering: *"the first message does nothing, the second
works"* is the dual path made visible.

## Why this is now small (it was not before)

`promptNewSession` lives only on the legacy service because it must be
**atomic**: create a native session and prompt it as one idempotent operation, so
a failure cannot orphan a transcript or produce two sessions. Without a stable
id that cannot be split into two calls — if create succeeds and prompt fails, the
session exists under an id the client never chose and cannot safely retry into.

**Stable session ids dissolve that constraint.** The client knows the id before it
sends, so the operation becomes *"prompt session X, creating it natively if
absent"* — expressible on the **existing** addressed prompt route. No new gateway
method, no new contract type, no new route. Retry is idempotent because the id
never changes, and the reservation/duplicate machinery from stable-id already
guarantees exactly one winner.

Measured surface:

- front switch: **one** call site (`remotePiSession.ts:538`)
- `liveSessionScopeId`: 10 files (6 source, 4 test)
- `AgentGateway` is an 8-method interface; this plan **adds none**

## Approach

1. **Create-if-missing on the addressed prompt path, behind an explicit
   `createIfMissing: true` body flag.** When a prompt carries the flag and targets
   an id that does not exist, create the native session with that id (reusing
   stable-id's validation, claim/reservation and duplicate check) and run the
   prompt as one operation.

   **Explicit flag, not implicit** (review recommendation): the route 404s on an
   unknown id today, and that 404 protects against a deleted or mistyped id
   silently materialising a new transcript. Implicit creation would convert a
   client bug into data creation and change the semantics of a frozen route for
   every existing caller. An optional field keeps legacy behaviour byte-identical,
   puts intent on the wire for retries, and makes the authorization gate auditable
   at the parse layer.

   **Threading (not just "the route"):** the addressed prompt route is
   `withConnection(...) -> gateway.connectSession -> connection.send`
   (`httpProjection.ts:324`), and **connect fails today for a nonexistent
   session**. Create-if-missing must therefore be threaded through the
   `connectSession`/`send` semantics in `embeddedGateway` and the service `prompt`
   path — small, but more than a route edit. The unknown-outcome retry protocol
   moves with it and stays.
2. **Front switches to the addressed route** for first send
   (`remotePiSession.ts:538`), dropping `native-prompt` from the hot path.
3. **Keep `liveSessionScopeId`. Do NOT delete it here.** (Was: delete it. Review
   proved that wrong — see below.)
4. **Retire the legacy `native-prompt` route from the hot path.** Keep it mounted
   for back-compat unless we can show no external caller depends on it.

### Why the shim must stay (review finding, refined against observed traffic)

Two facts, both verified:

1. **The addressed front already reads addressed.** Captured browser traces show
   its only legacy call is `native-prompt`; `state`/`events`/`sessions` all go to
   `/api/v1/agents/...`. So for a purely addressed host, #979 genuinely leaves one
   context, and the shim becomes dead weight *for that host*.
2. **The legacy read routes remain a supported surface with real consumers**
   (verified by grep, not assumption):
   - the CLI lists sessions via `GET /api/v1/agent/pi-chat/sessions`
     (`packages/cli/src/front/App.tsx:135`)
   - workspace preload probes the same route
     (`workspacePreload.ts:114`)
   - the workspace **plugin client** both creates and prompts via legacy routes
     (`useWorkspacePluginClient.ts:148,153`)
   - the agent front's command-session path still posts to a legacy route
     (`remotePiSession.ts:677`)

Any legacy caller enters `legacyPiChatCompatibility.ts:66` with a context lacking
`sessionAuthority: 'workspace-scope'`; `toSessionCtx`
(`harnessPiChatService.ts:1225`) then yields `{workspaceId, userId}` while the
addressed side yields `{workspaceId: storageScope}`, and `sessionCacheKey`
(`:1272`) diverges: `[sid, ws, userId]` vs `[sid, scope, '']`. Wherever a legacy
and an addressed caller touch the same session, `liveSessionScopeId` (injected at
`embeddedGateway.ts:90` and `legacyPiChatCompatibility.ts:66`) is the only thing
converging them.

**Conclusion:** deleting the shim is blocked not by the front (it reads
addressed) but by the legacy routes remaining supported. Removal is a
deprecation project — migrate the CLI, preload, plugin client and command path to
addressed routes, or move the legacy read context onto the workspace-scope
domain (a storage-partition question: legacy keys sessions by
`workspaceId + userId`). Separate follow-up either way.

Tripwire confirming this: deleting the shim would require changing the #968
regression test, which this plan defines as a stop signal.

## Explicitly NOT in scope

- Changing `AgentGateway`'s method set or `CreateAgentSessionInput`.
- Deleting the legacy pi-chat compatibility layer wholesale.
- Multi-process channel convergence (per-process `Map`s; separate concern).
- #978 (detached chat -> pane model).

## Risks / open questions for review

1. **Is create-if-missing the right shape, or a hidden mode switch?** A prompt that
   silently creates is a semantic change to an existing route. Alternative: an
   explicit `createIfMissing: true` flag in the body, so the intent is on the
   wire and legacy behaviour is untouched. **Reviewers: which, and why?**
2. **Authorization — RESOLVED.** Create-on-prompt must enforce, identically to
   today's native start:
   (a) the `nativeSessionStartEnabled` host capability (the `piChat.ts:165` gate);
   (b) the same scope verification the addressed route already performs;
   (c) `isValidClientNativeSessionId` on the supplied id;
   (d) the stable-id reservation and duplicate check;
   (e) **ledger parity** — legacy `promptNewSession` records a `session.create`
   effect (`legacyPiChatCompatibility.ts:83`); the addressed create-if-missing
   must record an equivalent create effect, not merely a prompt. Missing this
   would make session creation invisible to the Host request ledger.
3. **Idempotency.** Today's native start keys on `idempotencyKey` with a
   retry/unknown-outcome protocol. With a stable id, is the id the natural
   idempotency key, and does the existing protocol simplify, stay, or break?
   Note the stable-id spike found the unknown-outcome protocol still necessary.
4. **The `ephemeral` flag — RESOLVED for this plan.** `ephemeral` currently gates
   route choice at `PiChatPanel.tsx:330` (`nativeSessionStartEnabled &&
   sessionEphemeral`). With one path that meaning disappears: the flag no longer
   selects a route, only whether the send carries `createIfMissing`. Combined with
   stable-id retiring its "expect the id to change" and "hide Copy ID" meanings,
   the flag collapses to the single `unsent` predicate defined in the
   stable-session-id plan. **Do the rename in a follow-up, not here** — it churns a
   flag #968 depends on.
5. **Can `liveSessionScopeId` truly go? — ANSWERED: NO.** See "Why the shim must
   stay" above. Reads still arrive through the legacy compatibility layer, so a
   single *prompt* path is not a single *context*. Deleting it would mirror the
   original bug. Deferred to a follow-up that migrates legacy reads onto the
   workspace-scope context domain.
6. **Pre-create subscribe.** A client may open the event stream for a session
   before its first send, i.e. before the session exists. Define the contract
   explicitly: does `subscribe` on a not-yet-created id 404, or wait? Today the
   ephemeral session is not streamed at all (`usePiSessions.ts:189`), so the
   likely answer is "unchanged — do not stream until sent", but it must be stated
   rather than assumed.
6. **Back-compat.** Anything still calling `native-prompt` (other hosts, plugins,
   the CLI) must keep working.

## Side effects, captured and controlled

Every behavioural consequence of this change, each with its control. If an
implementation produces a side effect not on this list, stop and update the plan.

| # | Side effect | Control |
| --- | --- | --- |
| 1 | The addressed prompt route can now create sessions | Only with explicit `createIfMissing: true`; omitted → byte-identical 404 behaviour. Route-level test for both. |
| 2 | A weaker path to session creation could appear | Same gates as native start, all five: host capability, scope verification, id validation, reservation/duplicate check, ledger `session.create` effect. Each individually tested. |
| 3 | A mistyped/deleted id + `createIfMissing` silently makes a new session | Accepted and bounded: the flag is only sent by the first-send path for a session the client itself minted; follow-up sends never carry it. Assert in the front that only unsent sessions set the flag. |
| 4 | Ledger stops seeing creations | Control = gate (e): create-on-prompt records a `session.create` effect with the same shape as `legacyPiChatCompatibility.ts:83`. Test asserts ledger parity legacy-vs-addressed. |
| 5 | The #968 interleaving could regress (write on one channel, read on another) | The #968 regression test stays untouched and must pass; `liveSessionScopeId` stays. Any need to edit that test is a stop signal. |
| 6 | Legacy `native-prompt` callers break | Route stays mounted and functional; only the addressed front stops calling it. Its route tests remain. Consumers verified: CLI, preload, plugin client, command path — none call `native-prompt` except the front being switched. |
| 7 | Retry semantics change on first send | Idempotency key + unknown-outcome protocol carried over unchanged into the create-if-missing path; the stable id gives retries a fixed target. Covered by moving the existing tests, not rewriting them. |
| 8 | Pre-create `subscribe`/`state` on a minted-but-unsent id | Contract stated: unchanged — unsent sessions are not streamed (`usePiSessions.ts:189` already excludes them); server keeps 404ing until creation. Test pins the 404. |
| 9 | `ephemeral` loses its route-choice meaning (`PiChatPanel.tsx:330`) | Flag semantics narrow toward `unsent`; **no rename in this change** — rename is a follow-up so #968's surface stays stable. |
| 10 | Two tabs racing one unsent chat now race `createIfMissing` | Reservation guarantees one winner; loser gets 409 pre-persistence, message stays client-side. Concurrency test exists from stable-id; extend to the addressed path. |
| 11 | Host ledger/idempotency records for `session.create` + prompt could double-record on retry | Reuse the legacy `requestId = idempotencyKey` convention (`legacyPiChatCompatibility.ts:94`) so a retried first send replays, not duplicates. Test. |
| 12 | Workspace plugin client (`useWorkspacePluginClient.ts:148`) keeps creating via legacy `POST /sessions` | Out of scope, unaffected — that path creates wrapper sessions, not native ones. Noted so nobody "cleans it up" incidentally here. |

## Verification

- `apps/workspace-playground/repro-stable-id.mjs` — id still stable end to end.
- `repro-poll.mjs` — first message answered; the assertion that started all this.
- `repro-popover.mjs` — Quick chat unaffected.
- The #968 native-first-send regression test must still pass. If deleting
  `liveSessionScopeId` requires changing it, that is a signal to stop and think:
  it encodes the exact interleaving that was broken.
- `packages/agent`: `src/server`, `src/core`, `src/shared`; `packages/workspace`:
  `src/app`, `src/front`; both typechecks.

## Success criteria

One prompt path: first send and follow-up send indistinguishable at the transport
level. No new `AgentGateway` method. Legacy behaviour byte-identical for callers
that omit `createIfMissing`. Ledger records a create effect for create-on-prompt.

**Not a success criterion:** removing `liveSessionScopeId` — proven out of reach
until legacy reads move to the workspace-scope context domain. That is the
follow-up this plan sets up, not what it delivers.
