# PR #968 → post-#1038 semantic-port ledger

This ledger is the omission-control surface for the selective port. Disposition values are closed and singular: `port`, `adapt`, `superseded`, or `drop`. Completion is independently `complete` or `pending`; a slice may not close while any exact-path row assigned to it is pending. The family tables explain intent, while the exact-path table is the operational closure record. “Reference” means `origin/pr-968` at `2fcd4f31cd312289250f0f72237bc52d6868e110`; destination starts from PR #1038 at `c040838c89c95294a421df4e525a5f2d03185b5e`.

## Production contracts and browser state

| #968 family / paths | Disposition | Post-#1038 destination | Required proof |
| --- | --- | --- | --- |
| `agent/shared/gateway/types.ts` summary/resume/command additions | adapt | Keep summary and boot-create fields; keep #1038 command route/effect contracts | Gateway typecheck + HTTP contract tests |
| `agent/shared/session.ts`, `core/piChatSessionService.ts` | adapt | Workspace-authoritative `SessionCtx`; no `liveSessionScopeId`; freeze native-access policy | storage/auth matrix + cache identity tests |
| `activeSessionStorage.ts` | port | tab-scoped exact boot claim beside shared active preference | two-tab/source-switch tests |
| `usePiSessions.ts` | adapt | addressed-only source adapter; summary metadata, boot claim, source guards, pending rows/rename | hook race suite + addressed E2E |
| `sessionCreationCoordinator.ts`, `useSessionCreationCoordinator.ts` | port | canonical workspace create coordinator | StrictMode/double-create/cancel tests |
| `sessionCreateProtocol.ts` | port | stable invalid-create result error | provider protocol tests |
| `WorkspaceAgentFront.tsx` | adapt | retain #1038 mandatory owner/panes; add attestation, coordinator, action ownership | workspace hook/UI race tests |
| `sessionIdentity.ts` | adapt | retain addressed compound keys; port only complete-ref persistence/fencing fixes absent from #1038 | pane/pin/drag identity tests |
| local-storage/testing session adapters | port | return canonical rows and source attestation | adapter conformance tests |

## Gateway, persistence, and runtime

| #968 family / paths | Disposition | Post-#1038 destination | Required proof |
| --- | --- | --- | --- |
| `embeddedGateway.ts` | adapt | add exact resume to #1038 durable create effect/preflight/digest; retain direct Host ledger/admission | replay/conflict/in-progress + auth matrix |
| `httpProjection.ts` | adapt | addressed-only closed schema; expose no public empty-list switch | route schema tests |
| `sessionInventory.ts` | adapt | storage-only exact authority and pin lookup under shared native-access policy | no-runtime-acquisition + pin tests |
| `sessions.ts` | adapt | native timestamp transcript from birth; hidden empty list; same namespace/legacyDefault paths | all transcript-root/rollback fixtures |
| `nativeSessionTranscript.ts`, `sessionJsonlPrefix.ts`, `piSessionMessages.ts` | port | bounded native JSONL helpers | malformed/large/paginated fixture tests |
| `nativeSessionRename.ts` | port | verified append under canonical store lock | concurrent append/mtime/title tests |
| `createHarness.ts` | adapt | exact-open only; retain #1038 Host lifecycle and one handle | missing/unreadable no-fork + concurrent-open tests |
| `harnessPiChatService.ts` | adapt | one channel, cold history, delete generation, rename policy | cold-open/delete and history tests |
| `codedError.ts`, shared error codes | adapt | project through #1038 `stableServiceError`; no legacy route mapping | stable HTTP error tests |
| `buildAgentComposition.ts`, Host types | adapt | only wiring needed by surviving store/harness capabilities; no compatibility mount | composition/type tests |

## Commands

