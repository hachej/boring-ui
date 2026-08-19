# S3B wire fixes

| Recommendation | Result | Browser evidence |
|---|---|---|
| R1 — opaque cursors | **WORKS** | Firefox submitted `playwright opaque-cursors probe`, rendered the complete deterministic response, and ended at `data-pi-chat-last-seq="resume_c2VxOjg"`. The trace opened `/events?cursor=resume_c2VxOjA` from the snapshot and later resumed with `/events?cursor=resume_c2VxOjg`, byte-for-byte matching the tokens supplied by the server. There were no schema errors and only one `/state` read. |
| R2 — implicit sessions | **WORKS** | Firefox observed the composer enabled before submission, sent the first prompt, and rendered the complete response. The trace contains no `POST /pi-chat/sessions`; it goes from the empty session list to `GET /pi-chat/draft-.../state`, then `POST /pi-chat/draft-.../prompt`. The 202 receipt returned `sessionId: "draft-..."`, exactly matching the addressed prompt URL. |
| R3 — authoritative `message-end.final` | **WORKS** | In drop-deltas mode Firefox rendered the exact complete final response and advanced to cursor `21`. The trace has exactly one `/state` read (the initial hydration), no recovery `/state`, and no stale-outbox notice. The later `/events?cursor=21` is the harness reconnect after its deliberately short fulfilled stream closes, not a gap abort. |

Screenshots:

- `/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/shots/s3b-fix-opaque-cursors.png`
- `/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/shots/s3b-fix-implicit-session.png`
- `/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/shots/s3b-fix-drop-deltas.png`
- Numeric compatibility control: `/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/shots/s3b-fix-baseline.png`

## Browser traces

R1 cursor evidence:

```text
GET  /shim/api/v1/agent/pi-chat/sessions                                      -> 200
GET  /shim/api/v1/agent/pi-chat/draft-.../state                               -> 200  seq=resume_c2VxOjA
POST /shim/api/v1/agent/pi-chat/draft-.../prompt                              -> 202  cursor=resume_c2VxOjA
GET  /shim/api/v1/agent/pi-chat/draft-.../events?cursor=resume_c2VxOjA        -> 200
GET  /shim/api/v1/agent/pi-chat/draft-.../events?cursor=resume_c2VxOjg        -> 200
```

R2 first-send evidence:

```text
GET  /shim/api/v1/agent/pi-chat/sessions                                      -> 200  []
GET  /shim/api/v1/agent/pi-chat/draft-.../state                               -> 200
POST /shim/api/v1/agent/pi-chat/draft-.../prompt                              -> 202
     receipt: { accepted: true, cursor: 0, clientNonce: "...", sessionId: "draft-..." }
GET  /shim/api/v1/agent/pi-chat/draft-.../events?cursor=0                     -> 200
```

There is no `POST /shim/api/v1/agent/pi-chat/sessions` in that trace.

R3 recovery evidence:

```text
GET  /shim/api/v1/agent/pi-chat/draft-.../state                               -> 200  # only state read
POST /shim/api/v1/agent/pi-chat/draft-.../prompt                              -> 202
GET  /shim/api/v1/agent/pi-chat/draft-.../events?cursor=0                     -> 200  # dropped delta slots
GET  /shim/api/v1/agent/pi-chat/draft-.../events?cursor=21                    -> 200  # normal reconnect
```

The rendered assistant text was exactly:

```text
Round trip complete. The deterministic shim received: “playwright drop-deltas probe”. This response is deliberately long enough to span several delta frames.
```

## Patch

The patched source is under `/home/ubuntu/projects/spike-flue-celld/ui/patched/agent/src`. Vite resolves `@hachej/boring-agent/front` to that source tree. The upstream checkout was not modified; `git diff --exit-code` over every copied target file is clean. The upstream checkout does contain unrelated pre-existing changes in `packages/agent/src/shared/index.ts` and `packages/agent/src/shared/session.ts`.

Every production change has a unified patch under `/home/ubuntu/projects/spike-flue-celld/patches/01-...` through `12-...`. Harness changes are in `90-...` through `92-...`.

### Exact production line counts

Counts below are from `git apply --numstat patches/0*.patch patches/1*.patch`, not estimates. R1 and R3 deliberately share the stream/reducer/remote hunks: removing client ordering arithmetic is what lets authoritative finals cross missing advisory deltas, so recommendation totals should not be summed independently.

| Recommendation(s) | Patched file | Added | Removed |
|---|---|---:|---:|
| R1, R3 | `front/chat/pi/piChatReducer.ts` | 8 | 28 |
| R1, R3 | `front/chat/pi/piChatStream.ts` | 13 | 24 |
| R1 | `front/chat/pi/piFollowUpQueueController.ts` | 3 | 2 |
| R1, R3 | `front/chat/pi/remotePiSession.ts` | 5 | 8 |
| R1 | `front/chat/piChatPanelUtils.ts` | 3 | 3 |
| R1 | `front/chat/session/composerPolicy.ts` | 3 | 3 |
| R2 | `front/chat/session/usePiSessions.ts` | 10 | 12 |
| R1 | `shared/chat/index.ts` | 1 | 1 |
| R1, R2 | `shared/chat/piChatCommand.ts` | 3 | 3 |
| R1 | `shared/chat/piChatEvent.ts` | 17 | 17 |
| R1, R2 | `shared/chat/piChatSchemas.ts` | 7 | 4 |
| R1 | `shared/chat/piChatSnapshot.ts` | 4 | 1 |
| **Production total** | **12 files** | **77** | **106** |

