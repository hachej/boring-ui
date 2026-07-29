# Plan: stable session id from birth (prototype + design)

Status: **prototype / design**. Not for merge as-is.

## Why

`#775`/`#811` made a new chat's session id **mutate**: it starts as a browser-only
`local-<uuid>`, and the first prompt materialises a native Pi session whose id is
minted server-side, so the surface must *adopt* the new id mid-flight.

Everything expensive follows from that one mutation:

| Mechanism | Purpose | Cost |
| --- | --- | --- |
| `viewId` + `nativeSessionHandoffs` | keep a pane's UI identity stable while its session id changes | ~104 lines of identity plumbing; a third identity notion beside `sessionId` and `sessionKey(id, agentTypeId)` |
| `liveSessionScopeId` | make the legacy first-send and addressed reads converge on one live channel | added in #968 |
| adoption paths | `onNativeSessionAdopt`, `replaceSessionId`, the detached-chat rewrite effect | duplicated per surface |

Every regression that got #811 reverted sat at a seam between those identity
notions, as did the #895 merge conflict (`viewId ?? id` vs `pane.id`).

**If the id never changes, none of that is needed.**

## The constraint that shapes the design

The obvious move — mint a durable id server-side at creation — is **wrong**: it
would write a native transcript for every "New chat" click, including chats never
sent. `#775` explicitly requires an unsent New chat to stay ephemeral and
browser-only, and #968's orphan-reaping exists precisely to avoid stray
transcripts.

So the id must be **client-minted, server-accepted on first send**: stable from
birth, with nothing persisted until the user actually sends.

## Feasibility (verified, not assumed)

Pi supports caller-supplied ids as a first-class feature:

```ts
// node_modules/@mariozechner/pi-coding-agent/dist/core/session-manager.d.ts:313
static create(cwd: string, sessionDir?: string, options?: NewSessionOptions): SessionManager
export interface NewSessionOptions { id?: string; parentSession?: string }
```

Pi validates the id as: *non-empty, alphanumeric plus `-`, `_`, `.`, starting and
ending alphanumeric*. `crypto.randomUUID()` satisfies this.

Front-end surface is small: the ephemeral id has **one** minting site
(`usePiSessions.ts:703 localSessionId()`) and **one** caller (`:457`).
Ephemerality is carried by an explicit `ephemeral: true` flag, **not** by the
`local-` prefix, and nothing branches on the prefix shape — so changing the id
format does not silently change ephemeral semantics.

## Define "ephemeral" precisely

`ephemeral` is set in exactly one place (`usePiSessions.ts:457`, local create) and
cleared in two (on adoption `:415`, and `WorkspaceAgentFront.tsx:886`). But one
flag currently gates **four independent behaviours**:

| # | Behaviour | Site |
| --- | --- | --- |
| 1 | don't open an event stream (excluded from "known/connectable") | `usePiSessions.ts:189` |
| 2 | route the first prompt through native-start | `PiChatPanel.tsx:328` (`nativeSessionStartEnabled && sessionEphemeral`) |
| 3 | expect the id to change — attach `autoStart: false` + `nativeFirstPrompt.onAdopt` | `usePiSessions.ts:438` |
| 4 | hide Copy ID (nothing stable to copy) | `AppLeftPaneSessionRow.tsx:65` |

So today the flag means, all at once:

> *nothing exists server-side* **and** *the id is provisional and will change*
> **and** *don't stream yet* **and** *there is nothing worth copying*

Those are independent facts that merely coincide under the current design. The
coincidence is load-bearing and it hides failures: in the Quick chat bug a key
mismatch made `sessionEphemeral` false, which simultaneously meant "stream it"
and "don't use the native route" — producing the `local-*` 404 poll loop.

**A stable id splits the bundle.** (3) and (4) stop being true by construction:
there is no adoption, and the id is durable and copyable from birth even before
anything is persisted. What remains — (1) and (2) — is a single fact.

**Target definition:**

> **`unsent`** — the user created this chat but has not sent a message, so no
> server-side session or transcript exists. It has a real, durable id from
> creation. It becomes *sent*, permanently, when the first prompt is accepted.

