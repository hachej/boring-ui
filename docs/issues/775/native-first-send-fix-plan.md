# Plan: converge live-channel identity for native first send

## Problem (proven, not inferred)

Native first send publishes its turn to a live channel nobody is subscribed to.

Two paths derive different `sessionCacheKey` for the same session:

| Path | Context | Key |
| --- | --- | --- |
| Legacy `POST /api/v1/agent/pi-chat/sessions/native-prompt` | no `sessionAuthority` → `toSessionCtx` legacy branch | `[id, workspaceId, authSubject]` |
| Addressed `/state`, `/events` | `sessionAuthority: 'workspace-scope'` | `[id, workspaceScopeId, '']` |

`sessionCacheKey` is `harnessPiChatService.ts:1251`; `toSessionCtx` is `:1204`.

The mismatch alone is survivable: `readStateBeforeDispose` (`:371-388`) falls back to
`readPersistedState` (fresh transcript read) when no channel exists under the read key.

The freeze needs `/events`: `subscribeBeforeDispose` → `getChannel` (`:893-899`) finds no
channel under the addressed key and **creates** one, cold-instantiating an adapter from the
transcript at that instant (`[user]`, before the reply). From then on `/state` sees a truthy
channel, skips the disk fallback, and returns that frozen adapter forever.

**Decisive experiment (one variable).** Identical curl flow; issuing one
`/events?cursor=0` between the native-prompt POST and the `/state` polls froze state at
`[user]` for 20s. Without it, state grew 1→2→3→4→6.

Symptoms explained: first message never answered; blank pane; "working" badge sticks
(terminal status published to the unsubscribed channel). Second message works because it
takes the addressed route and drives the adapter the UI is attached to.

## Constraint that killed the naive fix

Rewriting the legacy ctx to `workspace-scope` unified the keys but **repartitioned
storage** — 4 failures in `agent-host/__tests__/legacyTranscriptCompatibility.test.ts`
(legacy sessions listed as `[]`). Storage layout must stay **user + workspace in full-app**,
workspace-only in single-user hosts. Kept as `stash@{1}` for the record.

## Approach

Split the two roles the ctx tuple currently conflates:

- **storage partition** — unchanged, still `{workspaceId, userId}` / `{workspaceId: storageScope}`
- **runtime identity** (live channel, durable seq stream, pi-session handle) — converged

via an additive optional `runtimeScopeKey`, set by **both** paths to `workspaceScopeId`.

### Why it cannot reach storage

`PiSessionStore` never spreads unknown ctx fields. Every path/key derivation enumerates
fields explicitly: `sessions.ts:169-170` (`inFlightKey`), `:1043-1045`
(`normalizeSessionCtx`), `:1058`, `sameSessionCtx` (`:1049`). Directory selection is
`sessionDirForNamespace` (`:96`) from namespace/root, not from ctx spread. An extra field
is therefore inert for storage by construction, not by convention.

### Why isolation is preserved

In full-app `workspaceScopeId` already **is** the per-user namespace
(`<workspace>_user_<hash>`, `plugins/boring-mcp/src/server/appServerBinding.ts:177-187`),
so channels remain per-user there. In single-user hosts it collapses to the workspace id,
which is the desired behaviour.

## Changes

1. `packages/agent/src/core/piChatSessionService.ts` — add `runtimeScopeKey?: string` to
   `PiSessionRequestContext`. **Done in stash@{0}.**
2. `packages/agent/src/shared/session.ts` — add `runtimeScopeKey?: string` to `SessionCtx`;
   update the shape assertion in `shared/__tests__/session.test.ts`. **Done.**
3. `harnessPiChatService.ts:1204` `toSessionCtx` — pass the field through on **both**
   branches. **Done.**
4. `harnessPiChatService.ts:1251` `sessionCacheKey` — `runtimeScopeKey` wins:
   `[sessionId, runtimeScopeKey, '']`. Chosen so addressed keys stay **byte-identical** to
   today (their `runtimeScopeKey` equals their storage scope), preserving existing addressed
   durable streams; only legacy-keyed streams re-root. **Done.**
5. `agent-host/legacyPiChatCompatibility.ts` — wrap ctx adding **only**
   `runtimeScopeKey: input.scope.workspaceScopeId`. Do **not** set `sessionAuthority` or
   `storageScope` (that was the naive fix). **Not started.**

   **Must apply to every delegated method, not just the ledger-wrapped mutations.**
   The file today passes ctx through untouched and only wraps mutations in `effect`
   ("read/stream calls remain direct", `:40-41`). The freeze trigger is the *read/subscribe*
   interleaving, so `readState`, `subscribe`, `readAttachment` and `listSessions` must get
   the mapped ctx too — otherwise legacy reads keep the old key and the split survives on
   the read side. Apply one ctx-mapping helper to all delegated calls.
