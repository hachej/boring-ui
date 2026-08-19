You are auditing a real codebase against a set of findings from other agent frameworks, to produce a
CONCRETE DELETE/CHANGE LIST. This is the payoff task: no strategy, no comparison - just "here is the
code, here is what happens to it".

CODEBASE: /home/ubuntu/projects/boring-ui-v2 - read from `origin/main` (git show origin/main:<path>),
NOT the working tree, which is 636 commits stale. Package of interest: packages/agent.

ESTABLISHED FINDINGS you are auditing against (treat as given):

F1. THREE SOURCES OF TRUTH. `server/pi-chat/harnessPiChatService.ts` reconciles pi's native transcript,
    the live pi session adapter, and its own replay buffer; the snapshot fabricates a cursor with
    `Math.max(persisted.seq, liveSeq)`. Flue solved the same problem by keeping pi purely in-memory
    (`Agent` constructed with a `messages` array) and injecting a `ConversationRecordWriter`, making
    its own canonical record stream the only durable truth.
F2. pi-agent-core exposes portable `SessionStorage` / `SessionRepo` interfaces, so a host can supply
    its own session backing store instead of pi's file-backed JSONL.
F3. Convergent durability contract across Flue/eve/Managed Agents: admit durably before work; exactly
    one terminal outcome per submission; at-least-once execution over exactly-once recording; surface
    uncertain side effects rather than retrying them; opt-in durable steps; opaque resume cursors.
F4. pi natively provides (per a separate audit) the turn loop, JSONL transcript format and storage,
    branching/fork, follow-up/steering queues, built-in tool schemas and execution lifecycle, output
    truncation, edit diff/patch, SKILL.md parsing and validation, skill discovery and progressive
    disclosure, `/skill:` activation, context-file discovery, prompt templates, and all of compaction.

YOUR TASK - for each area below, find the ACTUAL code on main and classify every file/function:
  DELETE (pi or a convergent primitive supersedes it)
  REPLACE (keep the responsibility, change the mechanism)
  KEEP (genuinely host-owned: tenancy, governance, UI, transport, multi-tenant storage)
and give a line estimate for each verdict.

AREAS:
A. `server/pi-chat/**` (~4,025 lines) - especially harnessPiChatService.ts (1,315) and metering.ts (835).
B. `server/harness/pi-coding-agent/**` (~3,146) - especially sessions.ts (1,312) and createHarness.ts (836).
C. `server/events/**` (578) and the durable-stream flag path in agent-host/buildAgentComposition.ts.
D. `server/agent-host/**` (6,260) - which parts are transport/authorization (KEEP) vs reconciliation (REPLACE).
E. `front/chat/pi/**` - piChatReducer.ts (852), remotePiSession.ts (838), and session/usePiSessions.ts (745):
   how much survives if the wire gains opaque cursors, implicit session creation, and an authoritative
   `message-end.final`.
F. Anything duplicating pi natively per F4 - name the exact files (e.g. skillFrontmatter.ts, any tool
   schema duplication, any truncation/diff helpers, any compaction logic).

OUTPUT a table per area: file | lines | verdict | superseded by | risk/caveat.
Then a summary table: area | DELETE lines | REPLACE lines | KEEP lines.
Then "**Ordering constraints**": which deletions depend on which other change landing first.
Then "**Do not delete**": code that looks redundant but is load-bearing for multi-tenancy, and why.

Be conservative and evidence-based - open the files, do not guess from names. Where you are unsure,
mark UNSURE with the specific question that would resolve it. An over-confident delete list is worse
than a short honest one.

Write to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/r9-audit.md
Terse, dense tables, exact paths and line counts. No preamble. 600-1200 lines.