One checkable predicate with an obvious lifecycle, instead of a bundle. Copy ID
then works on an unsent chat, which is better behaviour than today.

**Sequencing:** do NOT rename `ephemeral` -> `unsent` while this is a prototype —
#968 depends on the flag. Let the prototype confirm that meanings (3) and (4)
genuinely disappear; if they do the rename is justified and nearly free, since the
flag has one writer and four readers.

## Mechanism

1. Client mints a Pi-valid uuid for a new chat (replacing `local-<uuid>`), still
   flagged `ephemeral: true`. Nothing is persisted.
2. First send passes that id to the server as the desired native session id
   (extend `NativeSessionStart`, today `{ idempotencyKey, retry }`).
3. `createNativePiSessionAdapter` -> `createPersistedNativeSessionManager` ->
   `SessionManager.create(cwd, dir, { id })`.
4. The created native session id **equals** the client's id. No adoption occurs.

## What this deletes (the payoff)

- `viewId` threading and `nativeSessionHandoffs` (~104 lines)
- `onNativeSessionAdopt` / `replaceSessionId` adoption paths, and the detached
  chat's duplicate rewrite effect
- `liveSessionScopeId` **if** paired with #979 (one prompt path means the two key
  domains cannot diverge); on its own it still removes the id-change race
- the `viewId ?? id` ambiguity that caused the #895 merge conflict

Net: three identity notions collapse to two (`sessionId`, `sessionKey`).

## Prototype results (branch `proto/stable-session-id`, 20 files, +298/-60)

**Mechanism works, proven in a browser against a real server**
(`apps/workspace-playground/repro-stable-id.mjs`):

```text
requestedIdOnWire: c1da2974-4dcd-4a6b-8503-e6b7db00ddd5
serverSessionId:   c1da2974-4dcd-4a6b-8503-e6b7db00ddd5
ID_IS_STABLE: true   NO_LOCAL_PREFIX: true
replyArrived: true   createdSessionCount: 1   consoleErrors: []
```

The wire field is `nativeSessionStart.desiredSessionId`. Gates: agent
`src/server/pi-chat` + `src/server/harness` 306 passed, touched-area 114 passed,
`tsc` clean, workspace typecheck clean. The #968 native-first-send regression test
still passes, for the right reason: exactly one adapter, stable id used by both
first-send and addressed reads.

### Answers to the open questions

1. **Collision — a real hole, and Pi does not close it.** Pi does **not** reject
   duplicate caller-supplied ids; its timestamped filenames allow several
   transcripts sharing one header id. Left naive, a client could claim another
   session's id. The prototype adds an **atomic per-id reservation plus a
   `SessionManager.listAll()` duplicate check**, with tests covering sequential
   and concurrent duplicates. **This is a hard requirement of the design, not a
   nicety.**
2. **Trust — handled.** The supplied id is validated server-side: Pi's character
   rule, alphanumeric endpoints, no path separators, explicit `..` rejection.
   Treated as untrusted input reaching a filesystem path.
3. **Idempotency — simplified but not removed.** A stable id makes collision
   recovery safer; the unknown-outcome protocol still stands, and retry after a
   process restart still reports unknown rather than claiming anything.
4. **#979 is NOT a prerequisite** — stable-from-birth works through the current
   dual prompt path. **But `liveSessionScopeId` cannot be removed without it**:
   identical ids do not align the legacy and addressed *context* domains, since
   the cache keys derive from context, not from the id. Removable lines without
   #979: **0**.

### Measured payoff (not deleted; measured only)

