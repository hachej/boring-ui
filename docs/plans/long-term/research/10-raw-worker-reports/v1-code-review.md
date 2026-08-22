<table>
  <thead>
    <tr>
      <th>claim</th>
      <th>verdict</th>
      <th>evidence with file:line</th>
      <th>correction</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>C1: session state has exactly three owners</td>
      <td>WRONG</td>
      <td>
        <code>packages/agent/src/server/pi-chat/harnessPiChatService.ts:264-303</code><br>
        <code>readStateBeforeDispose</code> arbitrates the persisted transcript, live adapter snapshot, and in-memory replay-buffer sequence.
        With <code>eventStore</code> enabled, <code>:366-380</code> also reads the durable stream's sequence into the snapshot.
      </td>
      <td>The unqualified count is three only with the durability flag off; flag-on composition has a fourth state-bearing authority, the durable event stream.</td>
    </tr>
    <tr>
      <td>C1: the persisted transcript is one owner</td>
      <td>CONFIRMED</td>
      <td>
        <code>packages/agent/src/server/pi-chat/harnessPiChatService.ts:366-380</code><br>
        The code calls <code>sessionStore.loadEntries(...)</code> and turns its raw <code>messages</code> into <code>buildPiChatHistory(messages, ...)</code>.
      </td>
      <td>Call this the persisted Pi transcript projection, not the only durable state when the event-store flag is on.</td>
    </tr>
    <tr>
      <td>C1: the live Pi session is one owner</td>
      <td>CONFIRMED</td>
      <td>
        <code>packages/agent/src/server/pi-chat/harnessPiChatService.ts:273-301</code><br>
        The fallback snapshot is built from <code>buildPiChatSnapshot(adapter, ...)</code>; <code>:314-320</code> separately counts <code>adapter.readSnapshot().messages</code> to veto stale persisted history.
      </td>
      <td>The live adapter is explicitly treated as snapshot authority whenever persisted state is unsafe or unavailable.</td>
    </tr>
    <tr>
      <td>C1: the replay buffer is one owner</td>
      <td>CONFIRMED</td>
      <td>
        <code>packages/agent/src/server/pi-chat/harnessPiChatService.ts:281,295-300</code><br>
        Both persisted and live snapshot paths derive the exposed cursor from <code>channel.buffer.latestSeq</code>.
        <code>packages/agent/src/server/pi-chat/piChatReplayBuffer.ts:30-100</code> owns retained ranges and gap/ahead decisions.
      </td>
      <td>The in-memory buffer is a real replay authority even though it does not own the full message history.</td>
    </tr>
    <tr>
      <td>C1: the durable event store is not another owner</td>
      <td>WRONG</td>
      <td>
        <code>packages/agent/src/server/pi-chat/harnessPiChatService.ts:731-765</code><br>
        Every enriched event is appended before fan-out at <code>:753</code>.
        <code>:947-948,1018-1056</code> recreate the in-memory replay buffer from durable events after restart.
      </td>
      <td>When configured, the event store supplies both snapshot cursor state and replay contents; it is not merely an inert sink.</td>
    </tr>
    <tr>
      <td>C1 companion rationale: five mutable maps</td>
      <td>WRONG</td>
      <td>
        <code>packages/agent/src/server/pi-chat/harnessPiChatService.ts:97-110</code><br>
        Top-level fields include maps for channels, channel creations, generations, active runs, synthetic failures, active synthetic errors, and live attachments: at least seven, before maps inside the metadata reconciler.
      </td>
      <td>Do not use “five maps” as a reproducible measurement of the seam.</td>
    </tr>
    <tr>
      <td>C2: snapshot uses <code>Math.max(persisted.seq, liveSeq)</code></td>
      <td>CONFIRMED</td>
      <td>
        <code>packages/agent/src/server/pi-chat/harnessPiChatService.ts:281-290</code><br>
        The exact main code is <code>const liveSeq = this.channels.get(sessionKey)?.buffer.latestSeq ?? 0</code> and, at line 289, <code>seq: Math.max(persisted.seq, liveSeq),</code>.
      </td>
      <td>The quoted expression exists verbatim at <code>origin/main</code> commit <code>e546c3807</code>.</td>
    </tr>
    <tr>
      <td>C2: that cursor is “fabricated” to reconcile stores</td>
      <td>CONFIRMED</td>
      <td>
        <code>packages/agent/src/server/pi-chat/harnessPiChatService.ts:286-288</code><br>
        The comment says a transcript snapshot can include already-rendered live turns and therefore its cursor “must fence their in-memory replay.”
      </td>
      <td>“Fabricated” is polemical but materially fair: the returned cursor is synthesized from two authorities rather than read from the same source as the messages.</td>
    </tr>
    <tr>
      <td>C3: <code>piChatReducer.ts</code> is 852 lines</td>
      <td>CONFIRMED</td>
      <td>
        <code>packages/agent/src/front/chat/pi/piChatReducer.ts:1-852</code><br>
        <code>git show origin/main:packages/agent/src/front/chat/pi/piChatReducer.ts | wc -l</code> returns <code>852</code>.
      </td>
      <td>The physical file count is exact; its attribution to reconciliation is not.</td>
    </tr>
    <tr>
      <td>C3: <code>remotePiSession.ts</code> is 838 lines</td>
      <td>CONFIRMED</td>
      <td>
        <code>packages/agent/src/front/chat/pi/remotePiSession.ts:1-838</code><br>
        The exact <code>origin/main</code> line count is <code>838</code>.
      </td>
      <td>The count is right, but the file also owns HTTP, authentication headers, aborts, reconnect scheduling, suspension, disposal, and diagnostics.</td>
    </tr>
    <tr>
      <td>C3: <code>usePiSessions.ts</code> is 745 lines</td>
      <td>CONFIRMED</td>
      <td>
        <code>packages/agent/src/front/chat/session/usePiSessions.ts:1-745</code><br>
        The exact <code>origin/main</code> line count is <code>745</code>.
      </td>
      <td>The count is right, but session list/pagination, rename, delete, selection, stale guards, and disposal are not caused by three state owners.</td>
    </tr>
    <tr>
      <td>C3: harness reconciliation is about 600 lines</td>
      <td>UNVERIFIABLE</td>
      <td>
        <code>packages/agent/src/server/pi-chat/harnessPiChatService.ts:1-1315</code><br>
        Main contains 1,315 physical lines. No source annotation or reproducible function set defines the claimed 600.
        The narrow persisted/live arbitration is <code>:264-385</code>; event/replay dual plumbing is <code>:731-785,936-1069</code>.
      </td>
      <td>Publish the exact counted ranges/functions. “~600” is currently an invented classification, not a checkable measurement.</td>
    </tr>
    <tr>
      <td>C3: the four published rows total about 3,700</td>
      <td>WRONG</td>
      <td>
        <code>scratchpad/boring-vs-flue.html:411-415</code><br>
        The rows are approximately <code>600 + 852 + 838 + 745 = 3,035</code>, not 3,700.
        Using the whole 1,315-line harness instead yields <code>1,315 + 852 + 838 + 745 = 3,750</code>.
      </td>
      <td>The headline silently substitutes the whole harness for its own “~600 reconciliation” row. This is a direct arithmetic failure.</td>
    </tr>
    <tr>
      <td>C3: about 3,700 lines exist to manage the disagreement</td>
      <td>OVERSTATED</td>
      <td>
        <code>packages/agent/src/server/pi-chat/harnessPiChatService.ts:247-258,339-364,1087-1097,1198-1266</code><br>
        Those ranges are attachments, authorization, session keys, workspace image loading, and validation.
        <code>usePiSessions.ts:23-85,563-611</code> covers broad CRUD and opaque list pagination.
      </td>
      <td>At most 3,750 is an upper bound on four entire files touched by the seam. It is not a count of code whose reason to exist is the seam.</td>
    </tr>
    <tr>
      <td>C3 footer: “upper bounds” makes the total honest</td>
      <td>OVERSTATED</td>
      <td>
        <code>scratchpad/plan.html:148-150</code><br>
        The footer calls estimates upper bounds, but the body states “About 3,700 lines exist to manage that disagreement” without showing that it counted full files or that its displayed components sum to only 3,035.
      </td>
      <td>Change the headline to “four affected files total 3,750 lines; deletable reconciliation is unmeasured.”</td>
    </tr>
    <tr>
      <td>C4/L1: a reconciliation layer exists</td>
      <td>CONFIRMED</td>
      <td>
        <code>packages/agent/src/server/pi-chat/piChatMessageMetadataReconciler.ts:22-404</code><br>
        It maintains volatile prompt/follow-up/message maps and reattaches identity.
        <code>piChatReplayBuffer.ts:30-144</code> separately owns numeric replay state.
      </td>
      <td>A canonical record can plausibly remove substantial metadata, state arbitration, and replay duplication.</td>
    </tr>
    <tr>
      <td>C4/L1: durability deletes “the reconciliation layer” wholesale</td>
      <td>OVERSTATED</td>
      <td>
        <code>packages/agent/src/server/pi-chat/harnessPiChatService.ts:133-258,842-989,1076-1097</code><br>
        Lifecycle draining, access checks, attachments, adapter ownership, cold-open single-flight, incarnation fencing, and transport responsibilities remain load-bearing.
      </td>
      <td>Describe this as replacement of specific arbitration/replay mechanisms, with migration and retained host responsibilities, not blanket deletion.</td>
    </tr>
    <tr>
      <td>C4/L2: client cursor arithmetic exists</td>
      <td>CONFIRMED</td>
      <td>
        <code>packages/agent/src/front/chat/pi/piChatReducer.ts:198-200,316-329</code><br>
        It compares integers, computes <code>expectedSeq = lastSeq + 1</code>, and detects gaps.
        <code>piChatStream.ts:116-120</code> repeats the same numeric ordering logic.
      </td>
      <td>An opaque cursor contract can delete/replace the client-side ordering arithmetic.</td>
    </tr>
    <tr>
      <td>C4/L2: opaque cursors delete the client stream/session layer</td>
      <td>OVERSTATED</td>
      <td>
        <code>packages/agent/src/front/chat/pi/piChatStream.ts:41-114,189-260</code><br>
        NDJSON framing, schema validation, URL construction, and transport scheduling remain.
        <code>remotePiSession.ts:339-538,543-631</code> still needs fetch, auth, reconnect, suspend, and dispose behavior.
      </td>
      <td>Only numeric cursor comparison/range recovery disappears; transport lifecycle remains.</td>
    </tr>
    <tr>
      <td>C4/L4: Boring duplicates Pi transcript handling</td>
      <td>CONFIRMED</td>
      <td>
        <code>packages/agent/src/server/harness/pi-coding-agent/nativeSessionTranscript.ts:1-124</code><br>
        It manually scans native JSONL. Related raw-format code exists in <code>sessionJsonlPrefix.ts:1-34</code>, <code>nativeSessionRename.ts:1-139</code>, and <code>sessions.ts:1059-1312</code>.
      </td>
      <td>Transcript wrappers/scanners are real convergence candidates, subject to legacy migration.</td>
    </tr>
    <tr>
      <td>C4/L4: Boring reimplements Pi compaction</td>
      <td>WRONG</td>
      <td>
        <code>packages/agent/src/server/harness/pi-coding-agent/sessions.ts:361-403</code><br>
        The code removes legacy <code>ui_snapshot</code> bloat and explicitly distinguishes the full transcript from Pi's compacted LLM working context.
        No custom LLM compactor exists in the audited production code.
      </td>
      <td>Say “legacy UI-snapshot cleanup/raw transcript migration,” not “stop reimplementing compaction.”</td>
    </tr>
    <tr>
      <td>C4/L4: Boring reimplements Pi skill parsing</td>
      <td>WRONG</td>
      <td>
        <code>packages/agent/src/server/skillFrontmatter.ts:21,28-35</code><br>
        The 36-line wrapper directly imports and calls Pi's <code>parseFrontmatter</code>.
        <code>createHarness.ts:614-642</code> uses Pi's <code>DefaultResourceLoader</code> and <code>loadSkills</code>.
      </td>
      <td>The current code already delegates parsing/discovery to Pi; host wrappers and policy are not a duplicate parser.</td>
    </tr>
    <tr>
      <td>C4/L4: Boring duplicates Pi tool schemas</td>
      <td>WRONG</td>
      <td>
        <code>packages/agent/src/shared/tool.ts:1-41</code>, <code>validateTool.ts:1-11</code>, <code>tool-adapter.ts:46-70</code><br>
        These define and validate the host custom-tool boundary and carry auth/request context into execution.
        <code>createHarness.ts:649-653</code> deliberately disables native built-ins and supplies governed host tools.
      </td>
      <td>This is a host capability/security boundary. It may be adapted, but “pure deletion” would remove required governance.</td>
    </tr>
    <tr>
      <td>C4/L4: Boring duplicates Pi truncation</td>
      <td>WRONG</td>
      <td>
        <code>packages/agent/src/shared/sandbox.ts:68-80,105-110</code><br>
        The host sandbox contract requires <code>maxOutputBytes</code> enforcement and reports truncation for governed custom operations.
      </td>
      <td>Pi native-tool truncation does not replace host custom-tool/sandbox output limits.</td>
    </tr>
    <tr>
      <td>C4/L4: Boring duplicates Pi diff</td>
      <td>WRONG</td>
      <td>
        <code>packages/agent/src/front/bareToolRenderers/DiffView.tsx:1-83</code><br>
        It imports React and <code>createPatch</code> and renders a collapsible visual diff; it does not execute edit/diff/patch operations.
      </td>
      <td>This is presentation code, not a competing agent diff engine.</td>
    </tr>
    <tr>
      <td>C4/L4: Pi convergence is “pure deletion”</td>
      <td>WRONG</td>
      <td>
        <code>packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts:1-230</code><br>
        Even the questionable loader mixes compatibility/export work with native resource loading.
        The alleged compaction, skill, schema, truncation, and diff duplicates are absent or load-bearing, while raw transcript code needs migration.
      </td>
      <td>Split L4 into verified raw-transcript/queue shims and retained host policy/UI integrations. It is not one pure-deletion lane.</td>
    </tr>
    <tr>
      <td>C4/L5: metering is coupled to Pi event order</td>
      <td>CONFIRMED</td>
      <td>
        <code>packages/agent/src/server/pi-chat/metering.ts:270-288,496-561</code><br>
        <code>PiChatMeteringCoordinator.observe</code> correlates accepted runs to native/enriched event order.
        <code>harnessPiChatService.ts:976-984</code> calls it from the event subscription.
      </td>
      <td>A canonical recorded runtime stream can remove volatile event-correlation logic.</td>
    </tr>
    <tr>
      <td>C4/L5: observability deletes metering coupling</td>
      <td>OVERSTATED</td>
      <td>
        <code>packages/agent/src/server/pi-chat/metering.ts:27-128,223-268,741-803</code><br>
        Host sink contracts, reservation policy, usage normalization, settlement, release, and billing decisions remain.
        The file is 835 lines, but not all 835 are volatile coupling.
      </td>
      <td>Say “replace the event-order coordinator and keep the billing boundary/policy,” not “delete metering.”</td>
    </tr>
    <tr>
      <td>C5: tenant checks exist</td>
      <td>CONFIRMED</td>
      <td>
        <code>packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:370-388</code><br>
        Verification rejects non-Core scopes, reloads workspace/user state, checks <code>workspaceStore.isMember(...)</code>, and rejects a foreign app or removed membership.
      </td>
      <td>“Tenant” is concretely app/workspace/user membership rather than a separately named tenant object.</td>
    </tr>
    <tr>
      <td>C5: scope verification occurs on every operation</td>
      <td>OVERSTATED</td>
      <td>
        <code>packages/agent/src/server/agent-host/embeddedGateway.ts:245-247,250-377,418-455,531-550</code><br>
        Public Gateway entry points and live-connection commands call runtime verification.
        <code>createAgentHost.ts:340-346</code> delegates to the host verifier.
      </td>
      <td>Use the bounded claim: every public Agent Gateway operation and each live-connection operation is reverified. “Every operation” repository-wide is too broad.</td>
    </tr>
    <tr>
      <td>C5: MCP grants exist</td>
      <td>CONFIRMED</td>
      <td>
        <code>packages/agent/src/server/agent-host/mcpGrants.ts:41-47,94-167</code><br>
        Grants are workspace/agent/connector/tool scoped, default-deny, filter exact workspace/agent pairs, drop ungranted refs, and intersect known tools.
      </td>
      <td>The keep-item is accurate.</td>
    </tr>
    <tr>
      <td>C5: lease fences exist</td>
      <td>CONFIRMED</td>
      <td>
        <code>packages/agent/src/server/agent-host/workspaceAgentLease.ts:86-103,136-147,188-229</code><br>
        The lease verifies the actor, races tracked operations against revocation, establishes the revocation boundary before release, and guards workspace methods.
      </td>
      <td>The keep-item is accurate and load-bearing.</td>
    </tr>
    <tr>
      <td>C5: workspace path authority exists</td>
      <td>CONFIRMED</td>
      <td>
        <code>packages/boring-sandbox/src/providers/node-workspace/paths.ts:47-103</code><br>
        Path resolution rejects absolute/traversal/shell-like/outside-root paths and symlink escapes.
        <code>createNodeWorkspace.ts:46-148</code> routes filesystem operations through those checks.
      </td>
      <td>The keep-item is accurate at the Workspace adapter boundary.</td>
    </tr>
    <tr>
      <td>C5: submitter identity reaches tool calls</td>
      <td>CONFIRMED</td>
      <td>
        <code>packages/agent/src/server/pi-chat/harnessPiChatService.ts:862-871</code><br>
        It sets <code>RunContext.userId</code> from <code>ctx.authSubject</code>.
        <code>tool-adapter.ts:53-70</code> passes user/email/workspace/request fields into <code>tool.execute</code>.
      </td>
      <td>Accurate when identity is known; the shared tool contract permits those context fields to be absent.</td>
    </tr>
    <tr>
      <td>C5: host durable-root selection exists</td>
      <td>CONFIRMED</td>
      <td>
        <code>packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:394-399,1053-1057</code><br>
        Hosted composition chooses explicit root, then <code>BORING_AGENT_SESSION_ROOT</code>, then a host-side inferred sibling.
        <code>buildAgentComposition.ts:44-63</code> forbids durable-store fallback to a guest workspace and fails loudly.
      </td>
      <td>Do not generalize to every standalone mode: <code>sessions.ts:59-64</code> can fall back to <code>~/.pi/agent/sessions</code>.</td>
    </tr>
    <tr>
      <td>C6: issue #979 is “implicit sessions”</td>
      <td>OVERSTATED</td>
      <td>
        GitHub #979 title/body: “Give the addressed Agent Gateway a native first-send so the dual prompt path disappears.”<br>
        <code>packages/agent/src/server/agent-host/httpProjection.ts:321-338,515-526</code> still exposes explicit create and prompt routes on main.
      </td>
      <td>Call #979 “addressed atomic native first-send / remove dual prompt path.” Implicit creation is a consequence, not the complete issue description.</td>
    </tr>
    <tr>
      <td>C6: issue #1009 is the proposed canonical writer/settlement lane</td>
      <td>WRONG</td>
      <td>
        GitHub #1009 is “Lane: chat streaming durability (Level B → Level D).”<br>
        <code>docs/direction/STATE.md:28</code> says the lane is wired; <code>buildAgentComposition.ts:239-255,267-269</code> wires and closes the flag-gated SQLite event store.
      </td>
      <td>Separate already-wired #1009 durable replay work from the new accepted-work, settlement, incarnation, and admission redesign.</td>
    </tr>
    <tr>
      <td>C6: issue #1127 is “channels”</td>
      <td>CONFIRMED</td>
      <td>
        <code>docs/issues/1127/plan.md:1-26</code><br>
        The exact issue is external channels consuming agents, with WhatsApp first and email/SMS class later.
      </td>
      <td>The broad label is accurate; “WhatsApp first, email/SMS later” is the precise current scope.</td>
    </tr>
    <tr>
      <td>C6/L3: channel-answerable human intention is in flight</td>
      <td>WRONG</td>
      <td>
        <code>docs/direction/STATE.md:33</code> and <code>docs/direction/DIRECTION.md:230-231,291</code><br>
        #1127 has a ratified plan, zero implementation, and is deprioritized.
        <code>docs/issues/1127/plan.md:160-167,231-233,285-287</code> defers channel answering from v1 to a stretch slice.
      </td>
      <td>Local Inbox/Human Intention work may exist, but channel-answering is neither implemented nor currently in flight.</td>
    </tr>
    <tr>
      <td>C6/L3 dependency: channel-answerable needs only L0's record shape</td>
      <td>WRONG</td>
      <td>
        <code>docs/issues/1127/plan.md:19-35,160-167,285-287</code><br>
        Channel delivery needs durable streams/session addressing, identity mapping, delivery semantics, provider-edge work, and the separate answer seam.
      </td>
      <td>Split local human-intention durability from channel delivery; the latter depends on #1127 infrastructure and more than L0.</td>
    </tr>
    <tr>
      <td>C7: first-party versus third-party authored agents is open</td>
      <td>UNVERIFIABLE</td>
      <td>
        <code>packages/agent/src/server/agentDefinition/materializeAgentDirectory.ts:64-70</code><br>
        Main supports declarative authored identity/instructions while reserving executable behavior to trusted host/plugin policy.
        <code>compileAgentDirectory.ts:447-462</code> compiles plugin-shaped persona packages.
      </td>
      <td>The technical substrate is partly present, but who may author/distribute agents is a product-policy decision not encoded by main.</td>
    </tr>
    <tr>
      <td>C7: whether <code>message-end.final</code> is message- or turn-scoped is open</td>
      <td>WRONG</td>
      <td>
        <code>packages/agent/src/shared/chat/piChatEvent.ts:7-10,24</code><br>
        <code>message-end</code> carries one <code>messageId</code> and one <code>BoringChatMessage</code>; turn settlement is the distinct <code>agent-end</code> event.
        <code>piChatEvents.ts:258-278</code> maps one upstream message end to one final.
      </td>
      <td><code>message-end.final</code> covers one message, not a whole turn.</td>
    </tr>
    <tr>
      <td>C7: whether tool results can arrive after final is open</td>
      <td>WRONG</td>
      <td>
        <code>packages/agent/src/front/chat/pi/piChatReducer.ts:349-354,468-500</code><br>
        The reducer commits final and later searches committed messages when applying a tool result.
        <code>piChatReducer.test.ts:1194-1213</code> explicitly tests a delayed tool result at seq 5 after final at seq 4.
      </td>
      <td>Yes: the accepted Boring protocol/reducer semantics support a tool result after a message final.</td>
    </tr>
    <tr>
      <td>C7: whether Pi exposes selective follow-up cancellation is open</td>
      <td>WRONG</td>
      <td>
        <code>packages/agent/src/server/harness/pi-coding-agent/piFollowUpQueueCompat.ts:35-39,161-183</code><br>
        Main states Pi does not expose selective removal and accesses private <code>_followUpMessages</code>, <code>followUpQueue.messages</code>, and <code>_emitQueueUpdate</code> to emulate it.
      </td>
      <td>No public selective-cancel API exists in the Pi version pinned by main; the compatibility shim is presently necessary.</td>
    </tr>
    <tr>
      <td>C7: deployment records recoverable only from the event store</td>
      <td>UNVERIFIABLE</td>
      <td>
        <code>packages/agent/src/server/agent-host/buildAgentComposition.ts:29-42</code> makes the store flag-gated.<br>
        <code>harnessPiChatService.ts:731-765,1007-1068</code> proves it can contain restart-replay records.
        <code>harnessPiChatService.eventStore.test.ts:350-368</code> proves restart recovery from it.
      </td>
      <td>The code proves event-store-only replay data can exist; only deployment/database inspection can establish whether real migrations currently depend on it.</td>
    </tr>
    <tr>
      <td>C8: every L0-L7 item blocks something else</td>
      <td>WRONG</td>
      <td>
        <code>scratchpad/plan.html:91-97,133-136</code><br>
        The plan's own dependency graph labels L6 and L7 independent, while the prose later says every item “blocks something else.”
      </td>
      <td>Some lanes are independent and deferred; remove the self-justifying blocker claim.</td>
    </tr>
    <tr>
      <td>C8: L3 is the lane with work already in flight</td>
      <td>OVERSTATED</td>
      <td>
        <code>docs/direction/STATE.md:18,33</code><br>
        Local inline/Inbox seeds exist, but unified cross-surface approvals remain missing; external channels have zero implementation and are deprioritized.
      </td>
      <td>Narrow this to local Inbox/Human Intention work. Do not imply the whole durable, approval-capability, channel-answerable lane is active.</td>
    </tr>
    <tr>
      <td>C8: #1009 durability still waits on L0</td>
      <td>WRONG</td>
      <td>
        <code>docs/direction/STATE.md:28</code><br>
        Main calls Wave 2 streaming durability “Wired.”
        <code>buildAgentComposition.ts:239-255</code> already constructs and injects the store behind <code>BORING_CHAT_DURABLE_STREAM</code>.
      </td>
      <td>The broader canonical-record proposal may need L0, but the existing #1009 lane does not.</td>
    </tr>
    <tr>
      <td>C8: L4 can safely delete all named areas after L1</td>
      <td>WRONG</td>
      <td>
        <code>packages/agent/src/server/harness/pi-coding-agent/tool-adapter.ts:46-70</code><br>
        Tool adaptation carries submitter/workspace/request authority, one of the plan's own “keep” invariants.
        <code>shared/sandbox.ts:68-80</code> and <code>DiffView.tsx:44-70</code> are host governance/UI, not transcript ownership.
      </td>
      <td>The plan's L4 deletion promise directly conflicts with its governance keep-list.</td>
    </tr>
    <tr>
      <td>C8: the one-page plan is broadly accurate</td>
      <td>WRONG</td>
      <td>
        The exact cursor line and three frontend line counts are accurate, and all seven governance primitives have real code.<br>
        However, the central 3,700-line arithmetic fails, the three-owner count fails under the shipped flag, most L4 duplication claims are false, three “open” questions are answered, and L3/#1009 status/dependencies are stale or conflated.
      </td>
      <td>The document has a sound architectural concern but does not meet a factual one-page-plan bar without substantial correction.</td>
    </tr>
  </tbody>
