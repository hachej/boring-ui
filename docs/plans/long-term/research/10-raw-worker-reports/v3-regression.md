<table>
<thead>
<tr>
<th>item</th>
<th>verdict</th>
<th>evidence file:line</th>
<th>what to write instead</th>
</tr>
</thead>
<tbody>
<tr><td>R1 — §07 correction: “~3,700 lines” becomes 3,035.</td><td>STILL WRONG</td><td>
<code>plan.html:81-85,207</code><br>
The arithmetic <code>600 + 852 + 838 + 745 = 3,035</code> is correct, but the first addend is still unsupported.
At current <code>origin/main</code> (<code>d1719dfda</code>), the physical files remain 1,315, 852, 838, and 745 lines.
The three complete client files therefore total 2,435; all four complete files total 3,750.
<code>v1-code-review.md:114-121</code> explicitly required a reproducible function/range definition for the claimed ~600, and rev 2 supplies none.
</td><td>
“The three complete client files total 2,435 lines. The complete harness is another 1,315 lines. Harness reconciliation has not been measured reproducibly, so no combined seam total is claimed.”
</td></tr>
<tr><td>R1a — Which harness functions a narrow reconciliation count should include.</td><td>NEWLY WRONG</td><td>
<code>origin/main:packages/agent/src/server/pi-chat/harnessPiChatService.ts:264-303</code> <code>readStateBeforeDispose</code>;<br>
<code>:314-321</code> <code>persistedStateDropsLiveMessages</code>;<br>
<code>:323-331</code> <code>canRefreshFromPersistedState</code>;<br>
<code>:333-337</code> <code>harnessMayHaveLiveSession</code>;<br>
<code>:366-385</code> <code>readPersistedState</code>;<br>
<code>:391-397</code> <code>subscribeBeforeDispose</code>;<br>
<code>:731-785</code> <code>publishChannelEvents</code> and <code>publishChannelEventSync</code>;<br>
<code>:936-989</code> <code>buildChannel</code>;<br>
<code>:992-1005</code> <code>readDurableLatestPiChatSeq</code>;<br>
<code>:1018-1069</code> <code>hydrateDurableReplayBuffer</code>.<br>
Those whole named ranges total 264 physical lines. Even the coarse contiguous blocks <code>264-385</code>, <code>731-785</code>, and <code>936-1069</code> total only 311 lines and include unrelated attachment/channel work.
No disclosed selection reaches ~600 without adding transport, lifecycle, authorization, prompt, or error paths that are not reconciliation-only.
</td><td>
“A narrow, reproducible reconciliation set is the ten named functions above (264 physical lines before subtracting mixed responsibilities). Treat any broader figure as code touched by the service, not reconciliation.”
</td></tr>
<tr><td>R2 — §07 correction: three owners becomes four under the flag-enabled configuration.</td><td>FIXED</td><td>
<code>origin/main:packages/agent/src/server/pi-chat/harnessPiChatService.ts:264-303</code> arbitrates the persisted transcript, live adapter, and replay buffer.<br>
<code>:731-765</code> appends to the event store before fan-out.<br>
<code>:936-1069</code> creates the stream, reads its sequence, and rehydrates the replay buffer.<br>
That makes the event store a fourth state-bearing authority when configured.
</td><td>
“Session state has three authorities by default and four when the opt-in durable-stream store is enabled.”
</td></tr>
<tr><td>R2a — Whether the fourth-owner flag is enabled anywhere by default.</td><td>NEWLY WRONG</td><td>
<code>origin/main:packages/agent/src/server/agent-host/buildAgentComposition.ts:29-42</code> says the flag is absent by default and accepts only <code>BORING_CHAT_DURABLE_STREAM=1|true</code>.<br>
<code>:239-255</code> injects the event store only when that predicate is true.<br>
A repository-wide <code>origin/main</code> search finds no deployment/config default that sets the flag; the other occurrences are documentation noting that it is flag-gated.
The phrase “shipped flag-enabled configuration” is technically possible but hides that normal composition is still three-owner.
</td><td>
“Default composition has three authorities. A shipped but opt-in code path adds a fourth when an operator explicitly sets <code>BORING_CHAT_DURABLE_STREAM=1</code> or <code>true</code>; no checked-in deployment enables it by default.”
</td></tr>
<tr><td>R3 — §07 correction: L4 is no longer broad “pure deletion.”</td><td>OVERCORRECTED</td><td>
<code>plan.html:108,123-127,209</code> narrows L4 to “Raw transcript wrappers only” and says only those wrappers are true duplication.<br>
The five rejected examples were correctly removed: no custom LLM compactor; skill discovery delegates to Pi; tool adaptation carries host authority; truncation is a sandbox contract; diff is presentation.<br>
But <code>origin/main:packages/agent/src/server/harness/pi-coding-agent/piFollowUpQueueCompat.ts:35-47,49-135,161-183</code> is genuine non-transcript Pi convergence debt: it maintains a second queue, nonce memory, selective removal, and directly mutates Pi private fields.<br>
<code>v1-code-review.md:249-256</code> explicitly said “raw-transcript/queue shims”; rev 2 silently drops the queue half.
</td><td>
“Verified Pi-convergence candidates include raw transcript wrappers/scanners and the private follow-up queue compatibility layer. Keep host policy, tool authority, sandbox limits, renderers, and legacy migration until separately proven replaceable.”
</td></tr>
<tr><td>R3a — Standalone extension loading is another possible non-transcript convergence candidate.</td><td>OVERCORRECTED</td><td>
<code>origin/main:packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts:1-230</code> independently discovers <code>.pi/extensions</code>, global extensions, npm packages, config, imports, and tool exports.<br>
<code>origin/main:packages/agent/src/server/createStandaloneAgentHostApp.ts:259-263</code> uses that loader.<br>
Meanwhile <code>origin/main:packages/agent/src/server/harness/pi-coding-agent/createHarness.ts:614-644</code> uses Pi’s <code>DefaultResourceLoader</code> for packages/extensions/skills.<br>
The overlap is not automatically deletable because the standalone loader enforces a host tool shape and deployment policy, but “raw wrappers only” is false before this overlap is resolved.
</td><td>
“Audit standalone extension discovery against Pi’s supported resource loader. Converge only the duplicated discovery/import mechanics; retain host validation and trust policy.”
</td></tr>
<tr><td>R4 — §07 correction: the displayed schema is a proposal, not an eleven-framework intersection.</td><td>FIXED</td><td>
<code>plan.html:130-133,210</code> now labels the schema a proposal synthesized mainly from Flue and eve, with local tenancy fields, and explicitly says the surveyed systems do not share the full contract.<br>
That matches the replacement demanded by <code>v2-flue-review.md:474-500</code>.
</td><td>
Keep the current proposal attribution, but distinguish every locally renamed field from a field actually present in a source system.
</td></tr>
<tr><td>R4a — New schema annotation: <code>idempotency_key</code> is “our own; not a public Flue field.”</td><td>NEWLY WRONG</td><td>
<code>plan.html:134-138</code> makes this new claim.<br>
<code>v2-flue-review.md:122-138</code> records that Flue 2.0.3’s public declaration contains <code>idempotencyKey?: string</code>; only its bundled reference page is stale and omits it.<br>
Snake_case is a local spelling, not a locally invented capability.
</td><td>
“<code>idempotency_key?</code> — local snake_case mapping of Flue’s public <code>idempotencyKey</code>; Flue’s bundled reference page is stale.”
</td></tr>
<tr><td>R4b — Flue box still says “a conversation-record writer is injected.”</td><td>STILL WRONG</td><td>
<code>plan.html:93-96</code> leaves the injection target ambiguous immediately after saying Pi is constructed with an in-memory message array.<br>
<code>v2-flue-review.md:52-59</code> found that the writer is injected into Flue’s session wrapper, not into Pi’s <code>Agent</code> constructor.<br>
The wrapper subscribes to Pi events and writes the canonical stream.
</td><td>
“Flue keeps Pi as an in-memory turn engine. Flue’s session wrapper receives the conversation writer, journals Pi events, and reconstructs Pi state from that canonical stream.”
</td></tr>
<tr><td>R5 — §07 correction: incarnation versus execution fencing.</td><td>FIXED</td><td>
<code>plan.html:143-144,211</code> uses <code>instance_uid</code> for immutable instance-lifetime identity and <code>attempt_id</code>/<code>owner_epoch</code> for execution ownership and fencing.<br>
That matches <code>v2-flue-review.md:152-168</code> and removes the bad process-generation invariant.
</td><td>
Keep the current distinction. Add exact minting and uniqueness rules during implementation planning.
</td></tr>
<tr><td>R6 — §07 correction: cursor becomes an opaque atomic-batch offset shared by several records.</td><td>STILL WRONG</td><td>
<code>plan.html:140-144,212</code> fixes the cardinality in prose but still places <code>batch_offset</code> inside the displayed <code>record</code> shape.<br>
<code>v2-flue-review.md:202-208</code> says Flue returns one offset from append; its record envelope has no offset field.<br>
Putting the same offset on every record is a legitimate local denormalization only if explicitly proposed as such, not a faithful rendering of the source contract.
</td><td>
“<code>append_batch = records[] + opaque ordered offset returned for the committed batch</code>. Individual records do not need an offset field; if the local envelope repeats it, label that a deliberate local projection.”
</td></tr>
<tr><td>R7 — §07 correction: ordinary tools versus durable tools/delegated tasks on recovery.</td><td>FIXED</td><td>
<code>plan.html:154-157,213</code> now says unresolved ordinary calls become explicit unknown outcomes and are not blindly retried, while durable tools and delegated tasks use their own replay rules.<br>
It also preserves the warning that exactly-once recording does not make external effects exactly once.<br>
This matches <code>v2-flue-review.md:302-328</code>.
</td><td>
Keep the current wording. In an implementation plan, enumerate which local tools are ordinary, durable, or delegated and how each is fenced.
</td></tr>
<tr><td>R8 — §07 correction: Flue OTel content is captured by default, not redacted.</td><td>FIXED</td><td>
<code>plan.html:214</code> accurately reverses the old claim and names prompts, outputs, tool arguments, and results.<br>
This matches <code>v2-flue-review.md:432-448</code>.
The L5 row at <code>plan.html:109</code> makes no contrary default claim.
</td><td>
“OTel export with content capture explicitly disabled or redacted by boring-ui policy unless an operator knowingly opts in.”
</td></tr>
<tr><td>R9 — §07 correction: both Mastra and LangGraph paywall tenancy.</td><td>FIXED</td><td>
<code>plan.html:169-175,215</code> now distinguishes Mastra’s production enterprise license from LangGraph custom auth across LangSmith plans and withdraws the monetization thesis.<br>
That matches <code>v2-flue-review.md:342-368,502-515</code>.
</td><td>
Keep the license/pricing correction. Remove the new unscored claims about how many frameworks have “real” auth and which system “beats” another.
</td></tr>
<tr><td>R9a — “Of eleven frameworks, two ship a real authorization model” and “almost no framework ships tenancy at all.”</td><td>STILL WRONG</td><td>
<code>plan.html:169-175</code> retains the count by changing the adjective to “real” without defining a rubric.<br>
<code>v2-flue-review.md:332-339,372-379</code> identifies OpenAI organization/project roles and Cloudflare isolation/routing as genuine, if weaker, tenancy primitives.<br>
The count two is defensible only for the narrower surveyed category “verified programmable resource-level agent/workflow authorization.”
</td><td>
“In this survey, Mastra FGA and LangGraph custom auth are the two verified examples of programmable resource-level agent/workflow authorization. Other systems provide weaker platform tenancy or isolation primitives.”
</td></tr>
<tr><td>R9b — “ours beats both … on structural confinement.”</td><td>UNFALSIFIABLE</td><td>
<code>plan.html:173-175</code> supplies no comparison rubric, threat model, equivalent deployment assumptions, or test results.<br>
<code>v2-flue-review.md:452-459</code> already called this comparison unverifiable and requested a rubric covering confinement, request auth, resource auth, entitlement discovery, revocation, delegation, and auditability.
</td><td>
“Boring has verified workspace/path/process confinement primitives. Comparative superiority over Mastra or LangGraph is unclaimed until scored under a common threat model and deployment rubric.”
</td></tr>
<tr><td>R10 — §07 correction: #979 and #1009 are no longer conflated with the proposed settlement system.</td><td>FIXED</td><td>
<code>plan.html:106,216</code> calls #979 addressed first-send and says #1009 durable replay is already wired and is not the proposed settlement system.<br>
<code>origin/main:docs/direction/STATE.md:28</code> confirms the streaming-durability lane is wired.<br>
This matches <code>v1-code-review.md:346-361,459-466</code>.
</td><td>
“#979 delivered addressed atomic native first-send/removal of the dual prompt path. #1009 delivered flag-gated durable replay; neither is the proposed canonical submission/settlement redesign.”
</td></tr>
<tr><td>R11 — §07 correction: L6/L7 are priority-deferred, not blocked by L0/L1.</td><td>FIXED</td><td>
<code>plan.html:110-120,217</code> consistently shows L6/L7 independent and deferred on priority.<br>
The rev 1 self-contradiction identified at <code>v1-code-review.md:441-447</code> is gone.
</td><td>
Keep the dependency statement, but do not call the page “the schema everything waits on” when two lanes explicitly do not wait on it.
</td></tr>
<tr><td>N1 — L1 is presented as if admission and settlement machinery do not already exist.</td><td>NEWLY WRONG</td><td>
<code>plan.html:105</code> puts settlement wholly in future L1.<br>
<code>origin/main:packages/agent/src/server/agent-host/types.ts:72-110</code> already defines a request ledger with <code>pending-admission</code>, <code>admission-accepted</code>, <code>in-flight</code>, <code>rejected</code>, <code>completed</code>, and <code>outcome-unknown</code> states plus CAS transitions.<br>
<code>origin/main:packages/agent/src/server/agent-host/sqliteRequestLedger.ts:38-172</code> implements durable transactional ownership and compare-and-swap.<br>
<code>origin/main:packages/agent/src/server/agent-host/embeddedGateway.ts:681-838</code> prepares, admits, begins, rejects/completes, and marks unknown around Gateway effects, including prompts.<br>
This is not Flue’s canonical conversation writer and lacks attempt/owner-epoch continuation, but it is real reusable admission/settlement machinery.
</td><td>
“L1 extends or reconciles the existing durable Agent Request Ledger with the canonical conversation writer. Do not create a second submission/settlement authority.”
</td></tr>
<tr><td>N2 — L3 “needs only L0’s pause record.”</td><td>NEWLY WRONG</td><td>
<code>plan.html:107,115-120</code> treats a schema decision as L3’s only prerequisite.<br>
Current question persistence is separate JSON state: <code>origin/main:plugins/ask-user/src/server/askUserServerPlugin.ts:70-72</code> writes <code>.boring/ask-user.json</code>.<br>
The suspended waiter is process memory: <code>origin/main:plugins/ask-user/src/server/askUserRuntime.ts:23-81</code>.<br>
On startup, <code>askUserServerPlugin.ts:36-39</code> calls <code>abandonOrphanedPending</code>; <code>askUserRuntime.ts:117-123</code> abandons any persisted question with no live waiter.<br>
Therefore a stored pause does not durably suspend or resume execution.
</td><td>
“L3’s artifact/UI work is independent. A transactional pending-input record needs a minimum L1 writer. Crash-resumable continuation additionally needs durable admission, attempt ownership/fencing, and settlement/recovery.”
</td></tr>
<tr><td>N3 — “L3 delivers the workspace-side durable pause.”</td><td>NEWLY WRONG</td><td>
<code>plan.html:185-187</code> claims durable pause despite excluding the channel surface.<br>
<code>origin/main:plugins/ask-user/src/server/askUserRuntime.ts:160-166</code> turns an answer into <code>abandoned</code> when the waiter is absent.<br>
<code>origin/main:plugins/ask-user/src/server/questionsBridge.ts:46-61</code> reports “question waiter is no longer available.”
Durable visibility of question metadata is not a durable execution pause.
</td><td>
“Today Workspace durably stores question metadata, but the blocked execution is process-local. After restart the question is abandoned; transparent continuation is not implemented.”
</td></tr>
<tr><td>N4 — The proposed L3 is equivalent to current Human Intention/Ask User work.</td><td>NEWLY WRONG</td><td>
<code>plan.html:107,146-149</code> groups durable pause, one-shot approval, and channel answering.<br>
<code>origin/main:plugins/ask-user/src/shared/types.ts:90-127</code> defines structured questions only: no approval kind, action, canonical arguments, attempt fence, or consumed action capability.<br>
<code>origin/main:plugins/ask-user/src/server/questionsBridge.ts:31-98</code> scopes an answer with session, principal, and answer token; it authorizes submitting form values, not executing an exact external action.
</td><td>
“Question answering exists. Exact-action one-shot approval is separate unimplemented work: bind an approval to the action digest and canonical arguments, then consume it atomically under the same attempt fence.”
</td></tr>
<tr><td>N5 — Displayed pause schema is sufficient to enforce “a stale answer never authorizes the original call.”</td><td>UNFALSIFIABLE</td><td>
<code>plan.html:146-149</code> lists request id, session, kind, action/args, state, answer time, and answer.
It omits tenant/workspace, agent instance, attempt/owner epoch, requester, authorized answerer, expiry, capability/token digest, state version, and atomic consumption rule.<br>
Current code actually relies on <code>ownerPrincipalId</code> and <code>answerToken</code> at <code>origin/main:plugins/ask-user/src/shared/types.ts:113-125</code> and validates session/principal/token at <code>questionsBridge.ts:31-87</code>.
</td><td>
“An answer is accepted only while the exact pause is pending under the same tenant/workspace, agent instance, attempt/owner epoch, action digest, and authorized principal. Consume a single-use capability with an atomic <code>pending → answered</code> CAS; reject every stale/replayed transition.”
</td></tr>
<tr><td>N6 — Pause creation/answering has a specified atomic failure model.</td><td>UNFALSIFIABLE</td><td>
The plan has no write-boundary or crash semantics.<br>
Current <code>origin/main:plugins/ask-user/src/server/askUserRuntime.ts:138-157</code> performs <code>createPending</code>, <code>created</code>, and <code>ready</code> as three separate durable mutations.<br>
Answer row and answered transcript event are separate at <code>:160-175</code>.<br>
<code>origin/main:plugins/ask-user/src/server/askUserStore.ts:173-207</code> rewrites/renames the whole JSON file for each mutation, so crashes can preserve only a prefix of the logical transition.
</td><td>
“Pause creation, suspended-call identity, and ready event commit atomically; answer/cancel and terminal event commit atomically. Fault-test every boundary.”
</td></tr>
<tr><td>N7 — L3 has a multi-process/single-writer story.</td><td>UNFALSIFIABLE</td><td>
<code>origin/main:plugins/ask-user/src/server/askUserStore.ts:57-63,173-180</code> serializes only inside one <code>FileAskUserStore</code> instance with a promise chain.<br>
<code>:183-207</code> caches the entire file and renames a replacement. Two processes can each mutate stale state and lose an update.<br>
The proposed pause record has <code>owner_epoch</code> only on the generic record line, with no writer-lease/CAS algorithm.
</td><td>
“Name the single-writer lease and epoch invariant, or use transactional storage with cross-process CAS. Prove that two runtimes cannot both answer or resume one pause.”
</td></tr>
<tr><td>N8 — L3 scale/retention is well specified.</td><td>UNFALSIFIABLE</td><td>
<code>origin/main:plugins/ask-user/src/server/askUserStore.ts:43-48,149-165,183-207</code> retains all questions, answers, and transcript arrays in one JSON object and rewrites it per mutation.<br>
Rev 2 provides no retention, pruning, maximum pending/history volume, file-size bound, concurrency target, or latency budget.
</td><td>
“Specify pending/history limits, retention and pruning, 10× concurrency latency, storage bounds, and the threshold at which the file store must be migrated.”
</td></tr>
<tr><td>N9 — L2 as a whole “needs L1.”</td><td>OVERCORRECTED</td><td>
<code>plan.html:106,115-118</code> bundles dependent and already-independent work.<br>
Opaque canonical batch offsets and a unified canonical read route do depend on the L1 writer/append semantics.<br>
But <code>origin/main:packages/agent/src/shared/chat/piChatEvent.ts:6-25</code> already makes <code>message-end.final</code> message-scoped and uses a distinct <code>agent-end</code> for turn settlement.<br>
<code>origin/main:packages/agent/src/server/events/eventStreamStore.ts:19-40,51-67,237-280</code> already has opaque string-offset/read primitives independent of a Flue-style writer.<br>
Addressed first-send is already delivered, per R10.
</td><td>
“L2a: addressed/command/final-semantics cleanup — independent or already delivered. L2b: canonical read route and client cutover to atomic-batch offsets — depends on L1.”
</td></tr>
<tr><td>N10 — L4 as a whole “needs L1.”</td><td>OVERCORRECTED</td><td>
<code>plan.html:108,115-118</code> treats all convergence work as blocked.<br>
Inventorying, encapsulating, replacing private queue access, and evaluating supported Pi APIs can proceed now.<br>
Deletion of transcript readers does depend on a replacement authority and migration: <code>origin/main:packages/agent/src/server/harness/pi-coding-agent/sessions.ts:275-417</code> loads history/attachments and resolves wrapper/native transcripts; <code>nativeSessionTranscript.ts:88-123</code> summarizes raw JSONL.<br>
Without import/dual-read/drain, existing sessions disappear after deletion.
</td><td>
“L4a audit/encapsulation/upstream convergence is independent. L4b migration and deletion of JSONL readers needs L1, successful import/drain, parity tests, and an explicit rollback gate.”
</td></tr>
<tr><td>N11 — L5 as a whole “needs L1.”</td><td>NEWLY WRONG</td><td>
<code>plan.html:109,115-118</code> blocks live observability on the new durable writer.<br>
<code>origin/main:packages/agent/src/server/pi-chat/harnessPiChatService.ts:731-785,976-984</code> already has the enriched mapped-event tap and calls metering after publish.<br>
<code>origin/main:packages/agent/src/server/pi-chat/metering.ts:270-285,496-560</code> already exposes an <code>observe()</code>-style subscriber over native and mapped events.<br>
Only durable/replayable observation history requires the canonical durable stream.
</td><td>
“L5a live observer API, metering subscriber extraction, and OTel export can proceed independently. L5b replayable/durable observations depend on L1. Exporter failure must never change billing or run semantics.”
</td></tr>
<tr><td>N12 — “Do L0 + L3. Stop there.”</td><td>NEWLY WRONG</td><td>
<code>plan.html:178-187</code> is not a coherent stopping point.<br>
Without L1, L3 either has nowhere to write the proposed canonical pause or continues writing <code>.boring/ask-user.json</code>, creating a second approval authority outside the proposed canonical stream.<br>
The concrete resulting state is a durable <code>ready</code> question row with no recoverable waiter/turn after restart; startup marks it abandoned and an attempted answer returns “question waiter is no longer available.”<br>
Creation, transcript event, chat stream, and answer transition also remain non-atomic.
</td><td>
“Do L0, then the minimum L1 transactional writer/pending-input slice, then local L3. Stop before channel delivery. Do not claim crash-resumable approval until admission/continuation/settlement recovery exists.”
</td></tr>
<tr><td>N13 — “L3 branch open” / “the lane with a branch already open.”</td><td>NEWLY WRONG</td><td>
<code>plan.html:107,181-183</code> uses remote-branch existence as implementation status.<br>
<code>origin/fix/786-human-intention-artifacts</code> has merge-base <code>08fc14e62</code>, is 566 commits behind and only six commits ahead of current <code>origin/main</code>, and its tip is <code>5c723800f</code> dated 2026-07-23, “refactor(agent): cut dead transcript index plumbing.”<br>
Its six unique commits mix Human Intention UI/task work with handover cleanup and transcript-index refactors.
It is a stale, polluted branch, not evidence that the proposed L3 is active.
</td><td>
“A stale remote branch named for #786 still exists, but it is not an active implementation branch for this proposed L3.”
</td></tr>
<tr><td>N14 — What the #786/#796 Human Intention work actually contains.</td><td>NEWLY WRONG</td><td>
<code>origin/main:docs/issues/796/addressed-port-plan.md:9-18,43-53,68-71</code> defines an addressed semantic port of Human Intention artifacts, related tasks, exact chat ownership, and task-session links.<br>
The relevant artifact/UI slice was ported in commit <code>a27e43231</code> and merged to main through PR #1045 at <code>8d18c3d22</code>.<br>
It does not implement a canonical pause record, exact-action approval capability, or crash-resumable execution.
</td><td>
“#796/#1045 delivered Human Intention artifact/Inbox integration on addressed sessions. Canonical pause/approval durability remains separate proposed work.”
</td></tr>
<tr><td>N15 — Scope verification is now bounded to public gateway and live-connection operations.</td><td>FIXED</td><td>
<code>plan.html:163-167</code> removes the old repository-wide “every operation” claim.<br>
<code>origin/main:packages/agent/src/server/agent-host/embeddedGateway.ts:245-247,250-377,531-550</code> verifies public Gateway calls.<br>
<code>:418-477</code> reverifies privileged live-connection commands <code>send</code>, <code>interrupt</code>, <code>stop</code>, and <code>clearQueue</code>.<br>
Connection <code>close</code> and passive event iteration do not reverify, appropriately: they are cleanup/read of an established stream, not privileged effects.
</td><td>
“Scope is verified on every public Agent Gateway call and reverified on every privileged live-connection command.”
</td></tr>
<tr><td>N16 — “First-party versus third-party authored” decides whether isolation-per-agent matters.</td><td>NEWLY WRONG</td><td>
<code>plan.html:191-193</code> turns one product decision into the sole predicate for isolation relevance.<br>
Even first-party agents can have different credentials, tools, data classifications, compromise domains, or tenant placement; third-party authorship is sufficient but not necessary for isolation.<br>
<code>origin/main:packages/agent/src/server/agentDefinition/materializeAgentDirectory.ts:64-70</code> and <code>compileAgentDirectory.ts:447-462</code>, cited in <code>v1-code-review.md:405-412</code>, already show declarative authored identity with host-reserved executable policy, so the binary is also technically incomplete.
</td><td>
“Who may author/distribute agents is open. Isolation requirements should instead follow a threat model covering credential separation, tool trust, tenant boundaries, data sensitivity, and compromise blast radius.”
</td></tr>
<tr><td>N17 — The migration question list is complete enough.</td><td>NEWLY WRONG</td><td>
<code>plan.html:189-196</code> asks only whether deployments have event-store-only records.<br>
Existing durable state also includes <code>.boring/ask-user.json</code> at <code>origin/main:plugins/ask-user/src/server/askUserServerPlugin.ts:70-72</code>, with live statuses and answer tokens at <code>plugins/ask-user/src/shared/types.ts:111-127</code>.<br>
Existing Pi JSONL remains conversation compatibility authority, and <code>origin/main:docs/issues/807/runtime-refactor/work/T1-durable-events/PLAN.md:18-19,29-46</code> requires an explicit JSONL-before-event-append divergence rule.
</td><td>
Add: “How are existing Ask User rows/tokens migrated or invalidated? What happens to a pending question during rollout? How are Pi JSONL and event-log divergence, backup ordering, import, and dual-read drained?”
</td></tr>
<tr><td>N18 — Rollback/versioning is adequately specified.</td><td>UNFALSIFIABLE</td><td>
The proposed <code>submission</code>, <code>record</code>, and <code>pause</code> shapes at <code>plan.html:134-149</code> have no schema/wire version, dual-reader period, cutover marker, downgrade rule, or last rollback-safe point.<br>
L4 promises deletion without a stated import/drain or rollback gate.<br>
The current event schema at least has an explicit version in <code>origin/main:packages/agent/src/server/events/schemaVersion.ts:1-15</code>; rev 2 does not carry that discipline into its proposal.
</td><td>
“Version every durable envelope. Define dual-read/dual-write duration, migration progress checks, pending-pause behavior, backup/restore order, and the last rollback-safe point before deleting legacy readers.”
</td></tr>
<tr><td>N19 — “One authoritative stream per agent instance” is an implementable invariant as written.</td><td>UNFALSIFIABLE</td><td>
<code>plan.html:159-161</code> states the slogan but not the stream-key derivation, tenant uniqueness, session/child-session projection, ownership transfer, writer lease, or treatment of existing transcript/event/question stores.<br>
<code>origin/main:packages/agent/src/server/events/eventStreamStore.ts:69-92</code> keys current streams by path; <code>harnessPiChatService.ts:944-948</code> builds a session stream path, not the proposed fully defined agent-instance identity.
</td><td>
“Define the exact stream key and uniqueness invariant, writer lease/epoch, session and child-session projection, and every retained store. Prove restart and ownership transfer cannot create two writable authorities.”
</td></tr>
<tr><td>N20 — “L0 — the schema everything waits on.”</td><td>NEWLY WRONG</td><td>
<code>plan.html:120,130</code> contradicts itself: L6 and L7 explicitly have no dependency on L0/L1.<br>
The L5 live observer slice and L4 audit/encapsulation can also proceed without L0, as N10-N11 show.<br>
The heading restores the same rhetorical overclaim that §07 says it corrected for L6/L7.
</td><td>
“L0 — schema decision required for the canonical writer, durable pending-input transition, and canonical transport cutover.”
</td></tr>
<tr><td>N21 — “They are well-specified platform work.”</td><td>UNFALSIFIABLE</td><td>
<code>plan.html:178-180</code> declares quality without acceptance criteria.<br>
The lanes omit migration and rollback gates, flag/cutover strategy, stream-key invariant, pause atomicity, writer ownership, retention, scale targets, and proof commands.<br>
L2/L4/L5 each combine independently dispatchable work with work that genuinely depends on the canonical writer.
</td><td>
“These are platform directions, not yet dispatchable slices. Each lane needs scope, dependencies, migration/rollback, acceptance tests, and proof before implementation.”
</td></tr>
<tr><td>N22 — Footer: “eleven claims were corrected; the governance section survived unchanged.”</td><td>NEWLY WRONG</td><td>
<code>plan.html:222-225</code> overstates the result.<br>
R1 remains unsupported; R3 and R6 are overcorrected/still mis-modeled; R4 introduces new Flue errors; the body retains unsupported governance comparisons.<br>
The governance wording also did not survive unchanged: rev 1 explicitly required “scope verification on every operation” to be narrowed, and rev 2 now uses the bounded gateway/live-connection phrase at <code>plan.html:163-167</code>.
</td><td>
“Rev 2 fixes several source-attribution and wording errors, but the seam count, L4 scope, batch-offset representation, lane dependencies, and status claims still require correction. The governance keep-list remains directionally strong after narrowing its scope-verification claim.”
</td></tr>
<tr><td>N23 — Footer: “Backed by ~9,100 lines of research and a per-file audit … this is what survived.”</td><td>UNFALSIFIABLE</td><td>
<code>plan.html:63-65,222-225</code> uses research volume and a stale audited commit (<code>e546c3807</code>) as an authority signal rather than linking a claim ledger.<br>
Current <code>origin/main</code> is <code>d1719dfda</code>.
The four headline file sizes happen to remain unchanged, but branch status, direction docs, request-ledger reality, and merged Human Intention work have moved.
</td><td>
“Audited against commit <code>&lt;exact SHA&gt;</code>. Every quantitative/status claim below links its reproducible source; research volume is not evidence.”
</td></tr>
</tbody>
</table>
## Most serious remaining problems
### 1. The recommended stopping point creates the split authority the plan claims to remove
“Do L0 + L3. Stop there” is the worst remaining error.
L0 is only a schema decision.
Without a minimum L1 transactional writer, L3 must either write nowhere or keep using <code>.boring/ask-user.json</code> as a second approval authority.
The exact half-built state is reproducible:
1. Ask User writes a <code>ready</code> question row to the JSON file.
2. The blocked tool call waits in <code>InProcessAskUserCoordinator.waiters</code> only.
3. The process restarts or loses ownership.
4. The row survives but the waiter does not.
5. Startup marks the row <code>abandoned</code>.
6. An answer cannot resume the original call and returns “question waiter is no longer available.”
That is durable-looking UI metadata over a non-durable continuation, not a durable pause.
Minimum honest sequence:
1. L0: choose the record and transition semantics.
2. L1a: extend/reconcile the existing Agent Request Ledger into one transactional canonical writer with pending/waiting transitions.
3. L3-local: migrate Ask User to that authority and implement exact-action one-shot approval.
4. Stop before channel delivery if no paying vertical needs it.
5. Claim transparent restart continuation only after durable attempt ownership, fencing, and settlement recovery exist.
### 2. Rev 2 overcorrects L4 and still has no migration/rollback boundary
It correctly retracts the imaginary compactor, duplicate skill parser, deletable tool schemas, sandbox truncation, and “diff engine.”
It then swings too far to “raw transcript wrappers only.”
Real non-transcript Pi convergence debt remains:
- the private follow-up queue compatibility layer;
- duplicate nonce/selector queue bookkeeping;
- direct mutation of Pi private queue fields;
- possible overlap between standalone extension discovery and Pi’s resource loader.
Conversely, deleting raw transcript readers cannot follow merely because L1 lands.
Those readers still expose existing JSONL sessions, history, attachments, titles, and legacy wrappers.
Deletion requires:
- inventory and classification;
- import or dual-read;
- parity checks;
- JSONL/event divergence recovery;
- backup/restore ordering;
- a drain marker;
- and a last rollback-safe point.
### 3. The proposed pause schema cannot prove its one-shot authorization claim
The schema says a stale answer never authorizes the original call, but it does not encode enough to enforce that invariant.
Missing or undefined:
- tenant/workspace scope;
- agent instance identity;
- attempt id and owner epoch on the pause itself;
- requesting principal;
- authorized answering principal;
- exact action digest;
- capability/token digest;
- expiry;
- single-use consumption;
- compare-and-swap state version;
- atomicity with the approved effect transition.
Current Ask User already needs session, principal, and answer-token checks.
The replacement cannot safely drop those fields while claiming a stronger exact-action capability.
Persisting full <code>canonical_args</code> also needs a data-governance decision: arguments may contain secrets or sensitive payloads.
Prefer a stable action digest plus a bounded/redacted human display unless executable arguments truly must be stored, encrypted, retained, and audited.
### 4. The lane graph is not a real dependency graph
L2, L4, and L5 each mix work with different prerequisites.
A more truthful graph is:
<pre><code>L0 ── L1a transactional canonical writer ──┬── L1b attempt/settlement recovery
                                          ├── L2b canonical read + offset cutover
                                          ├── L3 durable pending input
                                          ├── L4b transcript migration/deletion
                                          └── L5b durable observation replay
