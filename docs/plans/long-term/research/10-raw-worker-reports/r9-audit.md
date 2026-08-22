## A. `packages/agent/src/server/pi-chat/**`

Source: `origin/main` at `e546c3807687890b55538cddb3e275ff60981905`. Production total: 4,025 lines. Tests are listed separately and excluded from the summary.

| file | lines | verdict | superseded by | risk/caveat |
|---|---:|---|---|---|
| `packages/agent/src/server/pi-chat/PiAgentSessionAdapter.ts` | 141 | REPLACE | Narrow adapter over pi `AgentSession` whose initial `messages` come from the host record | Keep prompt/abort/model access. Remove `readSnapshot()` as a competing truth and private queue reconciliation. |
| `packages/agent/src/server/pi-chat/harnessPiChatService.ts` | 1,315 | REPLACE | Canonical host conversation record, durable submission runner, opaque cursor | This is the F1 center. Preserve access checks, attachments, transport commands, lifecycle, and billing seam. |
| `packages/agent/src/server/pi-chat/metering.ts` | 835 | REPLACE | Durable admission/outcome/usage records | Keep the host billing sink and policy types. Replace the volatile event-correlating coordinator. |
| `packages/agent/src/server/pi-chat/piChatEvents.ts` | 583 | REPLACE | Projection from canonical/native events; writer assigns cursor | Keep UI/tool/error projection. Delete `agent_end` final reconstruction when `message-end.final` is authoritative. |
| `packages/agent/src/server/pi-chat/piChatHistory.ts` | 258 | KEEP | — | Host wire/UI projection, including attachment URLs. It may shrink once canonical records store projected messages; it is not itself a second durable store. |
| `packages/agent/src/server/pi-chat/piChatMessageMetadataReconciler.ts` | 404 | DELETE | Admitted submission record with stable submission ID, display text, files, nonce, and queue outcome | Entire file reattaches missing identity by text/order in volatile maps. |
| `packages/agent/src/server/pi-chat/piChatReplayBuffer.ts` | 144 | DELETE | Canonical durable record subscription with opaque resume cursor | Entire numeric seq/gap/ahead window is a second replay authority. A non-replaying subscriber fanout may remain elsewhere. |
| `packages/agent/src/server/pi-chat/piChatServiceLifecycle.ts` | 77 | KEEP | — | Host process lifecycle, drain, and late-adapter ownership fencing. |
| `packages/agent/src/server/pi-chat/piChatSnapshot.ts` | 79 | REPLACE | Snapshot projection from canonical record at an opaque cursor | Remove synthetic queue IDs/hash, caller-supplied integer seq, and live pi snapshot authority. |
| `packages/agent/src/server/pi-chat/piSessionIdentity.ts` | 189 | KEEP | Host `SessionRepo` metadata/tenancy implementation | No production consumer/export was found. UNSURE: intended public/next-repo API or dead code? Delete only if the replacement repo demonstrably owns its access semantics. |

### A1. `harnessPiChatService.ts` function disposition

| function/group | source lines | verdict | concrete change | risk/caveat |
|---|---:|---|---|---|
| `HarnessPiChatServiceOptions` | 61-87 | REPLACE | Replace `eventStore` with required canonical record writer/repo; retain metering, event projection, attachment URL | Do not make canonical durability optional. |
| constructor state: `channels`, `channelCreations`, `sessionGenerations` | 89-126 | REPLACE | Collapse transcript/live/replay ownership into record-backed session handle | Single-flight and incarnation fencing still matter, but should guard one owner. |
| `messageMetadata` field | 102 | DELETE | Stable admitted-record identity | Direct dependency on deleted reconciler. |
| `syntheticPromptFailures`, `activeSyntheticPromptErrors` | 104-105 | DELETE | Exactly one durable terminal outcome | Synthetic snapshot repair is no longer canonical. |
| `liveAttachments` | 106-110 | KEEP | — | Host attachment bytes/URL projection. Bound memory or spill to tenant storage. |
| `lifecycle`, `disposePromise` | 111-113 | KEEP | — | Host resource ownership. |
| `flushMetering` | 128-131 | REPLACE | Flush durable usage/outcome writer | Diagnostic seam remains. |
| `dispose`, `disposeService` | 133-195 | REPLACE | Drain active runner/writer and native agent; remove replay/reconciler cleanup | Abort, metering flush, unsubscribe, and handle ownership remain load-bearing. |
| `listSessions` | 197-199 | KEEP | Delegate to tenant-aware `SessionRepo` | Preserve authorized `SessionCtx`. |
| `createSession` | 201-203 | REPLACE | Prefer implicit creation on first durable submission | If explicit empty sessions remain an API feature, repo creation is still host-owned. |
| `deleteSession`, `deleteSessionBeforeDispose` | 205-245 | REPLACE | Durable delete/tombstone through repo, then retire native handle | Preserve pre-delete access check and incarnation fence. |
| `readAttachment` | 247-258 | KEEP | — | Host authorization and binary transport. |
| `readState` | 260-262 | KEEP | Transport-facing responsibility remains | Implementation changes below. |
| `readStateBeforeDispose` | 264-303 | REPLACE | Read one canonical record snapshot and opaque cursor | Delete `Math.max(persisted.seq, liveSeq)` at 281-290. |
| `persistedStateDropsLiveMessages` | 314-321 | DELETE | One truth has no persisted-vs-live arbitration | Explicit F1 reconciliation. |
| `canRefreshFromPersistedState` | 323-331 | DELETE | One truth has no safe-refresh heuristic | It probes live queue/stream state to decide which truth wins. |
| `harnessMayHaveLiveSession` | 333-337 | REPLACE | Ask record-backed session registry only for handle liveness | Must not decide state authority. |
| `attachmentUrlFor` | 339-364 | KEEP | — | Host attachment projection. Fix indentation separately only if touching. |
| `readPersistedState` | 366-385 | REPLACE | Read canonical record/repo projection | Delete raw `loadEntries`, reconstructed history, and durable integer seq lookup. |
| `subscribe` | 387-389 | KEEP | Transport-facing responsibility remains | Cursor type becomes opaque. |
| `subscribeBeforeDispose` | 391-397 | REPLACE | Subscribe from opaque canonical cursor | Delete replay-buffer range semantics. |
| `prompt` | 399-401 | KEEP | Host command responsibility remains | Admission mechanism changes below. |
| `promptBeforeDispose` | 403-445 | REPLACE | Durably admit submission before native execution; return durable receipt | Timeout after admission is outcome-uncertain, not safe rollback/retry. |
| `followUp` | 447-449 | KEEP | Host command responsibility remains | pi queue executes it; host records it. |
| `followUpBeforeDispose` | 451-494 | REPLACE | Durable queue submission keyed by stable ID | Remove volatile metadata/metering duplicate inference. |
| `clearQueue` | 496-498 | KEEP | Host control responsibility remains | Selective-cancel contract must be explicit. |
| `clearQueueBeforeDispose` | 500-518 | REPLACE | Durable cancellation outcome plus pi queue control | Do not delete before public/native selective cancel is available or emulated safely. |
| `interrupt` | 520-522 | KEEP | Host control responsibility remains | Transport/governance. |
| `interruptBeforeDispose` | 524-542 | REPLACE | Durable control record; native steering/follow-up primitive | Remove fabricated numeric receipt cursor. |
| `stop` | 544-546 | KEEP | Host control responsibility remains | Transport/governance. |
| `stopBeforeDispose` | 548-564 | REPLACE | Durable control record and one terminal outcome | Preserve distinction between user stop and uncertain provider effect. |
| `clearAllFollowUps` | 566-572 | DELETE | Native queue API plus durable cancellation record | Depends on adapter compatibility bookkeeping. |
| `nextFollowUpForInterrupt` | 574-580 | DELETE | Durable queue order/identity | Currently rebuilds synthetic queue entries from text. |
| `autoPostInterruptedFollowUp` | 582-654 | REPLACE | Runner executes next admitted queue item at least once | Must re-enter recorded submitter auth context. |
| `runPrompt` | 656-661 | REPLACE | At-least-once runner over exactly-once record | Never blindly retry uncertain side effects. |
| `trackActiveRun` | 663-670 | REPLACE | Durable runner lease/terminal tracking | Process-local promise map is not restart-safe. |
| `clearAutoPostedFollowUpForFallback` | 672-687 | DELETE | Durable submission state | Fallback repair for competing queue truths. |
| `canClearAutoPostedFollowUpForFallback` | 689-691 | DELETE | Durable submission state | Same. |
| `enrichSyntheticPromptFailures` | 693-703 | DELETE | Canonical terminal records | Snapshot fabrication. |
| `publishAutoPostedFollowUpRunError` | 705-729 | REPLACE | Append one terminal failure outcome | Keep stable UI error projection, not synthetic merging. |
| `publishChannelEvents` | 731-766 | REPLACE | Writer transaction assigns opaque cursor and then fans out | Current path dual-writes event store and replay buffer. |
| `publishChannelEventSync` | 768-785 | REPLACE | Publish committed canonical record event | Do not expose uncommitted events as accepted. |
| `publishPromptRunError` | 787-819 | REPLACE | Durable rejected/terminal record | Preserve stable error code and displayed failed prompt. |
| `runAndDrainPublishQueue` | 821-836 | REPLACE | Await canonical writer/runner terminalization | Current promise queue is process-local. |
| `drainPublishQueue` | 838-840 | REPLACE | Writer drain | Same. |
| `getAdapter` | 842-874 | REPLACE | Resolve record-backed pi agent handle | Preserve request/tenant/auth context construction. |
| `getChannel` | 876-885 | REPLACE | Resolve canonical subscription handle | No replay-buffer ownership. |
| `ensureChannel` | 887-894 | REPLACE | Ensure one record-backed session execution handle | Keep single-flight semantics. |
| `createChannelOnce` | 896-918 | REPLACE | Single-flight native agent creation backed by repo messages | Preserve deletion fence. |
| `generationOf`, `assertSessionIncarnation` | 920-934 | KEEP | — | Host race fence preventing late resurrection after delete. |
| `buildChannel` | 936-989 | REPLACE | Subscribe pi events into canonical writer; no second replay buffer | Event projection may remain. |
| `readDurableLatestPiChatSeq` | 991-1005 | DELETE | Opaque record cursor | Numeric tail inference is second-store glue. |
| `hydrateDurableReplayBuffer` | 1007-1069 | DELETE | Canonical record reader | Entire function rehydrates competing replay state and has legacy seq fallback. |
| `ensurePiSessionBound` | 1071-1085 | REPLACE | Bind repo-backed pi `Agent(messages)` | Keep trusted host seam and access check. |
| `assertCanAccessSession` | 1087-1093 | KEEP | — | Tenant authorization. |
| `sessionKey` | 1095-1097 | KEEP | — | Cache isolation. Ensure runtime-scope identity is included by replacement. |
| `AutoPostFollowUpError`, `promptCancelledError` | 1101-1112 | REPLACE | Typed runner outcome: rejected/cancelled/unknown | Preserve stable code semantics. |
| `deferred`, `rejectedReasons` | 1114-1125 | KEEP | — | Generic lifecycle helpers, if still used. |
| `normalizeSessionAccessError`, `isPlainSessionNotFound` | 1128-1142 | KEEP | — | Stable host error projection. |
| `nextPromptReceiptCursor` | 1144-1146 | DELETE | Writer-issued opaque cursor | Fabricates `(latestSeq + 1)`. |
| `promptPayloadFileParts`, `promptPayloadMessage` | 1148-1174 | REPLACE | Canonical admitted submission projection | Keep attachment/display responsibility; writer supplies stable IDs/time. |
| `mergeSyntheticMessages`, `messageTime` | 1176-1196 | DELETE | Canonical ordered record | Pure snapshot repair. |
| `toPiPromptInput`, `promptImagesFromAttachments` | 1198-1236 | KEEP | — | Host workspace attachment loading and size limit. |
| `isWorkspaceImageAttachment`, `detectPromptImageMimeType` | 1238-1266 | KEEP | — | Host binary validation. |
| `removedFollowUps` | 1268-1281 | DELETE | Durable stable queue IDs | Text multiset diff is reconciliation. |
| `toSessionCtx` | 1283-1296 | KEEP | — | Load-bearing workspace/storage partitioning. |
| `liveAttachmentKey`, `attachmentBytes` | 1298-1311 | KEEP | — | Host attachment cache/decoding. |
| `sessionCacheKey` | 1313-1315 | REPLACE | Canonical tenant/runtime-scope key helper | Current key omits `runtimeScopeIdentity`; replacement must align with harness/repo authority. |