</table>

## Most serious problems

1. **The 3,700-line headline is arithmetically false.** Its displayed components total 3,035. The only route to ~3,700 is silently counting all 1,315 lines of `harnessPiChatService`, contradicting the same table's “~600 reconciliation” entry and sweeping in auth, attachments, lifecycle, transport, and workspace validation.

2. **L4's “pure deletion” claim is factually broken.** Raw transcript wrappers are real duplication, but there is no custom LLM compactor; skill parsing already delegates to Pi; tool schemas/adaptation carry host authority; truncation is a sandbox contract; and diff is a React renderer. Deleting those would remove governance or UI, not redundant Pi machinery.

3. **“Three owners” omits the flag-enabled durable event store.** It is written before fan-out, supplies cold snapshot sequence, and rehydrates replay after restart. Under that shipped configuration the service has four state-bearing authorities, not three.

4. **Three of five “open questions” are already answered by main.** `message-end.final` is one-message scoped; delayed tool results after final are explicitly reducer-supported and tested; and pinned Pi lacks public selective follow-up cancellation, hence the private compatibility shim.

5. **The issue/status/dependency story is materially conflated.** #979 is native addressed first-send, not merely “implicit sessions”; #1009's replay durability is already wired and is not the proposed settlement system; #1127 channel answering has zero implementation, is deprioritized, and depends on more than L0.

6. **The plan overstates deletability across L1/L2/L5.** Canonical records and opaque cursors can remove real reconciliation and arithmetic, but transport, authorization, lifecycle, attachments, UI projection, billing policy, and durable settlement remain.

7. **The governance keep-list is the strongest section, but one phrase is too broad.** Tenant membership checks, MCP grants, lease fences, workspace path authority, submitter identity propagation, and hosted durable-root selection all exist. “Scope verification on every operation” should be bounded to public Gateway/live-connection operations.

8. **The document is internally self-contradictory.** It labels L6 and L7 independent, then says every item blocks something else. That is self-justification, not sequencing evidence.

Issue verification note: direct `gh issue view 979/1009/1127` was attempted and failed because this environment could not connect to `api.github.com`. Exact issue titles/bodies were then retrieved through the installed GitHub connector and cross-checked against `origin/main`'s tracked issue plans/direction documents. All code quotations and line numbers above come from `git show origin/main:<path>` at `e546c3807687890b55538cddb3e275ff60981905`.
