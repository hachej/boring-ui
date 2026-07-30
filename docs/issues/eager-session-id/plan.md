# Eager id, lazy file — stable session ids by replicating pi

Status: proposed. Supersedes `docs/issues/stable-session-id/plan.md` (client-minted ids + reservation protocol), which is withdrawn.

## Summary

Give every Boring chat a **stable session id from birth** by copying what the pi CLI
already does: mint the id eagerly, write the transcript lazily.

The server mints the id when the user clicks New chat and writes nothing. The first
prompt creates the pi session with that exact id. The id never changes, so the entire
ephemeral → native adoption machinery — the cause of the #775 regression family —
is deleted rather than patched.

Net effect: **≈ −3,500 to −4,000 LOC** (≈ −1,900 source, ≈ −2,000 tests) while
*delivering* the feature, not deferring it. The range is honest: the access-policy work
(S1) and the tenancy pin (S0) add code the census did not count, and if the pin forces
the wrapper fallback the saving drops substantially.

## Why this, and not what we tried

The previous design had the **client** mint a Pi-valid id. Because that id was
untrusted input reaching a filesystem path, and because the id had to be reserved
during the window between New chat and first send, it required a validation layer plus
an `O_EXCL` claim protocol with a liveness heartbeat and stale reclaim. A
thermo-nuclear review returned DO NOT SHIP on that protocol: the stale reclaim is a
pathname TOCTOU (`stat` → gap → unconditional `rename`), so two contenders that both
observe staleness can both end up owners.

The reservation existed **only** to hold an id across that window. Remove the window
and there is nothing to arbitrate. This design has no reservation, therefore no claim
protocol, therefore no blocker.

### The requirement that drove the wrong design

`#775` scope says: *"New chat is browser-only before send; no rename and no durable
empty session."* The previous plan read that as a hard mandate against server-side
minting (`docs/issues/stable-session-id/plan.md:26-33`) and built the reservation
protocol to satisfy it.

The requirement is legitimate; the inference was not. The concern is *no durable empty
session*, and pi already solves it — see below. We satisfy #775 **as literally
written**, with no reaper and no clutter in `pi /resume`.

### What pi actually does

`node_modules/@mariozechner/pi-coding-agent/dist/core/session-manager.js:663-690`:

```js
const hasAssistant = this.fileEntries.some(e => e.type === "message" && e.message.role === "assistant");
if (!hasAssistant) { /* no write at all */ return }
if (!this.flushed) { const fd = openSync(this.sessionFile, "wx"); /* flush all entries */ }
```

Pi mints the id eagerly (in memory; the filename is precomputed at `_reset`, line 606)
and writes the file lazily, gated on the first **assistant** message. Start pi and
quit: no file. Send a user message and quit before the reply: still no file.

We replicate exactly this. An abandoned New chat leaves nothing on disk, so it cannot
appear in `pi /resume`, in `SessionStore.list()` (which scans `.jsonl`,
`sessions.ts:190-216`), or anywhere else.

## Today → Delta

| | Today | After |
|---|---|---|
| New chat | browser-only row, no server call | awaited POST mints an id (~10-50 ms, no file I/O) |
| Id at first send | server mints a **different** native id; client swaps mid-flight | id is already correct; nothing changes |
| Empty transcript on disk | none | none |
| Adoption / handoff / `viewId` | ~2.5k LOC of id-mutation bookkeeping | deleted |
| First-send failure recovery | receipt ledger, fingerprinting, retry-unknown 409, tombstones | ordinary idempotent `/prompt` retry by `clientNonce` |
| Duplicate-id fence | `O_EXCL` claim + heartbeat + stale reclaim | in-process harness maps (as with every other session op) |

## Design

1. **Mint.** `SessionStore.create` keeps `randomUUID()` and the summary return; it
   stops writing the header/`session_info`/file (`sessions.ts:222-248`). `mkdir` moves
   to the first-prompt path. The response carries `ephemeral: true`, meaning *not yet
   durable — do not expect `/state` to exist*.