### A2. `metering.ts` function disposition

| function/group | source lines | verdict | concrete change | risk/caveat |
|---|---:|---|---|---|
| `AgentMeteringSink` and metering DTOs | 27-128 | KEEP | Move unchanged or version as host billing boundary | Host pricing, credits, and hard stops are not pi-owned. |
| logger | 130-134 | KEEP | — | Host observability. |
| `MeteringRun`, `SessionMeteringState` | 136-191 | REPLACE | Persist submission/run/usage/terminal state | Volatile arrays and sets are lost on restart. |
| `promptRunId`, `followUpRunId` | 193-203 | REPLACE | Canonical submission ID/digest | Preserve idempotency across tenants and retries. |
| `followUpMatches`, `takeQueuedFollowUp` | 205-221 | DELETE | Stable submission ID | Selector/text/sequence correlation should disappear. |
| `normalizeMeteringUsage` helpers | 223-250 | KEEP | — | Defensive provider-usage normalization. |
| reserve input DTOs | 252-268 | KEEP | Extend with canonical submission/tenant identity | Host billing contract. |
| `PiChatMeteringCoordinator` | 270-835 | REPLACE | Durable metering projection driven by admitted/usage/terminal records | Exactly-one settlement/release must survive restart. |
| `reservePrompt`, `reserveFollowUp` | 297-335 | REPLACE | Atomically admit request and reserve billing before execution | Avoid separate volatile registration plus sink call. |
| `materializeReservation` | 337-364 | REPLACE | Durable transaction/state transition | Current promise chaining is process-only. |
| `hasPromptRun`, `hasFollowUpRun` | 366-385 | REPLACE | Query durable runner state | Avoid session-local nonce memory as truth. |
| `failPromptRun`, `failFollowUpRun` | 387-416 | REPLACE | Append exactly one terminal failure | Do not infer from missing event. |
| stop/release methods | 418-494 | REPLACE | Durable cancellation/terminal transition | Preserve user-stop billing policy and queue-clear reason. |
| `observe` | 496-561 | DELETE | Canonical usage and terminal records | Event-order inference is the core volatile reconciliation. |
| `consumeFollowUp` | 563-570 | DELETE | Durable queue submission consumption record | No FIFO/text correlation. |
| `flush` | 572-579 | REPLACE | Flush durable writer | Keep diagnostic API. |
| usage harvest/dedup methods | 581-684 | REPLACE | Exactly-once usage record keyed by native message/attempt | Preserve agent-end fallback only if native API lacks an authoritative usage terminal. |
| run construction/reservation helpers | 686-739 | REPLACE | Runner-owned durable run record | Process-local instance IDs are insufficient after crash. |
| `finishRun`, `release` | 741-803 | REPLACE | Atomic exactly-one terminal outcome | Preserve nuanced billed/zero/failed-write/user-stop policy as decision logic. |
| `enqueue`, `sessionState`, `pruneSession` | 805-834 | DELETE | Durable transaction/worker | Promise chain and in-memory cleanup are not persistence. |

### A3. Other A function disposition

| file/function | source lines | verdict | concrete change | risk/caveat |
|---|---:|---|---|---|
| `PiAgentSessionAdapter.readSnapshot` | 86-100 | DELETE | Initial messages + record projection | Live session must not be a snapshot authority. |
| `PiAgentSessionAdapter.subscribe` | 102-104 | KEEP | Feed native lifecycle into writer/projector | Events are inputs, not durable truth. |
| adapter `prompt`, `abort`, retry methods | 106-116 | KEEP | — | Native execution controls. |
| adapter `followUp`, `clearFollowUp` | 118-126 | REPLACE | Public native queue API plus durable submission state | Current compat layer reaches private fields. |
| adapter model/state getters | 128-139 | KEEP | — | Live capability/status only; do not use for durable reconstruction. |
| `PiChatEventMapper.event` seq assignment | 152-155 | REPLACE | Writer-issued opaque cursor | Mapper should not own resume position. |
| `mapAgentEndFinalAssistant` / final fallback | 281-356 | DELETE | Authoritative `message-end.final` | Verify failure/abort paths include final before removal. |
| remaining `PiChatEventMapper` projection | 1-582 excluding above | KEEP | Project native tool/message/error/file changes into host DTOs | Simplify IDs only after canonical schema is fixed. |
| `buildPiChatHistory` and helpers | 1-258 | KEEP | Canonical-to-UI or legacy-import projection | Runtime raw-JSONL use should end; legacy importer may retain it temporarily. |
| `PiChatMessageMetadataReconciler` all methods | 22-404 | DELETE | Stable durable submission identity | No partial survivor identified. |
| `PiChatReplayBuffer` all methods | 30-144 | DELETE | Canonical cursor subscription | No partial survivor identified. |
| `HarnessPiChatServiceLifecycle` all methods | 4-77 | KEEP | — | Host shutdown/race ownership. |
| `buildPiChatQueuedFollowUps` | 16-38 | DELETE | Durable queue records | Synthetic hash/ordinal IDs are not stable identity. |
| `buildPiChatSnapshot` | 58-79 | REPLACE | Canonical projection | Status/message/queue DTO responsibility remains. |
| `PiSessionRepository` interface | 30-34 | REPLACE | pi portable `SessionRepo` plus host authorization wrapper | Avoid parallel repository abstractions. |
| `PiSessionMetadataIndex` | 37-42 | KEEP | Tenant metadata may remain host-owned | Could be folded into one host repo. |
| `InMemoryPiSessionMetadataIndex` | 53-73 | KEEP | Test/dev backend | Dead-code question remains. |
| `PiSessionIdentityService` | 80-159 | KEEP | Host authorization/metadata service | Replace repository dependency only. |
| identity helpers | 161-189 | KEEP | — | Tenant ownership and summary projection. |

### A4. Test fallout, excluded from production totals

| file | lines | verdict | change |
|---|---:|---|---|
| `packages/agent/src/server/pi-chat/__tests__/PiAgentSessionAdapter.test.ts` | 150 | REPLACE | Test narrow adapter; remove live-snapshot authority/private queue assumptions. |
| `packages/agent/src/server/pi-chat/__tests__/harnessPiChatService.concurrency.test.ts` | 157 | REPLACE | Retain incarnation/single-writer tests against record-backed handle. |
| `packages/agent/src/server/pi-chat/__tests__/harnessPiChatService.eventStore.test.ts` | 543 | DELETE/REPLACE | Delete second-store hydration/seq tests; replace with canonical writer/cursor tests. |
| `packages/agent/src/server/pi-chat/__tests__/harnessPiChatService.realLoop.test.ts` | 813 | REPLACE | Keep end-to-end pi loop/host projection proof. |
| `packages/agent/src/server/pi-chat/__tests__/harnessPiChatService.test.ts` | 1,674 | REPLACE | Delete persisted/live arbitration, synthetic failure, and numeric cursor cases. |
| `packages/agent/src/server/pi-chat/__tests__/metering.test.ts` | 1,436 | REPLACE | Retain billing policy cases against durable state machine. |
| `packages/agent/src/server/pi-chat/__tests__/piChatEvents.test.ts` | 494 | REPLACE | Delete `agent_end` final reconstruction tests after authoritative-final guarantee. |
| `packages/agent/src/server/pi-chat/__tests__/piChatHistory.test.ts` | 187 | KEEP | Host projection/legacy import tests. |
| `packages/agent/src/server/pi-chat/__tests__/piChatReplayBuffer.test.ts` | 80 | DELETE | Deleted primitive. |
| `packages/agent/src/server/pi-chat/__tests__/piChatSnapshot.test.ts` | 184 | REPLACE | Canonical snapshot/opaque cursor tests. |
| `packages/agent/src/server/pi-chat/__tests__/piSessionIdentity.test.ts` | 146 | KEEP/UNSURE | Retain if service is intended API; otherwise remove with dead production file. |

## B. `packages/agent/src/server/harness/pi-coding-agent/**`

Production total: 3,146 lines. Tests are listed separately and excluded from the summary.

| file | lines | verdict | superseded by | risk/caveat |
|---|---:|---|---|---|
| `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts` | 836 | REPLACE | pi `Agent(messages)` + host record writer, or injected portable `SessionStorage`/`SessionRepo` | Keep model/auth/resource/tool/context composition. Replace file-specific `PiSessionStore`/`SessionManager.open` and duplicate handle incarnation state. |
| `packages/agent/src/server/harness/pi-coding-agent/nativeSessionRename.ts` | 139 | DELETE | Repo metadata rename / canonical record append | Raw JSONL append verification and mtime repair. |
| `packages/agent/src/server/harness/pi-coding-agent/nativeSessionTranscript.ts` | 124 | DELETE | Repo summaries/indexes | Manual full/tail JSONL scan. |
| `packages/agent/src/server/harness/pi-coding-agent/piFollowUpQueueCompat.ts` | 212 | DELETE | Native queue plus durable queue submission/outcome | Private `_followUpMessages`, `_emitQueueUpdate`, and `agent.followUpQueue.messages`. Selective cancel is a blocker. |
| `packages/agent/src/server/harness/pi-coding-agent/piSessionMessages.ts` | 50 | DELETE | Canonical projection/pi message types | Only production consumer is deleted transcript scanner; helpers are duplicated in `sessions.ts`. |
| `packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts` | 230 | REPLACE (scope UNSURE) | Prefer pi `DefaultResourceLoader` extension/package discovery if legacy export compatibility is reproduced | It loads legacy `AgentTool` default/`tools` exports; equivalence with pi extension factories/packages is not established. Decide compatibility before removal. |
| `packages/agent/src/server/harness/pi-coding-agent/resourceSettingsManager.ts` | 63 | KEEP | — | Host in-memory package-policy overlay preventing global/project settings mutation. |
| `packages/agent/src/server/harness/pi-coding-agent/sessionJsonlPrefix.ts` | 34 | DELETE | Repo/storage API | Manual bounded prefix parser; duplicated in `sessions.ts`. |
| `packages/agent/src/server/harness/pi-coding-agent/sessionReadability.ts` | 34 | DELETE | Repo/native loader validation | No production caller; tests only. |
| `packages/agent/src/server/harness/pi-coding-agent/sessions.ts` | 1,312 | REPLACE | Tenant-aware implementation of pi `SessionStorage`/`SessionRepo` plus canonical record | Preserve tenancy, namespace, runtime pin, attachment authorization, list/title semantics; delete wrapper/raw JSONL mechanism. |
| `packages/agent/src/server/harness/pi-coding-agent/tool-adapter.ts` | 112 | KEEP | — | Host custom-tool auth context, Workspace/Operations boundary, telemetry, and pi error bridging. |

### B1. `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts` function disposition

