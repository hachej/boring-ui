ADVERSARIAL DESIGN REVIEW of a proposed database schema that is about to become real work. Your job is
to find where it FAILS — as a design, not as prose. Assume it will be implemented as written unless you
stop it.

THE SCHEMA: section 03 of /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/plan.html (read the file). Three record types: submission, record, pause.

CONTEXT YOU MUST USE
- Flue's implementation, the closest working reference. Docs offline:
  from /home/ubuntu/projects/spike-flue-celld run `npx -y @flue/cli@2.0.3 docs read <path>`
  (see reference/data-persistence-api, guide/durability, reference/streaming-protocol).
  Source: raw.githubusercontent.com/withastro/flue/main/packages/runtime/src/... or npm pack.
- pi's own session model: `SessionStorage` / `SessionRepo` / `Session` in
  /home/ubuntu/projects/boring-ui-v2/node_modules/@mariozechner/pi-coding-agent and the
  @earendil-works/pi-agent-core package in node_modules/.pnpm. pi's session is a TREE (entries, leafId,
  getPathToRoot, fork), not a flat log.
- The existing store it must replace: `git show origin/main:packages/agent/src/server/events/eventStreamStore.ts`
- Prior research: /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/r1-flue.md, r4-pi.md, r5-source.md (secondary — verify, do not inherit).

ATTACK THESE SPECIFICALLY
S1. **Tree vs log.** pi's session is a tree supporting branching and fork. The schema is a flat
    append-only stream. Can pi's tree be reconstructed from it? What breaks — branch navigation, fork,
    getPathToRoot, compaction entries? Is this a fatal mismatch or a mapping?
S2. **Batch offsets.** Offsets are per atomic append batch, several records sharing one. Does the
    schema as written actually express that, or does it imply per-record ordering? What is the primary
    key? How does a client resume mid-batch? Can it?
S3. **The pause record.** Is it sufficient to implement approval AND question AND (per eve) OAuth-style
    waits? What is missing — timeout, expiry, who may answer, correlation to the tool call, ordering
    against the submission queue? Does "a stale answer never authorizes the original call" have enough
    fields to be enforceable?
S4. **Settlement.** "Exactly one terminal outcome per submission" — what enforces it? Is the status
    enum plus outcome column sufficient, or does it need a state machine with legal transitions and a
    fencing token? What happens on concurrent settle attempts from two attempts?
S5. **Tenancy.** tenant/workspace is on submission but not on record or pause. Is that a hole? Can a
    record be read without resolving its submission? What is the actual isolation guarantee?
S6. **Migration.** The existing `boring_event_stream_*` tables hold `PiChatEvent` envelopes. Is a
    migration expressible, or is data lost? What about existing pi JSONL transcripts?
S7. **What is missing entirely.** Name records/fields the schema needs and does not have — attachments,
    usage/metering, compaction markers, subagent/child sessions, queue position, abort intent.
S8. Anything that would be discovered painfully at implementation time.

OUTPUT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/v4-schema-review.md
For each finding: severity (FATAL / SERIOUS / MINOR), the problem, the evidence, and a CONCRETE
replacement — actual columns and constraints, not advice. End with a corrected schema you would
actually implement, and a short list of decisions the author must make that no reviewer can make for them.
No preamble. 400-800 lines.