2. **Hold.** The server persists nothing. The client is the sole holder of the id
   between mint and first prompt. A server-side "issued ids" ledger would add state,
   break across restarts, and buy nothing.
   **Not fully stateless, though:** on the addressed wire `bindingForSession` →
   `resolveSessionRuntime` requires the id to appear in `store.list()`
   (`sessionInventory.ts:69-70`), and a fileless id only resolves via the
   *process-local* runtime pin cached at `embeddedGateway.ts:285`. A hub restart
   between mint and first prompt therefore yields `AGENT_SESSION_NOT_FOUND`. That is
   consistent with the ratified lost-on-reload semantic, but the client must handle a
   404 on the **first** `/prompt` by re-minting rather than surfacing an error.
   Re-minting is duplication-safe precisely because minting writes nothing: an orphaned
   id leaves no artifact anywhere. **Guard: re-mint only while the session is still
   ephemeral.** A 404 on a durable session's `/prompt` is a real error and must
   surface.
3. **Commit.** First prompt: `getOrCreatePiSession` misses `loadPiSessionFile`, so it
   calls `SessionManager.create(runtimeCwd, nativeSessionDir, { id: sessionId })`.
   Pi's own lazy flush writes the file when the first assistant message arrives.
4. **Validate.** The minted id round-trips through the client, so
   `isValidClientNativeSessionId` **survives** and is enforced on the first-prompt
   create path.

### The access gate — the load-bearing change (was missing)

A fileless id is rejected **before** it ever reaches the harness:
`promptBeforeDispose` → `getAdapter` → `assertCanAccessSession`
(`harnessPiChatService.ts:888,992-998`) → `sessionStore.load` → no `.jsonl` →
`normalizeSessionAccessError` → 404 `SESSION_NOT_FOUND` (`:1049-1054`). The same gate
guards `/followup`, `/events` (`getChannel:899`), `/state`, clearQueue and interrupt.

So the design requires an explicit **per-route access policy**, which is the real
mechanism of this change and must land before anything else:

- **`/prompt` may create.** A valid, unseen, well-formed id is admitted and creates the
  pi session. Same trust class as today's `desiredSessionId`.
- **Read routes admit a fileless id iff a live in-process channel/runtime already
  exists for that `(ctx, id)`** — i.e. only after a `/prompt` created it. Otherwise they
  stay `SESSION_NOT_FOUND`.
  **This clause is essential, not a refinement.** `/prompt` returns a receipt, not a
  stream (`piChat.ts:322-332`); the reply arrives over `/events`. Pi flushes the
  `.jsonl` only on the first *assistant* message, so between prompt-admission and that
  flush the id is still fileless — a flat "read routes 404 on fileless ids" rule would
  404 the client's `/events` open for the very first reply, breaking exactly the bug we
  are fixing. Keying on the live runtime closes that window while preserving the
  no-leak property: an abandoned New chat never reaches `/prompt`, so it has no runtime
  and still 404s.
- **`sessionEphemeral` clears at send**, not at flush — the moment `/prompt` is
  admitted, the front may open `/events`.
- **The front must therefore keep a not-yet-durable read gate.** `sessionEphemeral`
  **survives as a read gate**; what dies is the *transition* (`adoptNative`, the
  id swap, the handoff). See S6.

### Open risk — tenancy pin (must be resolved before S1)

`SessionStore.create` today writes `boringSessionCtx` into the header
(`sessions.ts:226-232`). That pin is what makes a session visible and loadable under a
workspace ctx; a plain pi-native transcript is only reachable when
`allowNativeUnscopedAccess` is true (`sessions.ts:969`). Pi's own
`SessionManager.create({id})` writes pi's header, with no ctx pin.

**Consequence if ignored: on a scoped host — which is the default — the transcript is
invisible to `list()` and unloadable, so the session silently vanishes after the first
reply.**

**RESOLVED by the S0 spike — mechanism (a), via public API.** The pin can be attached
through pi's public `getHeader()`, which returns the live header object (not a copy),
so no private-field access is needed. Verified against real pi: our id is honoured; no
file exists after create; a user message alone does not flush; the assistant reply
flushes; the pin survives the flush, a reopen, and appends after reopen; `listAll`
finds the session. Option 2/3 are no longer needed.