| function/group | source lines | verdict | concrete change | risk/caveat |
|---|---:|---|---|---|
| system prompt guidelines | 57-96 | KEEP | — | Host runtime guidance, not prompt-template duplication. |
| `PiHarnessOptions`, defaults | 98-156 | KEEP | — | `noSkills`/`noContextFiles` are hosted isolation policy. |
| `buildDynamicPromptExtension` | 160-170 | KEEP | — | Uses pi extension lifecycle. |
| `buildToolErrorResultExtension` | 172-183 | KEEP | — | Preserves host tool error semantics through pi. |
| model/metered command errors | 186-211 | KEEP | — | Host policy and billing guard. |
| model resolution helpers | 213-246 | KEEP | — | Host policy over pi registry. |
| session-context normalization/cache key | 248-270 | KEEP | — | Tenant/runtime isolation. |
| `applyRequestedSessionOptions` | 272-292 | KEEP | — | Uses native model/thinking setters. |
| attachment naming helpers | 294-317 | KEEP | — | Host upload/storage behavior. |
| `deriveSourcePlugin`, `normalizeSlashCommandInfo` | 319-354 | KEEP | — | Browser-safe source attribution. |
| `rememberQueuedFollowUpRunContexts` | 356-381 | UNSURE | Recorded-submitter context re-entry in durable runner | Delete only if queue execution reliably restores the submitting authorization context without wrapping private `agent.followUp`. |
| `updateRunContextStateFromPiEvent` | 383-395 | UNSURE | Same | Required today because pi drains queue outside ALS scope. |
| `createPiCodingAgentHarness` composition shell | 397-466 | KEEP | Replace storage dependency only | Host tools/resources/runtime policy. |
| `piSessionCreations`, `sessionGenerations` | 467-478 | REPLACE | Repo-backed handle registry/single-flight | Incarnation fence remains required. |
| `getOrCreatePiSession` | 480-516 | REPLACE | Repo loads canonical messages then constructs one pi agent | Preserve tenant key and deletion fence. |
| `bindRunContext` | 518-520 | KEEP | — | Tool/command authorization context. |
| `createRunBoundAdapter` | 522-538 | REPLACE | Narrow adapter + recorded submitter context | Remove queue compat/private control. |
| `createPiSession` model/auth section | 540-558 | KEEP | — | Pi owns auth/model registry. |
| `createPiSession` file transcript open | 559-588 | DELETE | `SessionRepo`/`Agent(messages)` | No raw saved filename or `SessionManager.open`. |
| `createPiSession` resource loader | 589-644 | KEEP | — | Correct use of pi native discovery/progressive disclosure. |
| `createPiSession` native construction | 646-680 | REPLACE | Build pi agent from canonical message array and writer | Keep custom tools and resource loader. |
| reload/dispose helpers | 682-712 | KEEP | Adapt to new handle type | Host lifecycle. |
| command handle lookup | 714-726 | REPLACE | Repo-backed handle lookup | Preserve exact tenant identity; no cross-key scan. |
| `sessionStore.delete` monkeypatch | 728-738 | DELETE | Repo lifecycle hook | Storage method mutation is brittle; deletion should retire handle through owner. |
| returned harness identity/session store | 741-758 | REPLACE | Expose repo-backed session service | Keep `hasPiSession` diagnostic semantics if needed. |
| resource diagnostics | 760-797 | KEEP | — | Host/browser projection of native diagnostics. |
| `reloadSession` | 799 | KEEP | — | Native reload. |
| `getSlashCommands`, `executeSlashCommand` | 801-825 | KEEP | — | Transport/policy over pi native commands; not `/skill:` duplication. |
| `getPiSessionAdapter` | 827-835 | REPLACE | Return narrow record-backed adapter | Session ID may be supplied by first durable admission. |

### B2. `sessions.ts` responsibility disposition

| function/group | source lines | verdict | concrete change | risk/caveat |
|---|---:|---|---|---|
| session root/namespace selection | file-wide requirement | KEEP | Re-express inside host repo | Durable root must remain host-side, never guest workspace. |
| session/context validation | file-wide requirement | KEEP | Re-express at repo authorization boundary | Include workspace, user where intended, and runtime-scope pin. |
| `list`, `listUncached` | storage methods | REPLACE | Indexed repo list by authorized partition | Stop scanning wrapper/native files. |
| `create` | storage method | REPLACE | Atomic durable admission may create session implicitly | Preserve stable host session ID and title timestamps. |
| `load`, `loadEntries` | storage methods | REPLACE | Repo record read/projection | No raw JSONL parsing at runtime. |
| `loadAttachment` | storage method | REPLACE | Authorized repo blob lookup | Host responsibility remains. |
| `resolveSessionTranscript` | storage method | DELETE | One canonical record | No wrapper/native choice. |
| `rename`, `withWriter` | storage methods | REPLACE | Repo metadata transaction/record append | Do not raw-append pi JSONL. |
| `loadPiSessionFile*`, `savePiSessionFile` | storage methods | DELETE | Portable repo/storage API | Raw native path is no longer public contract. |
| `delete` | storage method | REPLACE | Repo tombstone/delete plus handle retirement | Preserve tenant check and race fence. |
| raw file/path/link/cache helpers | 332-418, 478-570, 588-1037 | DELETE | Repo adapter/index | Wrapper/native dual resolution causes competing truth. |
| `ui_snapshot` compaction-on-read | 361-382 | DELETE after migration | One-time legacy migration | Not pi LLM compaction; do not remove before legacy snapshots are imported/verified. |
| duplicate prefix readers | 1059-1089 | DELETE | Repo API | Duplicate of `sessionJsonlPrefix.ts`. |
| wrapper/link helpers | 1091-1166 | DELETE | Repo key/index | Legacy import only. |
| native filename convention | 1173-1187 | DELETE | Repo opaque storage | Legacy importer may need it temporarily. |
| raw summary/branch parser | 1189-1261 | DELETE | Repo metadata/index | pi already owns native transcript format/branching. |
| duplicate message helpers | 1263-1312 | DELETE | Canonical projection/pi types | Duplicates `piSessionMessages.ts`. |

### B3. Other B function disposition

| file/function | source lines | verdict | concrete change | risk/caveat |
|---|---:|---|---|---|
| `nativeSessionRename.ts` all functions | 1-139 | DELETE | Repo metadata operation | No partial survivor. |
| `nativeSessionTranscript.ts` all functions | 1-124 | DELETE | Repo index/importer | Retain only in temporary migration tool if legacy data requires it. |
| `createPiFollowUpQueueCompat` | 49-135 | DELETE | Durable submission IDs/native queue | Volatile nonce/text bookkeeping. |
| queue private-field access helpers | 137-212 | DELETE | Public native queue/control API | Hard blocker: prove selective removal semantics first. |
| `piSessionMessages.ts` all helpers | 1-50 | DELETE | Canonical projection | No remaining production consumer after transcript scanner deletion. |
| `packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts` discovery/import/flatten | 1-230 | REPLACE/UNSURE | pi package/extension loader plus a legacy compatibility adapter if required | Do not delete until legacy `AgentTool` exports are either unsupported explicitly or reproduced. |
| `createResourceSettingsManager` | 1-63 | KEEP | — | Policy overlay delegates to pi `SettingsManager`. |
| `readSessionJsonlPrefix` helpers | 1-34 | DELETE | Repo/native storage | No runtime raw transcript scan. |
| `assertReadablePiSessionFile` | 1-34 | DELETE | Repo open/load validation | No production caller. |
| tool error marker helpers | 7-22 | KEEP | — | Bridge pi’s result shape. |
| tool telemetry helpers | 24-44 | KEEP | — | Host observability. |
| `adaptToolForPi`, `adaptToolsForPi` | 46-112 | KEEP | — | Host auth/request context and custom-tool contract. |

### B4. Test fallout, excluded from production totals

| file | lines | verdict | change |
|---|---:|---|---|
| `packages/agent/src/server/harness/pi-coding-agent/__tests__/builtinOptout.test.ts` | 24 | KEEP | Confirms host tools replace native built-ins for governance. |
| `packages/agent/src/server/harness/pi-coding-agent/__tests__/createHarness.test.ts` | 1,351 | REPLACE | Retain model/resource/tool/context cases; rewrite raw session lifecycle. |
| `packages/agent/src/server/harness/pi-coding-agent/__tests__/deriveSourcePlugin.test.ts` | 14 | KEEP | Host UI attribution. |
| `packages/agent/src/server/harness/pi-coding-agent/__tests__/fixtures/extensions/hello-world.mjs` | 19 | REPLACE/DELETE | Keep only if pi extension-loader integration fixture replaces plugin loader. |
| `packages/agent/src/server/harness/pi-coding-agent/__tests__/fixtures/pi-events-corpus.jsonl` | 13 | REPLACE | Legacy import fixture only; canonical runtime must not depend on it. |
| `packages/agent/src/server/harness/pi-coding-agent/__tests__/fixtures/sessionFiles.ts` | 67 | REPLACE | Legacy migration fixtures. |
| `packages/agent/src/server/harness/pi-coding-agent/__tests__/followup.test.ts` | 185 | REPLACE | Native queue + durable submission/auth-context cases. |
| `packages/agent/src/server/harness/pi-coding-agent/__tests__/pluginExtensionSmoke.test.ts` | 159 | REPLACE | Test pi extension/package path, not legacy scanner. |
| `packages/agent/src/server/harness/pi-coding-agent/__tests__/pluginLoader.test.ts` | 311 | REPLACE/UNSURE | Convert to native-loader compatibility tests; delete only if legacy export contract is explicitly retired. |
| `packages/agent/src/server/harness/pi-coding-agent/__tests__/pluginSandboxBypass.test.ts` | 177 | KEEP/REPLACE | Preserve sandbox/tenant security proof under native loader. |
| `packages/agent/src/server/harness/pi-coding-agent/__tests__/runtimeCwd.test.ts` | 156 | KEEP | Host/guest path separation. |
| `packages/agent/src/server/harness/pi-coding-agent/__tests__/sessionMapping.conformance.test.ts` | 147 | REPLACE | Repo tenancy/pin conformance. |
| `packages/agent/src/server/harness/pi-coding-agent/__tests__/sessions.load.test.ts` | 361 | REPLACE | Legacy import + repo load tests, not wrapper runtime. |
| `packages/agent/src/server/harness/pi-coding-agent/__tests__/singleTranscript.test.ts` | 176 | REPLACE | Assert one canonical record, not wrapper/native coincidence. |
| `packages/agent/src/server/harness/pi-coding-agent/__tests__/stableSessionId.test.ts` | 178 | REPLACE | Keep stable public ID across repo/native agent creation. |
| `packages/agent/src/server/harness/pi-coding-agent/__tests__/tool-adapter.telemetry.test.ts` | 386 | KEEP | Host tool auth/telemetry/error semantics. |

## C. `packages/agent/src/server/events/**` and durable-stream flag path

Production `packages/agent/src/server/events/**` total: 578 lines. The 112-line flag/wiring scope in `packages/agent/src/server/agent-host/buildAgentComposition.ts` overlaps Area D and is shown separately.

| file/function | lines | verdict | superseded by | risk/caveat |
|---|---:|---|---|---|
| `packages/agent/src/server/events/eventStreamStore.ts` | 412 | REPLACE | Canonical host conversation record writer/store with opaque cursor and admission/terminal records | Current store persists emitted `PiChatEvent` envelopes as a second truth; it cannot admit work or guarantee one terminal outcome. |
| `packages/agent/src/server/events/schemaVersion.ts` | 58 | DELETE | Replacement record-store schema/migrations | Export/migrate enabled deployments before removing `boring_event_stream_*`. |
| `packages/agent/src/server/events/sqlStorage.ts` | 108 | UNSURE | Replacement storage adapter | Only event stream code imports it on main. KEEP/move if canonical writer reuses generic SQLite adapter; otherwise DELETE. |
| `packages/agent/src/server/agent-host/buildAgentComposition.ts:29-115` | 87 | DELETE | Always-on canonical writer supplied by host | Remove optional flag and second-store-specific error. Preserve durable host-volume selection rule in replacement. |
| `packages/agent/src/server/agent-host/buildAgentComposition.ts:236-259,269` | ~25 | REPLACE | Required writer/repo injection and close ownership | Never silently fall back to guest/sandbox workspace. |