The production search now returns no matches for numeric `seq`/`cursor`/`lastSeq` declarations, sequence comparisons/increments, or `needsResync`/`expectedSeq`/`actualSeq` in non-test front/shared sources.

### Exact harness line counts

| File | Added | Removed |
|---|---:|---:|
| `ui/vite.config.ts` | 23 | 1 |
| `scripts/wire-playwright.mjs` | 25 | 3 |
| `src/shim.ts` | 1 | 1 |
| **Harness total** | **49** | **5** |

The unchanged copied frontend files are build inputs, not counted as changes.

## What changed

R1 introduces `PiChatCursor = string`. Snapshot/event/receipt schemas accept either a non-empty string or a legacy non-negative integer, immediately normalizing the latter with `String`. From that boundary onward the cursor is opaque. The stream processor always applies a validated frame and stores its cursor, the reducer stores the snapshot/event cursor without ordering checks, the remote session passes it to the events URL, and receipt handling uses token equality rather than numeric ordering.

R2 changes `usePiSessions.create()` into local provisional ref allocation (`draft-${crypto.randomUUID()}`). This keeps existing panel/session-list call sites intact but performs no network create. Initial state hydration and the first prompt address that ref; the server adopts it on prompt and returns the same `sessionId` in the receipt. `PromptReceipt.sessionId` is optional so the patched client still parses old receipts.

R3 is the direct consequence of removing implicit sequence ordering. Missing delta frames no longer prevent a later `message-end` from reaching `commitFinalMessage`; `message-end.final` replaces the partial assistant message canonically. Explicit server 409 replay-range errors still trigger `/state` recovery. Silent frame-number holes no longer do.

## Rollout compatibility — the important part

| Change | Old numeric-seq server | Old client | Safe rollout |
|---|---|---|---|
| R1 cursor representation | **Wire-compatible after the client patch.** Numeric snapshot/event/receipt cursors are accepted and normalized to strings; the browser control run completed at `"8"` and resumed with `?cursor=8`. | **Not compatible with an opaque server.** The old Zod schema rejects string `seq`. | Incremental, client first. Deploy the dual-read/string-internal client, then switch the server to opaque tokens. No flag day is required. The exported TypeScript event/snapshot types do change from `number` to `string`, so package consumers compiling numeric event literals need the client/type update first even though the wire rollout is incremental. |
| R2 implicit creation | Compatible only if the old server already tolerates `GET /state` and `POST /prompt` for an unknown client-chosen ref. A server that 404s unknown refs will break the patched client. | Compatible while the server retains the explicit create route; old clients continue to use it. | Incremental, server first: add unknown-ref state plus prompt adoption and return the addressed ref, while keeping explicit create. Then deploy the client. Remove explicit create only after old clients are gone. Removing create at the same time as adding adoption would require a flag day; the additive sequence does not. |
| R3 final-authoritative/advisory deltas | The no-loss numeric control works, and the drop-deltas proof heals without rehydrate. However, an old numeric server may rely on client numeric-gap recovery for loss of **authoritative** tool/queue/error/lifecycle events. This patch can no longer infer what a missing number represented. | Old clients still gap-abort and rehydrate when the server leaves numeric holes for dropped deltas, so they remain correct but pay the old recovery cost. | The behavior should be capability-gated unless the server already guarantees that only advisory frames can disappear. Safe incremental sequence: server advertises/guarantees authoritative finals plus reliable non-advisory delivery (or separates advisory deltas), then clients disable local gap recovery for that capability. The unconditional client patch proven here is functionally compatible on normal numeric traffic but is **not semantically safe as a blind client-first rollout** against servers that can silently lose authoritative events. |

Bottom line: **R1 can ship incrementally client-first. R2 can ship incrementally server-first if explicit create is retained during migration. R3 needs a negotiated capability or coordinated cutover for safety; cursor opacity alone removes the information needed to prove a numeric hole was delta-only.**

## Verification and limits

- `npm run check:types` in the spike: pass.
- Vite production build against `ui/patched/agent/src/front/index.ts`: pass (3,023 modules transformed).
- Firefox Playwright/in-process fulfillment: opaque cursors, implicit session, dropped deltas, and numeric baseline all pass their executable assertions.
- Four screenshots captured in the required `scratchpad/shots` directory.
- The upstream checkout's TypeScript executable is a broken pnpm link to `/home/ubuntu/node_modules/typescript/bin/tsc`, so a standalone upstream package typecheck could not be run without mutating/installing in the read-only checkout. Vite compiled the patched TypeScript successfully, and the spike's own strict typecheck passes.
- No recommendation remains broken in the exercised browser modes. The unresolved item is rollout safety for R3 when an existing server can silently drop non-advisory events; the client cannot solve that from an opaque token alone.