Residual fragility: this relies on `getHeader()` returning a live reference. Add a test
that fails loudly if a pi upgrade changes it to return a copy.

Three candidate resolutions, in preference order:

1. **Inject the ctx pin into the native transcript** at first-prompt create, so scoped
   hosts keep working unchanged. Pi builds its header at `_reset` with a fixed field set
   and serializes it from `fileEntries[0]` at first flush — **there is no public hook
   for `boringSessionCtx`**, so the spike must pick one of two non-API mechanisms and
   test it explicitly:
   - **(a)** mutate the private `fileEntries[0]` header object immediately after
     `SessionManager.create`, before the first flush. Serializes cleanly; fragile across
     pi upgrades — pin the pi version and add a test that fails loudly on drift.
   - **(b)** rewrite the header line after the first flush, reusing the existing
     header-rewrite code near `sessions.ts:1070`. Must fence against pi's concurrent
     `appendFileSync`.
2. Keep wrappers on scoped hosts only — preserves behaviour, keeps the dual-resolution
   machinery alive, and forfeits much of the simplification.
3. Gate the whole design on the renamed flag (unscoped hosts only) — smallest change,
   but leaves the default host on the old adoption path, i.e. does not fix #775 for it.

**Spike option 1 before committing to the sequence below.** If it fails, this plan
becomes option 2 and the LOC estimate drops substantially.

### Honest limits — do not let the PR claim otherwise

- **`wx` is a per-filename fence, not a per-id fence.** `session-manager.js:605-606`
  builds `${fileTimestamp}_${sessionId}.jsonl`, so two creates with one id produce two
  filenames and both flushes succeed. Duplicates are fenced by the harness's existing
  in-process `piSessions` / `piSessionCreations` maps (`createHarness.ts:530-556`).
  Sufficient for a single hub process. **Multi-process hosts sharing a session dir are
  unfenced — exactly as they already are for every other session operation.** Out of
  scope, and not a regression.
- `liveSessionCacheKey` / the legacy-vs-addressed dual wire **survives**. Its reason
  for existing is ctx convergence across two wires
  (`legacyPiChatCompatibility.ts:64-67` stamps it on every legacy call), which is
  independent of who mints ids. Only the "idempotency records" clause of its doc
  comment dies. Retiring the shim needs addressed command routes — separate PR.
- `deleteSession` vs cold-open generation race survives. Only the *expired-cleanup*
  half of that finding dies here.
- `sessions.ts:471-475` `files[0]` first-match lookup survives. Benign now that its
  duplicate-producing feeder is gone; still sloppy.

## Work plan

Ordered; each step is a commit and independently reviewable.

**Prerequisite — PR #968. DONE.** The two stable-id commits were reverted
(`41bd91a70` reverts `ec5155603`, `fff79714e` reverts `ad8b0ab66`); the two
simplification commits (`ae69b9879` shared cache key, `c4abd293d` required owner +
`codedError`) were kept. Typechecks clean, 1909/1928 tests pass, the single failure
(`system-prompt-size.regression`) is pre-existing and documented as such in
`ec5155603`'s own message. **Still owed: re-verify the four regressions in a browser at
the new HEAD** — the prior verification ran with stable-id active.

**S0 — spike the tenancy pin.** Resolve the open risk above before writing any of the
below. Deliverable: proof that a first-prompt-created native transcript is
visible/loadable under a scoped ctx, or a decision to fall back to option 2/3.

**S1 — server: per-route access policy.** Admit a valid unseen id on `/prompt` only;
keep every read route 404ing. This is the load-bearing change; nothing else works
without it. Lands before any create-path change.

**S2 — server: create-with-id on first prompt.** `createPiSession` collapses to
`savedPiFile ? open(...) : create(..., { id: sessionId })`; `sessionId` becomes
always-string; `onNativePersisted` / `desiredNativeSessionId` die; `effectiveSessionId`
simplifies to `sessionId`. **Replace the `catch` at `createHarness.ts:615-618`** — it
currently swallows an open failure and mints a *new* pi id. Under stable ids a silent
id swap is poison; make it a coded hard error (invariant 8).