| Area | Lines |
| --- | ---: |
| `WorkspaceAgentFront.tsx` — `viewId`, `nativeSessionHandoffs`, replacement state | 107 |
| *of which* `replaceSessionId` + workspace `onNativeSessionAdopt` branch | *66* |
| agent front/remote adoption-only wiring | 12 |
| `WorkspaceShellCapabilitiesHost.tsx` detached rewrite + reverse lookup | 14 |
| `liveSessionScopeId` (needs #979) | 0 |
| **Total** | **133** |

## Production-grade requirements

The spike's reservation is an in-process `Map`. That is insufficient: full-app
deploys web and agent-worker as separate machines (`start` / `start:worker`,
`fly.toml` / `fly.worker.toml`), so two processes can reserve the same id
concurrently and both proceed.

**Reservation must be multi-process safe, and the session directory is the only
shared medium both processes already agree on.** Required design:

1. **Atomic claim on the filesystem.** Create a marker exclusively —
   `open(..., 'wx')` / `O_EXCL` — at a deterministic path derived from the
   validated id inside the session namespace directory. `wx` fails with `EEXIST`
   if another process won the race, which is the atomicity guarantee; do **not**
   use `exists()`-then-`create`, which is a TOCTOU race.
2. **Claim before create, release after.** The claim is taken before
   `SessionManager.create`, and released once the transcript exists (the
   transcript itself is then the durable proof of ownership) or on failure.
3. **Stale recovery via TTL.** A claim orphaned by a crash must expire. Treat a
   marker older than a bounded window as reclaimable, and make the reclaim itself
   atomic so two processes cannot both reclaim it.
4. **Duplicate check remains.** The `listAll()` existing-session check stays — it
   covers an id that is already a real session, which is distinct from a
   concurrent in-flight claim.
5. **Never leak claim state into the transcript** or into the session summary.

Also required for prod grade:

- Keep the id validation (Pi character rule, alphanumeric endpoints, no path
  separators, explicit `..`), and unit-test the rejection cases directly.
- A test proving two concurrent claims on one id yield exactly one winner and one
  clean rejection — the multi-process case simulated at the module boundary.
- The existing #968 native-first-send regression test must still pass unchanged.
- No behaviour change for hosts that do not send `desiredSessionId`: the server
  must keep minting the id itself, so this is additive.

### Remaining gaps before this is merge-quality

- **Stale reservation recovery** — a reservation orphaned by a crash must expire.
- **Multi-process reservation.** The reservation is atomic *per process*; full-app
  runs web and agent-worker as separate machines, so two processes could reserve
  one id concurrently. Same limitation class as the per-process live-channel maps.
- Adoption code still present (intentionally); the conforming same-id path no
  longer invokes it.

## Open questions the prototype must answer

1. **Collision handling.** A client-minted id could collide with an existing
   session (malicious or accidental). What does `SessionManager.create` do with a
   duplicate id — overwrite, throw, or silently open? The server must reject a
   duplicate rather than adopt someone else's transcript. **This is the security
   question of the design.**
2. **Trust.** The id becomes client-controlled input reaching a filesystem path
   (`<namespace>/<id>.jsonl`). It must be validated server-side against Pi's rule
   *and* path-escape rules, not merely trusted.
3. **Idempotency interaction.** #968's native-start records key on
   `idempotencyKey`; with a stable id, is the id itself the natural idempotency
   key, and does the retry/unknown-outcome path simplify or break?
4. **Does #979 need to land first?** A prior review assumed the id could only
   stabilise via the addressed gateway. `NewSessionOptions.id` suggests it can be
   done under the current dual path too — making this possibly the cheaper first
   move. The prototype should settle the ordering.
5. **Migration.** Existing sessions created under the old scheme keep working —
   verify no reader assumes id-shape.
6. **Does the `ephemeral` bundle actually split?** Confirm empirically that
   meanings (3) *expect the id to change* and (4) *hide Copy ID* become dead, so
   the flag collapses to the single `unsent` predicate defined above. If either
   survives, say which and why — that would mean the id is not as stable as this
   design claims.

## Verification

- `apps/workspace-playground/repro-poll.mjs` — first send must still reply, and
  the session id observed in the UI must **equal** the id on the server, with no
  adoption event.
- `repro-popover.mjs` — Quick chat unaffected.
- `packages/agent`: `src/server`, `src/core`, `src/shared`; `packages/workspace`:
  `src/app`, `src/front`.

## Not in scope

- #979 (addressed native first-send) — complementary; see open question 4.
- #978 (fold detached chat into pane model) — cheaper after this lands.