L2a addressed/command/final cleanup ───────── independent / partly delivered
L4a audit, encapsulation, upstream Pi APIs ── independent
L5a live observer + OTel + subscriber split ─ independent
L6, L7 ───────────────────────────────────── priority-deferred
channel answering ────────────────────────── separate #1127 dependencies</code></pre>
This also exposes that L1 must reuse or merge with the existing durable Agent Request Ledger rather than building a second submission authority.
### 5. The status claim is materially misleading
A remote branch named <code>origin/fix/786-human-intention-artifacts</code> exists, but it is 566 commits behind, six ahead, and polluted with task, handover, and transcript-index work.
The relevant Human Intention artifact/UI behavior was already ported and merged to main through #1045.
Neither the stale branch nor current main implements the L3 described by rev 2:
- no canonical pause record;
- no exact-action approval capability;
- no crash-resumable continuation;
- no channel-answering implementation.
Calling the lane “branch open” conflates an old artifact/Inbox port with a new durability and authorization design.
### 6. The 3,035 headline remains measurement theater
The sum is arithmetically correct only because rev 2 preserves the invented ~600 input.
The reproducible numbers are:
- 2,435 lines across the three complete client files;
- 1,315 lines in the complete harness;
- 3,750 lines across all four complete files;
- 264 lines across the defensible named narrow reconciliation functions;
- 311 lines across coarse contiguous reconciliation blocks, including mixed responsibilities.
There is no evidence-backed 3,035-line seam measure.
The page should drop the combined total instead of replacing one false precision with another.
### 7. Migration, rollback, scale, and concurrency are still absent
The seven blindspot lenses expose material omissions:
- **Scale:** one JSON object is loaded and rewritten for every Ask User mutation; no volume or latency bound exists.
- **Security:** exact-action approval lacks subject, capability, expiry, and redaction semantics.
- **Failure modes:** question row, lifecycle event, answer, and chat/event transitions are separate writes.
- **Edge cases:** pending questions during deploy/import are not specified.
- **Concurrency:** the file store serializes only within one process and has no cross-process CAS/lease.
- **Migration:** event-store records are not the only durable state; Ask User JSON and Pi JSONL also need a plan.
- **Rollback:** no envelope version, dual-reader window, cutover marker, or rollback-safe point is named.
These are not low-level implementation details.
They materially change whether L3 is safe, whether L4 can delete anything, and whether the proposed canonical authority is actually singular.
### 8. Rev 2 fixes useful facts but is not substantially sound
The rewrite genuinely fixes:
- instance identity versus attempt fencing;
- ordinary versus durable-tool recovery;
- the OTel content default;
- the LangGraph paywall claim;
- #979/#1009 conflation;
- L6/L7 priority deferral;
- and the bounded Gateway scope-verification claim.
It also correctly relabels the schema as a proposal and retracts most of the false L4 deletion story.
But the remaining errors affect the plan’s decision, sequencing, authorization model, migration path, and implementation status—not peripheral wording.
Rev 2 is therefore more honest than rev 1, but it is **not substantially sound yet**.
Its core recommendation should not be acted on until the L0/L1/L3 boundary, existing request-ledger reuse, pause security invariant, and migration/rollback gates are rewritten.