### C1. Event-store function disposition

| function/group | source lines | verdict | concrete change | risk/caveat |
|---|---:|---|---|---|
| `EventStreamReadResult`, `EventStreamMeta` | 19-29 | REPLACE | Opaque cursor page/subscription result | Client must not parse/order cursor. |
| `EventStreamStore` | 31-40 | REPLACE | Conversation record store includes admit, append outcome, read snapshot, subscribe | Preserve idempotent append and close semantics only if useful. |
| `EventStreamStoreError` | 42-49 | REPLACE | Stable record-store errors | Stable code required. |
| `formatOffset`, `parseOffset` | 51-67 | DELETE | Opaque cursor codec owned by store | Numeric composition is leaked mechanism. |
| event stream table DDL | 69-92 | DELETE after migration | Canonical record schema | Existing data migration required. |
| `SqliteEventStreamStore` constructor | 94-106 | REPLACE | Canonical store migration/open | One durable store. |
| `createStream` | 108-112 | REPLACE | Session record creation/admission | Implicit create may happen in admission transaction. |
| `appendEvent` | 114-123 | REPLACE | Canonical append with assigned opaque cursor | Plain append is insufficient for command admission. |
| `appendEventOnce` | 125-176 | KEEP/REPLACE | Exactly-once record append primitive | Useful semantics; move behind convergent writer. |
| `appendAgentEvent` | 178-235 | DELETE | Writer records canonical projected/native event directly | Current envelope adds second `eventIndex` and timestamp. |
| `readEvents` | 237-281 | REPLACE | Read canonical records after opaque cursor | Delete numeric clamp/ahead behavior. |
| `closeStream`, `getStreamMeta`, `subscribe` | 283-306 | REPLACE | Canonical session stream lifecycle | Listener fanout is host transport support. |
| busy retry/SQL helpers | 308-395 | KEEP/REPLACE | Reuse in canonical SQLite adapter if selected | Generic concurrency logic is not conceptually redundant. |
| `isSqliteBusy`, `delay`, `clampLimit` | 397-412 | KEEP/REPLACE | Generic storage helpers | Move only if still used. |
| `schemaVersion.ts` all | 1-58 | DELETE after migration | New schema/version | Never strand unversioned/flag-era data. |
| `sqlStorage.ts` interfaces/transaction helpers | 13-79 | UNSURE | Canonical SQLite adapter | Reusable but synchronous `node:sqlite` may block; choose deliberately. |
| `openDatabase`, query helper | 81-108 | UNSURE | Canonical store open | Preserve WAL/busy behavior and host root if reused. |

### C2. Durable flag path disposition

| symbol | source lines | verdict | concrete change | risk/caveat |
|---|---:|---|---|---|
| `DURABLE_STREAM_ENV_FLAG` | 29-36 | DELETE | Durability is mandatory for admitted work | Rollout needs migration/compat window, not an indefinite optional mode. |
| `EVENT_STORE_FILE_NAME` | 37 | DELETE/REPLACE | Canonical store filename/config | Existing file discovery may be needed for migration. |
| `isDurableStreamEnabled` | 39-42 | DELETE | No optional branch | F3 requires durable admission before work. |
| `openDurableEventStore` | 44-89 | REPLACE | Open canonical writer/repo at durable host root | Keep fail-loud behavior and never use guest path. |
| `DurableStreamUnavailableError` | 91-103 | REPLACE | Canonical store unavailable error | Stable code still needed, name changes. |
| `reportEventStoreOpenFailure` | 105-115 | REPLACE | Canonical store boot telemetry | Do not log secrets/record payloads. |
| conditional wiring | 239-245 | DELETE | Required store creation | No flag-off path. |
| service `eventStore` injection | 246-256 | REPLACE | Inject record writer/repo | Also inject into pi agent construction. |
| disposal close | 267-269 | KEEP/REPLACE | Close canonical writer | Host owns lifecycle. |

### C3. Test fallout, excluded from production totals

| file | lines | verdict | change |
|---|---:|---|---|
| `packages/agent/src/server/events/__tests__/eventStreamStore.concurrentAppend.test.ts` | 255 | REPLACE | Canonical writer admission/append/terminal concurrency. |
| `packages/agent/src/server/events/__tests__/eventStreamStore.conformance.test.ts` | 219 | REPLACE | Opaque cursor and exactly-once record conformance. |
| `packages/agent/src/server/harness/pi-coding-agent/__tests__/fixtures/concurrentAppendWorker.ts` | 73 | REPLACE | Retain only if canonical SQLite backend still needs cross-process contention proof. |
| `packages/agent/src/server/agent-host/__tests__/buildAgentComposition.durableStream.test.ts` | 167 | DELETE/REPLACE | Delete flag cases; test required host-root canonical writer and fail-loud boot. |

## D. `packages/agent/src/server/agent-host/**`

Production/support total matching the requested 6,260 lines: 5,540 production lines plus 720 lines in `testing/compositionRouteProof.ts` and `testing/gatewayConformance.ts`; `__tests__` are excluded.

| file | lines | verdict | superseded by | risk/caveat |
|---|---:|---|---|---|
| `packages/agent/src/server/agent-host/agentSessionEventQueue.ts` | 36 | KEEP | — | Closeable async transport queue. It may become a thin canonical-subscription adapter; it is not durable state. |
| `packages/agent/src/server/agent-host/agentSessionKey.ts` | 5 | KEEP | — | Workspace + agent + session composite identity is tenancy isolation. |
| `packages/agent/src/server/agent-host/buildAgentComposition.ts` | 272 | MIXED: DELETE ~87 / REPLACE ~45 / KEEP ~140 | Canonical writer + host-provided pi repo | Keep tools, environment/model/resource policy, readiness, root selection, and disposal. |
| `packages/agent/src/server/agent-host/canonical.ts` | 13 | UNSURE | Convergent primitive’s canonical request digest | DELETE if primitive defines digest bytes; KEEP/move if it is only a contract. Digest compatibility affects retries. |
| `packages/agent/src/server/agent-host/createAgentHost.ts` | 880 | MIXED: REPLACE ~230 / KEEP ~650 | Durable admission/execution runner | Keep fleet/scope/environment/binding/lease/drain/route ownership. Replace hand-rolled finite-effect lifecycle. |
| `packages/agent/src/server/agent-host/embeddedGateway.ts` | 997 | MIXED: REPLACE ~377 / KEEP ~620 | Durable runner + canonical record subscription | Keep verification, session binding/pins, fleet projection, connection lifecycle, and tenant-bound list cursor. |
| `packages/agent/src/server/agent-host/environmentHttpProjection.ts` | 110 | KEEP | — | Authorization and finite environment lease bound to HTTP transport. |
| `packages/agent/src/server/agent-host/environmentLease.ts` | 204 | KEEP | — | Tenant/placement-keyed environment sharing, provisioning fingerprint, refcounts, drain/disposal. |
| `packages/agent/src/server/agent-host/fleetCompiler.ts` | 118 | KEEP | — | Fail-closed plugin/config/model governance. |
| `packages/agent/src/server/agent-host/httpProjection.ts` | 610 | KEEP | — | Fastify validation, auth hooks, attachments, SSE/NDJSON lifecycle, route ownership. DTO/endpoints change. |
| `packages/agent/src/server/agent-host/mcpGrantStore.ts` | 154 | KEEP | — | Per-workspace persisted MCP authorization grants. |
| `packages/agent/src/server/agent-host/mcpGrants.ts` | 168 | KEEP | — | Default-deny connector/tool grant resolution. |
| `packages/agent/src/server/agent-host/requestLedger.ts` | 129 | REPLACE | Durable runner in-memory test backend or remove production fallback | Current state machine has no crash reclaim/at-least-once worker. Preserve complete tenant/subject/target/request key. |
| `packages/agent/src/server/agent-host/runtimeCapabilityProjection.ts` | 728 | MIXED: REPLACE ~128 / KEEP ~600 | Runner for reload/command effects; native resource APIs | Keep authorization, workspace binding, grants, model/readiness/catalog and HTTP capability projection. |
| `packages/agent/src/server/agent-host/runtimeScopeIdentity.ts` | 79 | KEEP | — | Deterministic physical/provisioning identity pins session to authorized environment. |
| `packages/agent/src/server/agent-host/sessionInventory.ts` | 158 | MIXED: REPLACE ~74 / KEEP ~84 | Injected host repo/canonical record index | Replace direct `PiSessionStore`; keep namespace partition and UI activity projection. |
| `packages/agent/src/server/agent-host/sqliteRequestLedger.ts` | 174 | REPLACE | Convergent runner durable backend | Migrate terminal receipts; quarantine legacy `in-flight` as outcome-unknown. |
| `packages/agent/src/server/agent-host/stableServiceError.ts` | 41 | KEEP | — | Allowlist distinguishes recordable rejection from uncertain effect. Becomes runner policy hook. |
| `packages/agent/src/server/agent-host/testing/compositionRouteProof.ts` | 88 | KEEP | — | Route ownership/composition proof. Adjust endpoint set only. |
| `packages/agent/src/server/agent-host/testing/gatewayConformance.ts` | 632 | REPLACE | Conformance suite for opaque cursor and convergent durability | Retain auth/isolation/pagination; replace replay/admission/terminal cases. |
| `packages/agent/src/server/agent-host/types.ts` | 378 | MIXED: REPLACE ~104 / KEEP ~274 | Primitive request/admission/record types | Preserve fleet/runtime/environment/lease/direct-projection types and tenant key fields. |
| `packages/agent/src/server/agent-host/workspaceAgentLease.ts` | 286 | KEEP | — | Authorized capability lifetime, revocation fence, drain, cleanup, provider release. |

### D1. `createAgentHost.ts` function disposition

| function/group | source lines | verdict | concrete change | risk/caveat |
|---|---:|---|---|---|
| `RuntimeBinding`, `AgentHostRuntime` | 45-125 | KEEP/REPLACE | Keep host runtime boundary; replace ledger/effect methods with runner | Do not leak primitive storage details into callers. |
| fleet clone/validation/freeze | 128-172 | KEEP | — | Host governance and immutable compiled config. |
| `resolveHostId` | 174-203 | KEEP | — | Stable host identity for durable scope. |
| runtime/environment validation | 205-229 | KEEP | — | Fail-closed host policy. |
| `createRuntime` | 231-684 | MIXED | Retain scope/environment/binding lifecycle; inject runner/repo | Largest reconciliation change. |
| ledger construction/admission seam | around 300-335 | REPLACE | Required durable runner | In-memory fallback must not execute production effects. |
| `listSessionSummaries` | 332-335 | REPLACE | Injected tenant-aware repo/index | Remove direct file-store inventory dependency. |
| `verify` | 340-346 | KEEP | — | Reverify authorized scope. |
| environment resolution/acquisition | 348-367 | KEEP | — | Host multi-tenant runtime ownership. |
| `resolveSessionRuntime` | 369-382 | KEEP/REPLACE | Repo supplies tenant/runtime pin | Preserve hidden cross-scope behavior. |
| `resolveBinding` | 384-502 | KEEP/REPLACE | Bind one repo-backed composition to authorized scope | Keep single-flight, publication, lease, runtime identity. |
| published binding lookups | 504-540 | KEEP | — | Host lifecycle/visibility. |
| `startDrain`, `drainRuntime` | 542-593 | REPLACE | Runner stops admissions, drains leases, records uncertain outcomes | Never manufacture rejection after effect may have started. |
| `registerSubscription` | 595-598 | KEEP | — | Transport cleanup. |
| `startPreparedEffect` | 600-630 | REPLACE | Durable worker/lease transition | Process-local promise cannot recover after crash. |
| `runBindingOperation` | 617-630 | KEEP/REPLACE | Keep per-binding resource safety; runner owns effect state | Avoid double serialization with runner. |
| `closeRuntime` | 632-684 | KEEP/REPLACE | Close runner, subscriptions, bindings, environments | Preserve idempotency. |
| ready capability projection | 686-692 | KEEP | — | UI/host readiness. |
| `createAgentHost` | 694-879 | KEEP/REPLACE | Keep facade/routes/leases; inject new runtime primitive | Direct routes still require strong durable admission. |