**S2b — server: mint without writing.** Only now does `SessionStore.create` stop
writing and start returning `ephemeral: true`. **Ordering matters:** if this landed
before S2, the next `/prompt` would hit the untouched `else` branch at
`createHarness.ts:619-622` and pi would mint a *different* internal id with no ctx pin
— the exact divergence this project exists to kill, live at an intermediate commit.
Decide title-at-create: carry it client-side until first prompt, or accept losing
pre-send titles (nothing sets one via the UI today).

**S3 — server: delete the reservation machinery.**
`packages/agent/src/server/harness/pi-coding-agent/nativeSessionPersistence.ts` whole
file (267) + its test (82); sole importer is `createHarness.ts:31`. In
`harnessPiChatService.ts`: `promptNewSession`, the `nativeSessionStarts` ledger, TTL
prune, `cleanupExpiredNativeSessionStart`, `createAndPromptNativeSession`,
`idempotencyStartKey` (~140). `readState` / `readStateBeforeDispose` **survive**. The
Host ledger becomes the sole idempotency authority.

`promptNewSession` has consumers beyond the service: the interface declaration and
admission wrapper in `packages/agent/src/core/piChatSessionService.ts:78,137,154-155`,
and the legacy bridge wrapper in `legacyPiChatCompatibility.ts:80-90` (a conditional
spread, so it degrades gracefully, but the type surface must be updated).

**Breaking API change to declare:** `shared/chat/nativePiFirstSend.ts` exports
`NativeSessionStart` / `NativePromptReceipt`, which are re-exported from the public
barrel `shared/chat/index.ts:19-20` and appear in the shipped `PiChatSessionService`
signature. Deleting them is a public API break and needs a version note.

**S4 — server: routes.** Delete `NativePromptRequestSchema` and the `native-prompt`
route (`piChat.ts:62-68,165-177`) — this deletes the hardcoded-default-agent blocker
outright. **The flag cannot simply vanish:** the rename route at `piChat.ts:179` sits inside
`if (opts.nativeSessionStartEnabled)`, and `sessionInventory.ts:97` maps it to
`allowNativeUnscopedAccess`. Native transcripts still exist here — they're just lazy.

**Decision: keep the name `nativeSessionStartEnabled`; do not rename it.** After the
prompt route is deleted the name is inaccurate — what it actually gates is the rename
route plus native-file trust — but renaming costs ~40 files across agent/workspace/
core/cli, the `apps/*` and plugin playgrounds, and tests, and the flag is **on the
wire** (`apps/workspace-playground/src/front/App.tsx:194` reads it off a server `meta`
payload), so it would need a compat alias or a coordinated bump for zero runtime
change. Instead: **one doc comment at the option declaration** stating what it now
gates and that "start" in the name is historical. Clarity for one line instead of
forty files.

**S5 — front: delete the first-send transaction layer.**
`nativeFirstSendTransactions.ts` whole file (163) + test (85);
`shared/chat/nativePiFirstSend.ts` (74); `remotePiSession.ts` loses
`postNativeFirstPrompt`, `scheduleNativeFirstAdoption`, the error lattice,
`commandSessionId`, and the `followUp` adoption gate (~190). First prompt becomes an
ordinary `sessionUrl('/prompt')`, which is already addressed-aware.

**S6 — front: delete the ephemeral→native transition.** `usePiSessions.create()`
collapses to one branch; `adoptNative`, `localCreateUntilPrompt`, `LocalSession`,
`localSessionId`, the tombstone delete branch (~160). In `piChatPanelHooks.ts` the
adoption effects go (~35) — and with them the mid-send dispose: that effect re-fired
because `sessionId` flipped during adoption (dep at line 82), so with stable ids it
**cannot re-fire mid-send**. `PiChatPanel` drops `nativeSessionStartEnabled`, both
adoption callbacks, the synthetic optimistic message (479-487), and the handoff term in
`sessionWorking` (~50).