| #968 family / paths | Disposition | Post-#1038 destination | Required proof |
| --- | --- | --- | --- |
| `useServerCommands.ts` | adapt | #1038 catalog/execute routes; registry ownership, session identity, stale handler fence | hook lifecycle tests |
| deleted legacy `http/routes/commands.ts` | drop | `runtimeCapabilityProjection.ts` + Gateway | contraction scanner |
| #968 Gateway session-command methods/route shape | superseded | #1038 mandatory `requestId`/`sessionId` command effect | metering-before-ledger + replay/conflict tests |
| command handle/session context changes | adapt | runtime capability projection resolves catalog and execution through same pinned binding/`SessionCtx` | cold-open one-handle proof |

## Workspace controls and UX

| #968 family / paths | Disposition | Post-#1038 destination | Required proof |
| --- | --- | --- | --- |
| `AppSessionActionsMenu.tsx`, `InlineSessionRename.tsx` | port | existing addressed session rows | component + keyboard/focus tests |
| `AppLeftPaneSessionRow.tsx`, `AppLeftPane.tsx`, session browser/list | adapt | capability-aware rename/copy/delete without changing #1038 Agent grouping | workspace component tests |
| `ChatPaneStage*`, detached chat, pin/split state | adapt | retain #1038 multi-Agent panes; source/action ownership only | split/Quick/switch E2E |
| `WorkspaceAgentStatusStates.tsx` fatal state | port | addressed source terminal/recoverable error distinction | UI state tests |
| `PiChatComposerSurface.tsx` mobile Stop target | port | unchanged component | 390/639px 44×44 and desktop 32×32 proof |
| attention/presence/working-state adjustments | adapt | only behavior required by canonical session status | focused UI tests |

## Composition and compatibility

| #968 family / paths | Disposition | Post-#1038 destination | Required proof |
| --- | --- | --- | --- |
| `createAgentApp.ts`, `registerAgentRoutes.ts` | drop | deleted by #1038 | negative source/export scan |
| `agentHostLegacyRoute*` | drop | deleted by #1038 | negative source/export scan |
| `legacyPiChatCompatibility.ts` | drop | deleted by #1038 | negative source/export scan |
| legacy `http/routes/piChat.ts` | drop | direct Host addressed projection | route matrix |
| `resolveRequestPrincipal.ts` legacy repair | drop | Host scope verification/issuer context | composition auth matrix |
| `nativeSessionStartEnabled`, `allowNativeUnscopedAccess` composition flags | superseded | one canonical native-access policy in Host/store resolution | trusted-local vs hosted tests |
| `liveSessionScopeId` compatibility bridge | superseded | one addressed workspace-authoritative `SessionCtx` | cache/handle identity tests |
| Core/Workspace/CLI/playground legacy mount edits | superseded | #1038 direct composition | all seven composition proofs |
| app startup/session-root changes that preserve durable host volume | adapt | #1038 root resolvers only | Core `/data/pi-sessions` + CLI root tests |
| scripted playground harness persistence | adapt | addressed direct Host fixture, production-like JSONL | browser restart proof |

## Test and proof families

| #968 test family | Disposition | Destination / proof |
| --- | --- | --- |
| addressed summary-field regression | port | `usePiSessions` test must fail with hardcoded `turnCount: 0` or missing owner/native fields |
| source switch, late refresh/create/delete/rename | adapt | addressed-only hook and Workspace tests |
| creation coordinator StrictMode/settlement/cancel | port | coordinator unit + Workspace integration |
| boot resume tab/agent/API/workspace/storage isolation | adapt | addressed hook + Gateway inventory tests |
| native creation/exact reopen/no duplicate transcript | adapt | store/harness integration |
| malformed JSONL, pagination fill, timestamp ordering | port | native transcript/store suite |
| rename verification and assistant gate | adapt | store + service + UI tests |
| handle/channel single-flight and delete cold-open generation | adapt | harness/service concurrency suites |
| command registry ownership/stale handler/session route | adapt | #1038 route shape + hook/Gateway/runtime capability suites |
| legacy route/principal/native capability tests | drop | replaced by #1038 negative contraction and auth matrices |
| scripted restart/browser proof | adapt | addressed-only workspace playground |
| mobile Stop touch target | port | direct Chromium bounding-box assertion |
| system-prompt-size create-before-prompt regression | adapt | direct Host addressed system-prompt route |
| CLI native transcript lookup fixture | adapt | timestamp-path discovery under direct Host |
| UI-review abort policy | drop | E2E infrastructure, not product/session semantics |