### D2. `embeddedGateway.ts` function disposition

| function/group | source lines | verdict | concrete change | risk/caveat |
|---|---:|---|---|---|
| gateway errors/targets/context | 64-85 | KEEP | — | Stable host transport/error projection and tenant target. |
| legacy summary conversion/order | 87-115 | REPLACE | Canonical repo summary | Remove transcript-derived status reconciliation. |
| `isAfterCursor` | 117-126 | KEEP | Keyset session-list cursor | This is not conversation resume cursor. |
| constructor/test observers | 128-238 | KEEP | — | Gateway/runtime wiring. |
| `assertOpen`, `verify` | 240-248 | KEEP | — | Reverify every operation. |
| `listAgents` | 250-262 | KEEP | — | Host fleet projection. |
| `listSessions` | 264-291 | KEEP/REPLACE | Read injected tenant repo, retain opaque tenant-bound pagination cursor | Current list cursor already opaque to browser. |
| `createSession` | 293-352 | REPLACE | Implicit durable first admission; optional explicit create remains idempotent | Define collection prompt endpoint/receipt first. |
| `readSessionState` | 354-373 | REPLACE | Canonical record snapshot and opaque cursor | No service-fabricated seq. |
| `connectSession` | 375-481 | REPLACE | Canonical record subscription from opaque cursor | Keep reauthorization and connection cleanup. |
| `send` | 483-529 | REPLACE | Durable runner command submission | Exactly one terminal record; surface unknown outcome. |
| `renameSession` | 531-546 | KEEP/REPLACE | Repo metadata effect via runner | Host operation, not pi transcript mutation. |
| `deleteSession` | 548-560 | KEEP/REPLACE | Repo delete/tombstone via runner | Preserve tenant binding/race fence. |
| `close` | 562-567 | KEEP | — | Transport lifecycle. |
| `bindingForSession` | 569-636 | KEEP | — | Runtime pin and tenant binding. |
| `loadSummary` | 638-651 | REPLACE | Repo index | No transcript/live reconciliation. |
| `sessionEffect`, `effect` | 653-850 | REPLACE | Convergent runner | Hand-coded prepare/admit/begin/complete/unknown logic moves behind primitive. |
| `applyClassification` | 852-870 | REPLACE | Runner terminalization policy | Exactly-one outcome transition. |
| `replayReceipt`, `failure` | 872-886 | REPLACE/KEEP | Primitive receipt replay and stable failure projection | Stable DTO behavior must remain. |
| `promptAdmission` | 888-909 | REPLACE | Durable admission policy hook | Strict-idle is host policy; recording mechanism changes. |
| `queueClearAdmission` | 911-947 | REPLACE | Durable cancellation policy hook | Stable submission IDs replace selector inference. |
| `encodeCursor`, `decodeCursor` | 949-996 | KEEP | Tenant-bound opaque keyset cursor | Not the chat resume cursor. Replace only if shared codec preserves binding/tamper checks. |

### D3. Other D function disposition

| file/function | source lines | verdict | concrete change | risk/caveat |
|---|---:|---|---|---|
| `AgentSessionEventQueue` | 4-36 | KEEP | Feed canonical subscription into transport queue | Backpressure/bounds remain a question. |
| `agentSessionKey` | 3-5 | KEEP | — | Tenant composite key. |
| `canonicalJson`, `canonicalDigest` | 4-13 | UNSURE | Shared runner digest | Compatibility question must be resolved before deletion. |
| `registerAgentHostEnvironmentRoutes` | 25-110 | KEEP | — | Authorized HTTP environment lease. |
| `EnvironmentLeaseManager` | 59-204 | KEEP | — | Multi-tenant resource lifetime. |
| fleet validation/compiler | 8-118 | KEEP | — | Governance. |
| `claimAgentHostProjection` | 47-145 | KEEP | — | Route ownership conflict defense. |
| HTTP schema/error helpers | 147-220 | KEEP | Update DTO schemas/codes | Stable validation/transport boundary. |
| addressed session routes | 222-585 | KEEP/REPLACE | Keep transport; change implicit create/cursor/final contracts | Stream framing remains host-owned. |
| `createAgentHostRoutes` | 587-610 | KEEP | — | Composition. |
| MCP grant store all | 5-154 | KEEP | — | Per-workspace governance. |
| MCP grant resolver all | 21-168 | KEEP | — | Native tool schemas do not authorize connector access. |
| `InMemoryAgentRequestLedger` | 45-129 | REPLACE/DELETE | Runner dev/test backend | Must not be production durability fallback. |
| capability authorization/binding | 153-334 | KEEP | — | Scope, workspace, grants, model/readiness. |
| capability `executeCommand`, `reload` | 335-500 | REPLACE | Runner effects; retain authorization/resource reload behavior | pi native commands remain underneath. |
| capability HTTP routes/error helpers | 502-728 | KEEP | Update runner DTOs only | Transport/governance. |
| runtime identity/fingerprint | 4-79 | KEEP | — | Tenant/runtime pin. |
| `sessionNamespaceForAgent` | 15-33 | KEEP | — | Storage partitioning. |
| `AgentSessionInventory` | 35-103 | REPLACE | Injected repo/index | Direct `PiSessionStore` construction couples host to JSONL truth. |
| `AgentSessionActivityIndex` | 105-158 | KEEP/REPLACE | UI projection from authoritative terminal event | Do not infer terminal ordering from late `agent-end`. |
| `SqliteAgentRequestLedger` | 39-174 | REPLACE | Runner durable backend | Preserve CAS and receipt migration; add reclaim/unknown semantics. |
| stable service error projection | 4-41 | KEEP | Runner policy hook | Central safety boundary for replay vs unknown. |
| route proof | 1-88 | KEEP | Adjust route table | Transport composition proof. |
| gateway conformance | 1-632 | REPLACE | Durability/cursor/auth suite | Keep isolation and keyset cases. |
| ledger/effect/admission types | 35-138 | REPLACE | Primitive types/adapters | Preserve target and tenant fields. |
| fleet/environment/runtime/host types | 139-378 | KEEP | — | Host-owned contracts. |
| workspace agent lease all | 11-286 | KEEP | — | Revocation, cleanup, finite capability lifetime. |

### D4. `__tests__` fallout, excluded from 6,260-line total

| file | lines | verdict | change |
|---|---:|---|---|
| `packages/agent/src/server/agent-host/__tests__/acceptanceIntegration.test.ts` | 270 | REPLACE | Durable admission/runner integration. |
| `packages/agent/src/server/agent-host/__tests__/buildAgentComposition.durableStream.test.ts` | 167 | DELETE/REPLACE | Required canonical store; no flag-off branch. |
| `packages/agent/src/server/agent-host/__tests__/createAgentHost.test.ts` | 1,011 | REPLACE | Retain fleet/scope/lease/drain; rewrite ledger/effect lifecycle. |
| `packages/agent/src/server/agent-host/__tests__/describeAgent.test.ts` | 166 | KEEP/REPLACE | Host projection; adapt repo/resource DTO. |
| `packages/agent/src/server/agent-host/__tests__/effectAdmission.test.ts` | 122 | REPLACE | Convergent primitive policy adapter. |
| `packages/agent/src/server/agent-host/__tests__/embeddedGatewayFixture.ts` | 336 | REPLACE | Canonical repo/runner fixture. |
| `packages/agent/src/server/agent-host/__tests__/embeddedGatewaySafeFailure.test.ts` | 39 | KEEP/REPLACE | Preserve uncertain-side-effect behavior. |
| `packages/agent/src/server/agent-host/__tests__/environmentHttpProjection.test.ts` | 235 | KEEP | Auth/transport lease. |
| `packages/agent/src/server/agent-host/__tests__/environmentLease.test.ts` | 225 | KEEP | Multi-tenant environment lifetime. |
| `packages/agent/src/server/agent-host/__tests__/fleetCompiler.test.ts` | 132 | KEEP | Governance. |
| `packages/agent/src/server/agent-host/__tests__/httpProjection.test.ts` | 527 | REPLACE | Keep transport/auth; update implicit create/cursor/final. |
| `packages/agent/src/server/agent-host/__tests__/legacyTranscriptCompatibility.test.ts` | 142 | REPLACE | Move to one-time import/migration proof. |
| `packages/agent/src/server/agent-host/__tests__/lifecycle.test.ts` | 305 | KEEP/REPLACE | Preserve drain/close; runner terminalization changes. |
| `packages/agent/src/server/agent-host/__tests__/mcpGrantStore.test.ts` | 133 | KEEP | Tenant grants. |
| `packages/agent/src/server/agent-host/__tests__/mcpGrants.test.ts` | 248 | KEEP | Default-deny governance. |
| `packages/agent/src/server/agent-host/__tests__/modelPolicy.test.ts` | 175 | KEEP | Host model governance. |
| `packages/agent/src/server/agent-host/__tests__/noBootSessionListing.test.ts` | 197 | REPLACE | Implicit session creation/listing semantics. |
| `packages/agent/src/server/agent-host/__tests__/projectedToolConformance.test.ts` | 34 | KEEP | Host tool boundary. |
| `packages/agent/src/server/agent-host/__tests__/renameSession.test.ts` | 52 | REPLACE | Repo metadata operation. |
| `packages/agent/src/server/agent-host/__tests__/requestLedger.test.ts` | 105 | REPLACE/DELETE | Primitive backend conformance. |
| `packages/agent/src/server/agent-host/__tests__/runtimeScopeIdentity.test.ts` | 401 | KEEP | Tenant/runtime pin. |
| `packages/agent/src/server/agent-host/__tests__/sessionIsolation.test.ts` | 90 | KEEP/REPLACE | Mandatory repo isolation proof. |
| `packages/agent/src/server/agent-host/testing/__tests__/embeddedGatewayConformance.test.ts` | 40 | REPLACE | Point gateway conformance fixture at canonical repo/runner. |
| `packages/agent/src/server/agent-host/testing/__tests__/gatewayConformance.test.ts` | 891 | REPLACE | Preserve authorization/isolation/pagination; replace bespoke replay/admission/terminal expectations. |

## E. Frontend pi chat and session hook

Named production scope: `packages/agent/src/front/chat/pi/**` (3,415) plus `packages/agent/src/front/chat/session/usePiSessions.ts` (745) = 4,160 lines.