**`sessionEphemeral` survives** as the not-yet-durable read gate (`PiChatPanel.tsx:128,
206,328`): without it, New chat immediately opens `/events` and `/state` on a fileless
id and 404s. What dies is the *transition*, not the flag. `persistActive`
(`usePiSessions.ts:211`) must key on that flag rather than on id shape, per the reload
semantic above.

**S7 — front: delete id-mutation bookkeeping.** `WorkspaceAgentFront.tsx`:
`NativeSessionHandoff`, `nativeSessionHandoffs`, **`replaceSessionId`** (52 LOC of
pin/pane/handoff re-keying — the largest single adoption artifact), the handoff halves
of `makeCenterParams`, `adoptNative` from the sessions API (~220). `replaceSessionId`
also migrates `nativeSessionHandoffPromptsRef` and `hydratedAssistantReplySessionKeysRef`
— both maps die with it, not just the handoff record. Plus the floating-chat
handoff-rewrite in `WorkspaceShellCapabilitiesHost.tsx` (~15). `resolveSessionKey`,
`workspaceSessionKey`, and `sessionIdentity.ts` **survive** — they are the agentTypeId
addressing layer, orthogonal to adoption.

**S8 — front: collapse `viewId`.** It exists solely so a Dockview panel keeps React
identity across an id swap; with stable ids `viewId === id` always. ~35 LOC across
`ChatPaneStageDock`, `ChatLayout`, `ChatPaneStage`, `chat/definition.ts`, `AppLeftPane`
— including the working-badge indirection behind the stuck-badge bugs. **Own commit**,
since `viewId` is typed as a generic pane feature (grep shows no other producer).

**S9 — add the small things.** A re-entry guard on plain New chat
(`WorkspaceAgentFront.tsx:1599`) — it has none, so a double-click would now create two
server sessions where the second local create used to be free. Mirror
`pendingCreatePaneRef`. All other create callers already treat `create()` as async, so
**no caller rewrites**.

## Decided semantic: an unsent session does not survive reload

**A session that was minted but never prompted is lost on reload. This is intended.**
Durability begins at the first send, exactly as it does in pi. Nothing needs to bridge
the gap: `list()` needs no changes (it scans `.jsonl`, `sessions.ts:190-216`, so a
fileless id is simply absent), and no server-side inventory of minted ids exists.

The one code consequence: `persistActive` currently refuses to persist *local* ids
(`usePiSessions.ts:211`). Under eager minting the active id is a real server id, so that
guard must key on the `ephemeral` flag instead of on id shape — otherwise the id
persists, then fails to resolve against a list that lacks it, and reload silently falls
back to `serverData[0]` (`applySessions:296-303`).

Reload behaviour is then identical to today. Verify in a browser, not only in tests.

## Verification

Unit/integration is necessary but was not sufficient last time — every wrong diagnosis
in this family died in a browser, not in a test run.

1. `SessionManager` semantics: create-with-id on first prompt; id survives a restart;
   concurrent duplicate first-prompts yield one handle; open-failure raises the coded
   error; **quit before assistant leaves no file**.
2. Route tests for a fileless id: `/state`, `/events`, `/prompt`, `/followup`, `DELETE`.
3. Browser, on the running playground, each asserted and exiting non-zero on failure —
   the existing `repro-*.mjs` scripts only print JSON and always exit 0, and must not be
   reused as gates:
   - New chat → id on the wire equals the id the server later persists
   - first message renders immediately and is answered (no blank pane)
   - session switch across three sessions
   - Quick chat popover create
   - abandon a New chat → no file on disk, nothing in `pi /resume`
   - double-click New chat → exactly one session

## Follow-ups (explicitly not in this PR)

- Addressed command routes; retire `liveSessionCacheKey` (thermo finding 4).
- `deleteSession` vs cold-open generation fence (finding 6, first half).
- Wrapper/native dual-resolution retirement in `sessions.ts` (462-499,
  `findWrapperReferencingNativeSessionSync`, `ensureWrapperForNativeSessionSync`) —
  several hundred LOC behind a one-time wrapper migration, now that all new sessions
  are pi-native.