6. `agent-host/embeddedGateway.ts:82-95` `context()` — add
   `runtimeScopeKey: claim.workspaceScopeId`. **Not started.**
7. `harness/pi-coding-agent/createHarness.ts` — the delicate part. `sessionCacheKey`
   (`:275`) prefers `runtimeScopeKey`, but `normalizeSessionCtx` (`:262`) strips it, and the
   handle cache has five call sites that must agree:
   `get` `:547`, `set` `:731`, `disposePiSession` `:745`, `getOrCreatePiSessionForCommand`
   `:767`, `hasPiSession` `:795`.
   **Decision: preserve `runtimeScopeKey` through `normalizeSessionCtx`** so every call site
   derives the same key with no per-site threading, and rely on §"cannot reach storage"
   for safety. This keeps `get`, `set` and the `piSessionCreations` single-flight guard on
   one key. Current stash keys `get` on raw ctx while `set` uses normalized — a permanent
   cache miss that leaks one pi session per prompt; **must be reworked**.

   **Slash-command path needs an explicit fallback.** `sessionCtxFromRunContext` (`:258`)
   builds `{workspaceId, userId}` from `RunContext` and cannot produce `runtimeScopeKey`, so
   `getOrCreatePiSessionForCommand` (`:766-771`) would derive the *old* tuple, miss the
   converged handle, and create a **second pi session for slash commands** — reintroducing
   the split. Fix: on key miss, fall back to `piSessionHandlesFor(sessionId)` before
   creating. Session ids are unique, and this mirrors the existing no-ctx branches of
   `disposePiSession` (`:753-758`) and `hasPiSession` (`:795`).

   `hasPiSession` (`:795`) needs no threading, but only because step 5 maps ctx on reads
   too: it is called from `harnessMayHaveLiveSession` (`harnessPiChatService.ts:389-393`),
   so if legacy reads kept the old tuple it would report "no live session" for a live
   addressed handle and short-circuit into `readPersistedState` — a new stale-read bug.
8. `harnessPiChatService.ts:379` — hardening: when a channel exists use `channel.adapter`
   instead of calling `getAdapter`, closing the last route by which a stale cold adapter can
   surface. **Must keep the authorization check**: `getAdapter` performs
   `assertCanAccessSession`, so returning `channel.adapter` directly would skip it — call
   `assertCanAccessSession` first, then use the channel's adapter. There is no
   intentionally-stale-adapter case: `deleteSessionBeforeDispose` (`:342`) drops the channel
   with the handle, and converged keys make `getAdapter` return the same adapter anyway.
   **Not started.**

## Test (write first, must fail for the right reason)

`harnessPiChatService.test.ts`, scripted harness:

1. `promptNewSession` with a **legacy** ctx (no `sessionAuthority`).
2. Subscribe `/events` cursor 0 with an **addressed** ctx (`sessionAuthority:'workspace-scope'`,
   `storageScope` + `runtimeScopeKey` = scope id) **before** the reply resolves — this is the
   interleaving proven to cause the freeze.
3. Assert: addressed `readState` eventually contains the assistant message; the addressed
   subscriber receives the terminal status; the harness created exactly **one** pi session.
4. Then a **legacy** `readState` (old-style ctx via the compatibility layer) also sees the
   reply — guards step 5 covering reads, and the `hasPiSession` short-circuit.
5. Then a **slash command** on the same session asserts still exactly one pi session —
   guards the `getOrCreatePiSessionForCommand` fallback.

## Verification

- `legacyTranscriptCompatibility.test.ts` must stay green (guards storage repartitioning).
- `packages/agent`: `src/server`, `src/core`, `src/shared` suites.
- `packages/workspace`: `src/app`, `src/front`.
- Live: `apps/workspace-playground/repro-first-send.mjs` (~30s headless) must show an
  assistant reply for a new chat's first message.

## Known limits (not fixed here)

- **Multi-process**: `channels` (`harnessPiChatService.ts:96`) and `piSessions`
  (`createHarness.ts:493`) are per-process `Map`s. full-app deploys web + agent-worker
  separately (`start` / `start:worker`, `fly.toml` / `fly.worker.toml`), so convergence is a
  within-process guarantee only.
- **Dual path remains**: `promptNewSession` exists only on the legacy service; there is no
  addressed native-first-send. Giving the gateway that operation removes this bug class by
  construction — deliberately deferred to its own PR.
- Legacy-keyed durable streams change path once at deploy (open legacy `/events` cursors
  reset).
- Legacy metering `stateKey` dedup granularity shifts per-user → per-scope; attribution
  still carries `authSubject`.

## Rollback

Each change is additive and independently revertable; `stash@{1}` records the rejected
approach so it is not retried.