| file | lines | verdict | superseded by | risk/caveat |
|---|---:|---|---|---|
| `packages/agent/src/front/chat/pi/piChatAssistantCommit.ts` | 306 | DELETE | Authoritative `message-end.final` | Replace with ~20-30 line canonical upsert if not absorbed by reducer. Clarify whether final covers one message or entire turn. |
| `packages/agent/src/front/chat/pi/piChatCommittedMessages.ts` | 20 | REPLACE | Stable canonical message/submission ID upsert | Preserve no canonical fields from optimistic placeholder. |
| `packages/agent/src/front/chat/pi/piChatMessageMetadata.ts` | 14 | DELETE | Canonical timestamps | Earliest-local metadata preservation is reconciliation. |
| `packages/agent/src/front/chat/pi/piChatPartMerging.ts` | 492 | DELETE after move | Authoritative final | Preserve/move lines 7-29 while pre-final streamed tool results need merging; also define whether tool results may follow final. Delete only lines 31-492 unconditionally after final contract lands. |
| `packages/agent/src/front/chat/pi/piChatQueueState.ts` | 163 | REPLACE | Durable admission receipt and stable submission ID | Keep optimistic UX; delete text-count/clientSeq matching. |
| `packages/agent/src/front/chat/pi/piChatReducer.ts` | 852 | REPLACE | Opaque cursor + authoritative final reducer contract | UI projection survives; numeric gaps and snapshot/final arbitration do not. |
| `packages/agent/src/front/chat/pi/piChatStore.ts` | 80 | KEEP | — | React external-store batching/subscription. |
| `packages/agent/src/front/chat/pi/piChatStream.ts` | 260 | REPLACE | Opaque resume cursor + explicit reset signal | Keep NDJSON framing/schema/backoff; delete numeric seq processor. |
| `packages/agent/src/front/chat/pi/piFollowUpQueueController.ts` | 206 | REPLACE | Native queue over host transport + durable receipt | UI policy remains; delete client-side clientSeq synthesis. |
| `packages/agent/src/front/chat/pi/remotePiSession.ts` | 838 | REPLACE | Opaque cursor, implicit session creation, canonical stream | Keep auth headers/routes/fetch/reconnect/suspend/dispose. Surface uncertain admission. |
| `packages/agent/src/front/chat/pi/selectors.ts` | 184 | REPLACE | Canonical message list + optimistic submission overlay | Delete adjacent assistant folding/merge; keep render selection/notices. |
| `packages/agent/src/front/chat/session/usePiSessions.ts` | 745 | REPLACE | Unbound New Chat; bind on first durable admission | Keep list/pagination/scoping/stale guards/CRUD/disposal. Delete explicit empty-session boot-resume machinery. |

### E1. `packages/agent/src/front/chat/pi/piChatReducer.ts` function disposition

| function/group | source lines | verdict | concrete change | risk/caveat |
|---|---:|---|---|---|
| connection/runtime/retry/history state | 33-91 | KEEP/REPLACE | Keep UI state; cursor is opaque and no client gap ordering | Do not infer cursor ordering. |
| reducer actions | 92-103 | REPLACE | Remove numeric `cursor-sync`; add canonical reset/bind actions | Protocol version gate. |
| initial state/reducer shell | 104-188 | KEEP/REPLACE | Keep view projection | Remove integer sequence assumptions. |
| `syncCursor` | 198-201 | DELETE | Opaque cursor stored from server envelope | No `Math.max`. |
| `hydrateFromSnapshot` | 203-278 | REPLACE | Replace canonical state wholesale plus optimistic-ID overlay | No local-vs-snapshot history arbitration. |
| initial outbox preservation | 279-305 | REPLACE | Stable admission ID matching only | Text/nonce fallback should not own truth. |
| `mergeSnapshotMessagesIntoLocal` | 307-314 | DELETE | Canonical snapshot | Reconciliation. |
| `applySequencedEvent` | 316-329 | REPLACE | Apply envelope and store opaque cursor | Delete expectedSeq/gap/ahead logic. |
| event status/error/queue dispatch | 331-407 | KEEP/REPLACE | Keep UI projection; queue keyed by submission ID | Authoritative terminal wins. |
| stale-turn/late-agent-end guards | 409-415 | DELETE/REPLACE | Exactly one authoritative terminal outcome | Retain only if old protocol compatibility is supported. |
| user/message/tool live projection | 417-527 | KEEP/REPLACE | Keep streaming UI | Tool-result finality contract must be explicit. |
| snapshot assistant coalescing | 529-573 | DELETE | Canonical message order/final | No adjacent folding. |
| delta/part/tool updates | 575-612 | KEEP | — | Live visual projection. |
| streaming merge target/preservation | 613-690 | DELETE | Authoritative final message ID | Reconciliation. |
| remaining live part updates | 691-819 | KEEP/REPLACE | Keep streaming display | Stable IDs from server. |
| terminal stream merge | 820-835 | DELETE/REPLACE | Canonical replacement upsert | Do not merge content richness. |
| pending tool/notices helpers | 836-852 | KEEP | — | UI state. |

### E2. Other frontend function disposition

| file/function | source lines | verdict | concrete change | risk/caveat |
|---|---:|---|---|---|
| `commitFinalMessage` and plan helpers | 19-306 | DELETE | Canonical replacement by ID | Entire file guesses same-ID/no-turn/adjacent targets and preserves richer local state. |
| `replaceOrAppendMessage` | 4-20 | REPLACE | Upsert canonical ID; separately overlay optimistic submission | No earliest-local timestamp. |
| message metadata helpers | 1-14 | DELETE | Canonical timestamps | No survivor. |
| `mergeToolResultPart` | 7-29 | KEEP/MOVE | Narrow reducer live update | Required for pre-final streamed results unless reducer gets an authoritative replacement event; late-after-final behavior is a second independent question. |
| remaining part merge helpers | 31-492 | DELETE | Authoritative final | Includes content/order/richness/status heuristics. |
| optimistic outbox helpers | 7-89 | REPLACE | Stable submission IDs | Keep visual overlay. |
| queue text-count/enrichment helpers | 90-163 | DELETE | Stable submission IDs | Text ordinal matching is reconciliation. |
| `piChatStore` all | 1-80 | KEEP | — | Browser state notification. |
| stream NDJSON parser | 41-114 | KEEP | — | Wire framing, not pi transcript JSONL. |
| numeric sequence/range parser | 10-39, 116-187 | DELETE/REPLACE | Opaque cursor/reset | Browser passes token through. |
| stream URL/backoff/scheduling | 193-260 | KEEP/REPLACE | Opaque cursor parameter | Transport lifecycle. |
| follow-up UI policy/edit warning | 54-176 excluding seq allocation | KEEP | — | UI decision layer, not queue implementation. |
| `nextFollowUpClientSeq` and floor | 134-137,177-186 | DELETE | Server-issued stable submission ID | No client ordering truth. |
| remote command methods | 215-276 | REPLACE | Durable receipts, uncertain response status, optional initial session ID | Do not optimistically roll back an admitted-but-timeout request. |
| remote lifecycle/start/resume | 277-538 | REPLACE | Opaque cursor and explicit reset | Keep reconnect/suspend/dispose. |
| remote fetch/auth/header/routing helpers | 543-631 | KEEP | — | Load-bearing tenant transport. |
| remote optimistic conversion/debug helpers | 631-838 | REPLACE/KEEP | Stable submission ID; keep redacted diagnostics | Avoid payload secrets in logs. |
| selector optimistic queue/notices | 1-110 | KEEP/REPLACE | Stable submission overlay | Host UI responsibility. |
| selector assistant folding | 112-178 | DELETE | Canonical message order | No cross-ID/turn coalescing. |
| `usePiSessions` list/pagination/source scoping | file-wide | KEEP | — | Already uses opaque `nextCursor: string`; unrelated to chat resume cursor. |
| explicit create path | 422-448 | DELETE/REPLACE | First admitted prompt returns session ref | Endpoint contract must land first. |
| boot empty-session resume state/effects | file-wide | DELETE | Unbound browser draft | Decide whether unsent drafts persist locally. |
| rename/delete/loadMore/stale guards/disposal | file-wide | KEEP | — | Host UI and tenant correctness. |

### E3. Adjacent required change outside named total

| file | lines | verdict | concrete change | risk/caveat |
|---|---:|---|---|---|
| `packages/agent/src/front/chat/session/sessionSelectionStorage.ts` | 105 | REPLACE | Delete boot-resume source/key/read/write (~49); keep active-session scoped selection (~56) | Active selection is tenant-scoped UI preference and must not be deleted. |

### E4. Test fallout, excluded from production totals

| file | lines | verdict | change |
|---|---:|---|---|
| `packages/agent/src/front/chat/pi/__tests__/piChatPartMerging.test.ts` | 70 | DELETE | Invalidated final merge-order reconciliation. |
| `packages/agent/src/front/chat/pi/__tests__/piChatReducer.queue.test.ts` | 353 | REPLACE | Stable admission-ID overlay and canonical queue. |
| `packages/agent/src/front/chat/pi/__tests__/piChatReducer.test.ts` | 2,233 | REPLACE | Delete richer-live/thinner-final, repeated-ID, adjacent-fold, stale-snapshot cases. |
| `packages/agent/src/front/chat/pi/__tests__/piChatStream.addressed.test.ts` | 22 | REPLACE | Opaque envelope cursor contract. |
| `packages/agent/src/front/chat/pi/__tests__/piChatStream.test.ts` | 224 | REPLACE | Keep framing/backoff; replace seq/gap/replay tests. |
| `packages/agent/src/front/chat/pi/__tests__/piFollowUpQueueController.test.ts` | 212 | REPLACE | Keep UI policy; delete clientSeq allocation. |
| `packages/agent/src/front/chat/pi/__tests__/remotePiSession.test.ts` | 901 | REPLACE | Keep auth/lifecycle; add implicit bind and uncertain-admission cases. |
| `packages/agent/src/front/chat/pi/__tests__/selectors.test.ts` | 337 | REPLACE | Delete adjacent assistant merge expectations. |
| `packages/agent/src/front/chat/session/__tests__/usePiSessions.addressed.test.tsx` | 66 | REPLACE | First-admission bind instead of explicit create. |
| `packages/agent/src/front/chat/session/__tests__/usePiSessions.test.tsx` | 1,314 | REPLACE | Delete boot-empty-session cases; retain tenant/pagination/concurrency/CRUD/disposal. |

## F. Exact pi-native duplication inventory

| exact file/function | lines | verdict | superseded by | risk/caveat |
|---|---:|---|---|---|
| `packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts` | 230 | REPLACE/UNSURE | pi `DefaultResourceLoader` plus any required legacy `AgentTool` export adapter | Native equivalence is unproven; not an unconditional F4 delete. |
| `packages/agent/src/server/harness/pi-coding-agent/piFollowUpQueueCompat.ts` | 212 | DELETE | Native queue + durable queue records | Public/selective cancel gap must be closed. |
| `packages/agent/src/server/harness/pi-coding-agent/nativeSessionRename.ts` | 139 | DELETE | Repo metadata operation | Raw JSONL workaround. |
| `packages/agent/src/server/harness/pi-coding-agent/nativeSessionTranscript.ts` | 124 | DELETE | Repo index/importer | Raw transcript parser. |
| `packages/agent/src/server/harness/pi-coding-agent/sessionJsonlPrefix.ts` | 34 | DELETE | Repo/storage API | Raw prefix parser. |
| `packages/agent/src/server/harness/pi-coding-agent/piSessionMessages.ts` | 50 | DELETE | Canonical projection/pi message types | Duplicated in `sessions.ts`. |
| `packages/agent/src/server/harness/pi-coding-agent/sessionReadability.ts` | 34 | DELETE | Repo/native loader validation | Tests-only consumer. |
| `packages/agent/src/server/harness/pi-coding-agent/sessions.ts:1059-1089` | 31 | DELETE | Repo/storage API | Duplicate async/sync JSONL prefix readers. |
| `packages/agent/src/server/harness/pi-coding-agent/sessions.ts:1091-1166` | 76 | DELETE | Repo key/index | Wrapper/native transcript links. |
| `packages/agent/src/server/harness/pi-coding-agent/sessions.ts:1173-1187` | 15 | DELETE | Repo opaque storage | Native filename convention; legacy importer only. |
| `packages/agent/src/server/harness/pi-coding-agent/sessions.ts:1189-1261` | 73 | DELETE | Repo metadata/branch index | Raw summary/branch parsing. |
| `packages/agent/src/server/harness/pi-coding-agent/sessions.ts:1263-1312` | 50 | DELETE | Canonical projection/pi types | Duplicate message helpers. |
| `packages/agent/src/server/harness/pi-coding-agent/sessions.ts:361-382` | 22 | DELETE after migration | One-time legacy import | This is legacy `ui_snapshot` compaction, not LLM context compaction. |
| `packages/agent/src/server/pi-chat/piChatReplayBuffer.ts` | 144 | DELETE | Canonical opaque cursor stream | Duplicate replay primitive. |
| `packages/agent/src/server/pi-chat/piChatMessageMetadataReconciler.ts` | 404 | DELETE | Stable admitted record metadata | Duplicate queue/submission identity reconciliation. |
| `packages/agent/src/server/pi-chat/piChatEvents.ts:281-356` | 76 | DELETE | Authoritative `message-end.final` | Agent-end final reconstruction. |
| `packages/agent/src/front/chat/pi/piChatAssistantCommit.ts` | 306 | DELETE | Authoritative `message-end.final` | Client final reconciliation. |
| `packages/agent/src/front/chat/pi/piChatPartMerging.ts:31-492` | 462 | DELETE | Authoritative `message-end.final` | Client content/order/richness reconciliation. |
| `packages/agent/src/front/chat/pi/piChatMessageMetadata.ts` | 14 | DELETE | Canonical metadata | Client timestamp reconciliation. |