## Stacking disposition

| PR | Disposition |
| --- | --- |
| #1038 | stacked base; must be green/frozen before final proof |
| #976 | already merged through Wave 1 / #1008 and contained by #1038 |
| #982 | already merged through Wave 1 / #1008 and contained by #1038 |
| #968 | immutable semantic reference; superseded after this follow-up is proven |


## Exact production-path coverage

Source command: `git diff --name-only 1f1cb8264...2fcd4f31c`, filtered only for docs, tests/specs, E2E artifacts, images/HTML, and `pnpm-lock.yaml`. The resulting 96 production paths are listed exactly once below. `pending` rows keep Slice 4 open; every other row has a single closed disposition.

| Exact #968 production path | Disposition | Slice | Completion | Evidence |
| --- | --- | --- | --- | --- |
| `apps/agent-playground/src/server/agentHost.ts` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `apps/full-app/scripts/remote-worker-smoke.mjs` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `apps/full-app/src/front/main.tsx` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `apps/full-app/src/server/dev.ts` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `apps/full-app/src/server/main.ts` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `apps/workspace-playground/peek.mjs` | drop | S4 | complete | cutover contraction matrix / policy supersession |
| `apps/workspace-playground/peek3.mjs` | drop | S4 | complete | cutover contraction matrix / policy supersession |
| `apps/workspace-playground/repro-first-send.mjs` | drop | S4 | complete | cutover contraction matrix / policy supersession |
| `apps/workspace-playground/repro-poll.mjs` | drop | S4 | complete | cutover contraction matrix / policy supersession |
| `apps/workspace-playground/repro-popover.mjs` | drop | S4 | complete | cutover contraction matrix / policy supersession |
| `apps/workspace-playground/scripts/bridge-e2e.ts` | drop | S4 | complete | cutover contraction matrix / policy supersession |
| `apps/workspace-playground/src/eval/run.ts` | drop | S4 | complete | cutover contraction matrix / policy supersession |
| `apps/workspace-playground/src/front/App.tsx` | adapt | S4 | pending | addressed browser/scripted proof not yet recorded |
| `apps/workspace-playground/src/server/dev.ts` | adapt | S4 | pending | addressed browser/scripted proof not yet recorded |
| `apps/workspace-playground/src/server/testing/scriptedPiHarness.ts` | adapt | S4 | pending | addressed browser/scripted proof not yet recorded |
| `packages/agent/examples/with-custom-tool/server.ts` | drop | S3 | complete | cutover contraction matrix / policy supersession |
| `packages/agent/scripts/eval-provisioning-agent-vercel.mts` | drop | S3 | complete | cutover contraction matrix / policy supersession |
| `packages/agent/scripts/eval-provisioning-agent.mts` | drop | S3 | complete | cutover contraction matrix / policy supersession |
| `packages/agent/scripts/eval.ts` | drop | S3 | complete | cutover contraction matrix / policy supersession |
| `packages/agent/scripts/smoke-capability-readiness-vercel.mts` | drop | S3 | complete | cutover contraction matrix / policy supersession |
| `packages/agent/scripts/smoke-capability-readiness.mts` | drop | S3 | complete | cutover contraction matrix / policy supersession |
| `packages/agent/src/bin/boring-agent.ts` | superseded | S3 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/agent/src/core/piChatSessionService.ts` | superseded | S3 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/agent/src/front/chat/PiChatPanel.tsx` | superseded | S3 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/agent/src/front/chat/components/PiChatComposerSurface.tsx` | adapt | S4 | complete | branch implementation + Agent/Workspace focused/full tests |
| `packages/agent/src/front/chat/pi/remotePiSession.ts` | superseded | S3 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/agent/src/front/chat/piChatPanelHooks.ts` | superseded | S3 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/agent/src/front/chat/session/activeSessionStorage.ts` | port | S2 | complete | branch implementation + focused package tests |
| `packages/agent/src/front/chat/session/index.ts` | superseded | S3 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/agent/src/front/chat/session/usePiSessions.ts` | adapt | S4 | complete | branch implementation + Agent/Workspace focused/full tests |
| `packages/agent/src/front/hooks/useServerCommands.ts` | adapt | S4 | complete | branch implementation + Agent/Workspace focused/full tests |
| `packages/agent/src/front/index.ts` | superseded | S3 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/agent/src/server/agent-host/buildAgentComposition.ts` | superseded | S3 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/agent/src/server/agent-host/embeddedGateway.ts` | adapt | S2 | complete | branch implementation + Agent/Workspace focused/full tests |
| `packages/agent/src/server/agent-host/httpProjection.ts` | adapt | S2 | complete | branch implementation + Agent/Workspace focused/full tests |
| `packages/agent/src/server/agent-host/legacyPiChatCompatibility.ts` | drop | S3 | complete | cutover contraction matrix / policy supersession |
| `packages/agent/src/server/agent-host/sessionInventory.ts` | superseded | S3 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/agent/src/server/agent-host/types.ts` | superseded | S3 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/agent/src/server/agentHostLegacyRouteMount.ts` | drop | S3 | complete | cutover contraction matrix / policy supersession |
| `packages/agent/src/server/agentHostLegacyRouteOptions.ts` | drop | S3 | complete | cutover contraction matrix / policy supersession |
| `packages/agent/src/server/agentHostLegacyRouteRuntime.ts` | drop | S3 | complete | cutover contraction matrix / policy supersession |
| `packages/agent/src/server/codedError.ts` | port | S3 | complete | branch implementation + focused package tests |
| `packages/agent/src/server/createAgent.ts` | superseded | S3 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/agent/src/server/createAgentApp.ts` | drop | S3 | complete | cutover contraction matrix / policy supersession |
| `packages/agent/src/server/dev.ts` | superseded | S3 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts` | adapt | S2 | complete | branch implementation + Agent/Workspace focused/full tests |
| `packages/agent/src/server/harness/pi-coding-agent/nativeSessionRename.ts` | port | S2 | complete | branch implementation + focused package tests |
| `packages/agent/src/server/harness/pi-coding-agent/nativeSessionTranscript.ts` | port | S2 | complete | branch implementation + focused package tests |
| `packages/agent/src/server/harness/pi-coding-agent/piSessionMessages.ts` | port | S2 | complete | branch implementation + focused package tests |
| `packages/agent/src/server/harness/pi-coding-agent/sessionJsonlPrefix.ts` | port | S2 | complete | branch implementation + focused package tests |
| `packages/agent/src/server/harness/pi-coding-agent/sessions.ts` | adapt | S2 | complete | branch implementation + Agent/Workspace focused/full tests |
| `packages/agent/src/server/http/middleware.ts` | superseded | S3 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/agent/src/server/http/requestPrincipal.ts` | drop | S3 | complete | cutover contraction matrix / policy supersession |
| `packages/agent/src/server/http/routes/commands.ts` | drop | S3 | complete | cutover contraction matrix / policy supersession |
| `packages/agent/src/server/http/routes/piChat.ts` | drop | S3 | complete | cutover contraction matrix / policy supersession |
| `packages/agent/src/server/pi-chat/harnessPiChatService.ts` | adapt | S3 | complete | branch implementation + Agent/Workspace focused/full tests |
| `packages/agent/src/server/registerAgentRoutes.ts` | drop | S3 | complete | cutover contraction matrix / policy supersession |
| `packages/agent/src/shared/error-codes.ts` | adapt | S3 | complete | branch implementation + Agent/Workspace focused/full tests |
| `packages/agent/src/shared/gateway/types.ts` | adapt | S2 | complete | branch implementation + Agent/Workspace focused/full tests |
| `packages/agent/src/shared/harness.ts` | adapt | S3 | complete | branch implementation + Agent/Workspace focused/full tests |
| `packages/agent/src/shared/index.ts` | superseded | S3 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/agent/src/shared/session.ts` | adapt | S2 | complete | branch implementation + Agent/Workspace focused/full tests |
| `packages/cli/src/front/App.tsx` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/cli/src/server/modeApps.ts` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/core/src/app/front/chatFirst/ChatFirstAuthenticatedShell.tsx` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/workspace/src/app/front/WorkspaceAgentFront.tsx` | adapt | S1 | complete | branch implementation + Agent/Workspace focused/full tests |
| `packages/workspace/src/app/front/WorkspaceAgentStatusStates.tsx` | adapt | S4 | pending | addressed browser/scripted proof not yet recorded |
| `packages/workspace/src/app/front/WorkspaceShellCapabilitiesHost.tsx` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/workspace/src/app/front/index.ts` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/workspace/src/app/front/localStorageSessions.ts` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/workspace/src/app/front/sessionCreationCoordinator.ts` | port | S1 | complete | branch implementation + focused package tests |
| `packages/workspace/src/app/front/useSessionCreationCoordinator.ts` | port | S2 | complete | branch implementation + focused package tests |
| `packages/workspace/src/app/front/useWorkspaceShellCapabilitiesController.ts` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/workspace/src/app/server/createWorkspaceAgentServer.ts` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/workspace/src/front/attention/WorkspaceAttentionProvider.tsx` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/workspace/src/front/chrome/chat/DetachedChatPopover.tsx` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/workspace/src/front/chrome/chat/types.ts` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/workspace/src/front/chrome/session-list/SessionBrowser.tsx` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/workspace/src/front/components/SessionList.tsx` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/workspace/src/front/layout/ChatPaneStage.tsx` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/workspace/src/front/layout/ChatPaneStageDock.tsx` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/workspace/src/front/layout/plugin-tabs/AppLeftPane.tsx` | adapt | S4 | complete | branch implementation + Agent/Workspace focused/full tests |
| `packages/workspace/src/front/layout/plugin-tabs/AppLeftPaneSessionRow.tsx` | adapt | S4 | complete | branch implementation + Agent/Workspace focused/full tests |
| `packages/workspace/src/front/layout/plugin-tabs/AppSessionActionsMenu.tsx` | port | S2 | complete | branch implementation + focused package tests |
| `packages/workspace/src/front/layout/plugin-tabs/InlineSessionRename.tsx` | port | S2 | complete | branch implementation + focused package tests |
| `packages/workspace/src/front/sessionCreateProtocol.ts` | port | S1 | complete | branch implementation + focused package tests |
| `packages/workspace/src/front/sessionIdentity.ts` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/workspace/src/front/testing/createLocalStorageSessions.ts` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/workspace/src/front/testing/createMockSessions.ts` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `packages/workspace/src/index.ts` | superseded | S4 | complete | PR #1038 addressed-only composition retained; no #968 delta needed |
| `plugins/bi-dashboard/playground/run-eval.ts` | drop | S4 | complete | cutover contraction matrix / policy supersession |
| `plugins/bi-dashboard/playground/src/server.ts` | drop | S4 | complete | cutover contraction matrix / policy supersession |
| `plugins/boring-mcp/src/server/appServerBinding.ts` | drop | S4 | complete | cutover contraction matrix / policy supersession |
| `plugins/generated-pane/playground/run-eval.ts` | drop | S4 | complete | cutover contraction matrix / policy supersession |
| `tools/ui-review/src/review-specs/workspace-command-palette/spec.ts` | drop | S4 | complete | cutover contraction matrix / policy supersession |