### F1. Similar-looking code that is not duplication

| exact file/function | lines | verdict | why it stays |
|---|---:|---|---|
| `packages/agent/src/server/skillFrontmatter.ts` | 36 | KEEP/UNSURE | Delegates directly to pi `parseFrontmatter`; thin server dependency wrapper. Used by Workspace package resource metadata. Not a bespoke parser. |
| `packages/agent/src/server/http/routes/skills.ts` | 207 | KEEP | Uses pi `DefaultPackageManager`/`loadSkills`; adds host auth, tenant workspace locating, management merge/cache, safe browser projection. |
| `packages/agent/src/server/workspace/provisioning/skills.ts` | 75 | KEEP | Host-controlled tenant runtime mirroring; no parsing/discovery. |
| `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts:614-642` | 29 | KEEP | Correctly uses pi `DefaultResourceLoader`/`loadSkills`; flags are isolation policy. |
| `packages/agent/src/shared/tool.ts` | 41 | KEEP | Host custom-tool contract. |
| `packages/agent/src/shared/validateTool.ts` | 11 | KEEP | Host boundary validation, not pi built-in schema copy. |
| `packages/agent/src/server/harness/pi-coding-agent/tool-adapter.ts` | 112 | KEEP | Carries auth/request context into host tools and bridges telemetry/errors. |
| `packages/agent/src/front/bareToolRenderers/DiffView.tsx` | 83 | KEEP | UI renderer only; no edit/diff/patch execution. |
| `packages/agent/src/shared/sandbox.ts` | 174 | KEEP | Operations resource governance. Pi truncation covers native tools, which are intentionally disabled here. |
| `packages/agent/src/server/pi-chat/piChatHistory.ts` | 258 | KEEP | Host wire/UI/legacy-import projection, not durable transcript ownership. |
| `packages/agent/src/front/chat/pi/piChatStream.ts` NDJSON parser | 41-114 | KEEP | Browser wire framing, not pi transcript JSONL. |
| reducer tool lifecycle projection | reducer-local | KEEP | Rendering tool events, not executing or validating tool schemas. |

### F2. Native capabilities already delegated correctly

| native capability | actual main-code delegation | verdict |
|---|---|---|
| turn loop | `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts` calls pi `createAgentSession` | KEEP integration |
| follow-up execution | adapter calls native follow-up; delete only private compat bookkeeping | REPLACE shim |
| skill parsing | `skillFrontmatter.ts` calls pi `parseFrontmatter` | KEEP wrapper/UNSURE API |
| skill discovery/progressive disclosure | `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts` uses `DefaultResourceLoader` and `loadSkills` | KEEP integration |
| `/skill:` and slash commands | returned harness queries/executes pi extension runtime commands | KEEP transport/policy |
| context-file discovery | pi resource loader, with host `noContextFiles` isolation flag | KEEP policy |
| prompt templates/base prompt | pi base prompt plus host runtime/tenant append | KEEP host append |
| compaction | no custom LLM compaction found | No deletion |
| JSONL format/storage | raw wrappers/scanners in B duplicate mechanism | DELETE/REPLACE listed above |
| branching/fork | raw summary/branch parsing only; native pi owns branch mechanics | DELETE parser after repo migration |
| built-in tool schemas | native built-ins deliberately disabled; host tools enforce Workspace/Operations | KEEP host tool adapter |
| output truncation | pi native for native tools; host sandbox cap for custom tools | KEEP host cap |
| edit diff/patch | only UI diff rendering found | KEEP renderer |

## Summary

All rows below use the same responsibility-level estimate methodology: source lines that survive substantially unchanged are KEEP; source lines whose responsibility remains but mechanism changes are REPLACE; source lines whose responsibility disappears are DELETE. `UNSURE` is kept separate rather than forced into a verdict. Counts sum to each exact named-area total. C’s 112-line composition seam overlaps D and must not be added twice.

| area | DELETE lines | REPLACE lines | KEEP lines | UNSURE lines | exact total |
|---|---:|---:|---:|---:|---:|
| A. `packages/agent/src/server/pi-chat/**` | ~1,057 | ~1,528 | ~1,440 | 0 | 4,025 |
| B. `packages/agent/src/server/harness/pi-coding-agent/**` | ~1,393 | ~936 | ~817 | 0 | 3,146 |
| C. `packages/agent/src/server/events/**` only | ~198 | ~220 | ~52 | 108 | 578 |
| C. events plus overlapping `buildAgentComposition.ts` flag/wiring | ~285 | ~245 | ~52 | 108 | 690 |
| D. `packages/agent/src/server/agent-host/**` | ~87 | ~1,893 | ~4,267 | 13 | 6,260 |
| E. `packages/agent/src/front/chat/pi/**` + `packages/agent/src/front/chat/session/usePiSessions.ts` | ~1,397 | ~915 | ~1,848 | 0 | 4,160 |

### Summary allocation details

| area/file | DELETE | REPLACE | KEEP | UNSURE | check |
|---|---:|---:|---:|---:|---:|
| `packages/agent/src/server/pi-chat/PiAgentSessionAdapter.ts` | 0 | ~91 | ~50 | 0 | 141 |
| `packages/agent/src/server/pi-chat/harnessPiChatService.ts` | ~260 | ~715 | ~340 | 0 | 1,315 |
| `packages/agent/src/server/pi-chat/metering.ts` | ~150 | ~525 | ~160 | 0 | 835 |
| `packages/agent/src/server/pi-chat/piChatEvents.ts` | 76 | ~107 | ~400 | 0 | 583 |
| `packages/agent/src/server/pi-chat/piChatHistory.ts` | 0 | 0 | 258 | 0 | 258 |
| `packages/agent/src/server/pi-chat/piChatMessageMetadataReconciler.ts` | 404 | 0 | 0 | 0 | 404 |
| `packages/agent/src/server/pi-chat/piChatReplayBuffer.ts` | 144 | 0 | 0 | 0 | 144 |
| `packages/agent/src/server/pi-chat/piChatServiceLifecycle.ts` | 0 | 0 | 77 | 0 | 77 |
| `packages/agent/src/server/pi-chat/piChatSnapshot.ts` | ~23 | ~56 | 0 | 0 | 79 |
| `packages/agent/src/server/pi-chat/piSessionIdentity.ts` | 0 | ~34 | ~155 | 0 | 189 |
| `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts` | ~50 | ~206 | ~580 | 0 | 836 |
| `packages/agent/src/server/harness/pi-coding-agent/nativeSessionRename.ts` | 139 | 0 | 0 | 0 | 139 |
| `packages/agent/src/server/harness/pi-coding-agent/nativeSessionTranscript.ts` | 124 | 0 | 0 | 0 | 124 |
| `packages/agent/src/server/harness/pi-coding-agent/piFollowUpQueueCompat.ts` | 212 | 0 | 0 | 0 | 212 |
| `packages/agent/src/server/harness/pi-coding-agent/piSessionMessages.ts` | 50 | 0 | 0 | 0 | 50 |
| `packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts` | 0 | ~230 | 0 | 0 | 230 |
| `packages/agent/src/server/harness/pi-coding-agent/resourceSettingsManager.ts` | 0 | 0 | 63 | 0 | 63 |
| `packages/agent/src/server/harness/pi-coding-agent/sessionJsonlPrefix.ts` | 34 | 0 | 0 | 0 | 34 |
| `packages/agent/src/server/harness/pi-coding-agent/sessionReadability.ts` | 34 | 0 | 0 | 0 | 34 |
| `packages/agent/src/server/harness/pi-coding-agent/sessions.ts` | ~750 | ~500 | ~62 | 0 | 1,312 |
| `packages/agent/src/server/harness/pi-coding-agent/tool-adapter.ts` | 0 | 0 | 112 | 0 | 112 |
| `packages/agent/src/server/events/eventStreamStore.ts` | ~140 | ~220 | ~52 | 0 | 412 |
| `packages/agent/src/server/events/schemaVersion.ts` | 58 | 0 | 0 | 0 | 58 |
| `packages/agent/src/server/events/sqlStorage.ts` | 0 | 0 | 0 | 108 | 108 |
| `packages/agent/src/server/agent-host/buildAgentComposition.ts:29-115` | 87 | 0 | 0 | 0 | 87 |
| `packages/agent/src/server/agent-host/buildAgentComposition.ts:236-259,269` | 0 | ~25 | 0 | 0 | ~25 |
| D all file/function allocations above | ~87 | ~1,893 | ~4,267 | 13 | 6,260 |
| `packages/agent/src/front/chat/pi/piChatAssistantCommit.ts` | 306 | 0 | 0 | 0 | 306 |
| `packages/agent/src/front/chat/pi/piChatCommittedMessages.ts` | 0 | 20 | 0 | 0 | 20 |
| `packages/agent/src/front/chat/pi/piChatMessageMetadata.ts` | 14 | 0 | 0 | 0 | 14 |
| `packages/agent/src/front/chat/pi/piChatPartMerging.ts` | ~469 | 0 | ~23 moved | 0 | 492 |
| `packages/agent/src/front/chat/pi/piChatQueueState.ts` | ~73 | ~90 | 0 | 0 | 163 |
| `packages/agent/src/front/chat/pi/piChatReducer.ts` | ~242 | ~220 | ~390 | 0 | 852 |
| `packages/agent/src/front/chat/pi/piChatStore.ts` | 0 | 0 | 80 | 0 | 80 |
| `packages/agent/src/front/chat/pi/piChatStream.ts` | ~40 | ~60 | ~160 | 0 | 260 |
| `packages/agent/src/front/chat/pi/piFollowUpQueueController.ts` | ~21 | ~25 | ~160 | 0 | 206 |
| `packages/agent/src/front/chat/pi/remotePiSession.ts` | ~88 | ~360 | ~390 | 0 | 838 |
| `packages/agent/src/front/chat/pi/selectors.ts` | ~59 | ~20 | ~105 | 0 | 184 |
| `packages/agent/src/front/chat/session/usePiSessions.ts` | ~85 | ~120 | ~540 | 0 | 745 |

E direct answer: approximately 1,848/4,160 lines (44%) survive substantially unchanged, 915 (22%) retain responsibility with a new mechanism, and 1,397 (34%) disappear. For the three named files: reducer ~390 KEEP / ~220 REPLACE / ~242 DELETE; remote session ~390 KEEP / ~360 REPLACE / ~88 DELETE; sessions hook ~540 KEEP / ~120 REPLACE / ~85 DELETE.

## Ordering constraints

| order | prerequisite change | deletions unlocked | proof required before deletion |
|---:|---|---|---|
| 1 | Define canonical conversation record schema: admitted submission, projected/native events, exactly one terminal outcome, usage records, stable submission ID, opaque cursor | None yet | Schema includes tenant/workspace/agent/session identity and unknown-outcome state. |
| 2 | Implement host `ConversationRecordWriter`/reader with idempotent append and atomic durable admission | `piChatReplayBuffer.ts` only after readers switch | Crash test: admitted request survives before execution; duplicate admission does not duplicate record. |
| 3 | Implement at-least-once worker/runner over exactly-once recording | Host ledger/effect state machines later | Crash between admit/start/effect/terminal yields replay or explicit unknown, never silent duplicate terminal. |
| 4 | Define uncertain side-effect policy | Old `applyClassification`/synthetic failure logic later | Timeout after possible provider/tool effect surfaces unknown; it is not blindly retried. |
| 5 | Implement tenant-aware pi `SessionStorage`/`SessionRepo` backed by canonical record; load pi with canonical `messages` | Raw file/session wrappers after migration | Cross-workspace/user/runtime-scope conformance and stable public session ID. |
| 6 | Build legacy JSONL/wrapper/`ui_snapshot` importer and verify migration | `nativeSessionTranscript.ts`, `sessionJsonlPrefix.ts`, `piSessionMessages.ts`, raw portions of `sessions.ts`, `nativeSessionRename.ts` | Fixture/import counts, titles, timestamps, branches, attachments, pins, and no data loss. |
| 7 | Switch `createHarness.ts` to repo-backed/in-memory pi construction | `SessionManager.open` path, file delete monkeypatch, duplicate handle storage logic | One pi execution handle per tenant/session; delete-race fence; no second transcript writer. |
| 8 | Preserve recorded submitter auth context when queued work executes | private ALS follow-up wrapper if no longer needed | Two users/contexts queue work; each tool call receives its own recorded identity. |
| 9 | Provide public/native or safely isolated selective follow-up cancel with durable IDs | `piFollowUpQueueCompat.ts`, text/ordinal queue reconciliation | Duplicate text entries cancel the selected submission only; consumed retry dedup is durable. |
| 10 | Switch `HarnessPiChatService.readState` and `subscribe` to canonical record | `persistedStateDropsLiveMessages`, `canRefreshFromPersistedState`, `readDurableLatestPiChatSeq`, `hydrateDurableReplayBuffer`, replay buffer, metadata reconciler | Restart/resume returns same messages and opaque cursor with no `Math.max` fabrication. |
| 11 | Switch gateway `readSessionState`/`connectSession` and HTTP stream DTOs to opaque canonical cursor | Numeric seq/gap logic in frontend/server | Old/new protocol version rollout; client treats cursor as opaque and handles explicit reset. |
| 12 | Guarantee authoritative `message-end.final`, including abort/error/late tool-result semantics | Server agent-end final reconstruction; frontend assistant commit/part merge/selector folding | Final scope (message vs turn), stable ID, ordering, and late tool-result rule documented and tested. |
| 13 | Echo stable submission ID through receipt, queue, user message, terminal outcome | Client queue text/clientSeq reconciliation and optimistic rollback heuristics | Duplicate text and reconnect cases reconcile by ID only. |
| 14 | Add implicit-create admission endpoint/receipt returning addressed session ref | `usePiSessions` explicit empty create and boot-resume machinery | First prompt atomically creates/adopts session; rejection creates none; unknown result is recoverable. |
| 15 | Switch `AgentSessionInventory` to injected repo and canonical activity events | Direct `PiSessionStore` inventory path | Tenant list/pins/status remain isolated without booting pi sessions. |
| 16 | Switch gateway/reload/command effects to convergent runner | `requestLedger.ts`, `sqliteRequestLedger.ts`, much of `embeddedGateway.effect`, `createAgentHost.startPreparedEffect` | Migration of terminal receipts; legacy `in-flight` quarantined as outcome-unknown. |
| 17 | Decide digest ownership/API | `canonical.ts` | Byte-for-byte retry compatibility or explicit version migration. |
| 18 | Decide legacy `AgentTool` plugin export compatibility; migrate to pi extension/package sources or add a narrow adapter | Replace/retire `pluginLoader.ts` and rewrite its tests | Standalone default/`tools` exports either still load under sandbox/tenant policy or are explicitly unsupported with migration guidance; no global leakage. |
| 19 | Make canonical store mandatory at durable host root and complete deployment migration | `BORING_CHAT_DURABLE_STREAM`, old event schema/store/flag errors | No enabled deployment has unique records only in `.agent-event-stream.sqlite`; rollback plan closed. |
| 20 | Rewrite conformance/integration tests against new contracts | Old replay/merge/ledger tests | Auth, tenancy, transport, billing, cursor, durability, uncertainty, and migration gates green. |
| 21 | Remove dead exports/callers | `skillFrontmatter.ts` only if API consumer migrates; `piSessionIdentity.ts` only if repo owns it | `git grep origin/main` equivalent shows no consumer and replacement ownership is explicit. |

Cross-area callers that must change before event-store deletion:

| caller | current dependency | required change |
|---|---|---|
| `packages/agent/src/server/createAgent.ts` | Imports/exposes `EventStreamStore` option | Replace with canonical writer/repo option. |
| `packages/agent/src/server/pi-chat/harnessPiChatService.ts` | Imports `formatOffset`, `parseOffset`, `MAX_READ_LIMIT`, `EventStreamStore` | Remove numeric/event-store replay plumbing. |
| `packages/agent/src/server/agent-host/buildAgentComposition.ts` | Opens and injects optional `SqliteEventStreamStore` | Open/inject required canonical store. |
| `packages/agent/src/server/createStandaloneAgentHostApp.ts` | Calls legacy `pluginLoader.ts` | Supply pi extension/package paths/sources. |
| `packages/workspace/src/server/plugins/packageResources.ts` | Imports `parseSkillMetadataFrontmatter` | Keep wrapper or migrate caller directly before deleting dead/API seam. |

## Do not delete

| code/responsibility | why load-bearing for multi-tenancy/governance |
|---|---|
| `harnessPiChatService.toSessionCtx`, access checks, session cache partition | Converts authorized workspace/storage scope into storage identity. Replacement must also include runtime-scope identity where applicable. |
| `packages/agent/src/core/piChatSessionService.ts` (157), especially `PiSessionRequestContext` identity fields | `workspaceId`, `storageScope`, `authSubject`, `sessionAuthority`, and `runtimeScopeIdentity` are the authoritative tenant/runtime addressing contract. Change cursor/admission mechanism, not these semantics. |
| `packages/agent/src/server/trustedPiSessionBinding.ts` (107) | Workspace/user mismatch checks and the trusted binding boundary prevent a host bridge from binding the wrong tenant session. The legacy bridge mechanism may change; authorization checks must move intact. |
| tenant checks, namespace selection, runtime pin, and attachment authorization currently embedded in `sessions.ts` | Mechanism is replaceable; semantics prevent cross-tenant transcript/blob reads. Move them into repo before deleting file code. |
| `tool-adapter.ts` | Carries authenticated user/workspace/request identity into tools; native built-ins are disabled because host Workspace/Operations enforce sandbox boundaries. |
| `resourceSettingsManager.ts` | Stops host package injection from mutating user/global pi settings and applies package policy. |
| `PiChatServiceLifecycle` and harness/host incarnation fences | Prevent late adapter/session resurrection after delete and ensure drain/abort ownership. |
| attachment loading, type/size validation, URL projection | Host transport and authorized workspace/blob access. |
| metering sink and billing decision policy | Credits/pricing/reservations are host governance. Replace volatile coordinator, not responsibility. |
| recorded submitter context propagation for queued work | Without it, a later tool call can execute under the wrong user authorization. |
| `createAgentHost` scope verification and runtime capability authorization | Prevent cross-tenant and hidden-agent leaks; must run on every operation/open connection command. |
| session namespace hashing, runtime-scope identity, provisioning fingerprint | Bind logical session to correct physical tenant environment. |
| environment/workspace leases and guarded proxies | Bound provider capability lifetime, revocation, drain, and cleanup. |
| MCP grant store/resolver | Native tool schema availability is not authorization to use a tenant connector. |
| HTTP/SSE/NDJSON projections and stream cleanup | Transport, validation, cancellation, attachment safety, and resource cleanup remain host-owned. |
| `stableServiceError.ts` allowlist | Separates safe durable rejection from uncertain effect; should be a runner policy hook. |
| host-side durable-root selection | Canonical sessions/records must live on host volume, never ephemeral sandbox workspace. |
| `AgentSessionEventQueue` | Transport queue, not transcript/replay truth. Adapt it; do not delete merely because record storage changes. |
| `piChatStore`, core reducer/view projection, optimistic display, notices | Browser UI state. Simplify reconciliation but keep UI ownership. |
| `remotePiSession` authorization/storage-scope headers and addressed routes | Tenant routing and authorization. |
| `usePiSessions` source/data-scope keys, stale-response guards, delete tombstones, active selection | Prevent stale/cross-workspace list mutations and preserve scoped UI choice. |
| browser NDJSON framing, schema validation, reconnect/suspend/dispose, request timeouts | Transport lifecycle; not pi transcript parsing. |
| session list/rename/delete/pagination | Host multi-tenant storage/governance even when pi `SessionRepo` is the backing interface. |
| active-session selection persistence | Scoped browser preference. Delete only empty-session boot-resume keys, not active selection. |
| `packages/agent/src/server/http/routes/skills.ts` and `packages/agent/src/server/workspace/provisioning/skills.ts` | Host authorization, tenant locating/provisioning, management projection. They already delegate parsing/discovery to pi. |
| sandbox output caps | Host resource governance for custom tools; pi’s truncation only covers its native tools. |
| diff renderer | Presentation only. Do not confuse it with duplicated edit/patch execution. |

### Unresolved questions blocking specific deletes

| question | blocks |
|---|---|
| Is the convergent durability primitive an available library with digest/SQLite adapters, or only a contract? | `canonical.ts`, `sqlStorage.ts`, exact runner adapter shape. |
| Does authoritative `message-end.final` cover one assistant message or an entire assistant turn? | Adjacent merge deletion in `piChatAssistantCommit.ts`, reducer, selectors. |
| Can a tool-result arrive after authoritative final, and is tool-result itself authoritative? | Last ~23 lines of `piChatPartMerging.ts`; reducer pending-tool behavior. |
| Does pi expose public selective follow-up removal in the adopted version? | `piFollowUpQueueCompat.ts` private-field deletion. |
| How is the submitting auth context restored when pi drains a queued follow-up? | `rememberQueuedFollowUpRunContexts` and its private wrapper. |
| What is the implicit-create request/receipt shape and route? | `RemotePiSession.sessionId` optionality and `usePiSessions` explicit-create deletion. |
| How does an unbound unsent New Chat survive reload, if at all? | Browser draft persistence vs boot-resume deletion. |
| Are `piSessionIdentity.ts` and `skillFrontmatter.ts` intended public APIs? | Dead-code deletion; responsibilities are host-owned/delegating even if current internal use is absent. |
| Do any deployed flag-enabled event stores contain events not recoverable from native JSONL/canonical migration input? | Event store/schema/file deletion. |
| Which legacy request-ledger `in-flight` rows exist? | Ledger migration; must mark unknown rather than re-execute. |
