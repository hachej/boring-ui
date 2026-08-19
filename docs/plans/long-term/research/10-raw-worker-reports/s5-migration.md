EXECUTABLE SPIKE: the migration. An owner decision has just removed backwards compatibility from scope —
**breaking protocol changes are explicitly allowed, no dual-protocol support, no v1 cursor compatibility.**
That leaves exactly one hard question, and it is a DATA question: what happens to sessions that already exist?

WORKSPACE: /home/ubuntu/projects/spike-migration (empty — scaffold it; Node 22, node:sqlite, vitest)
REPO (READ-ONLY): /home/ubuntu/projects/boring-ui-v2 at `origin/main` (`git show origin/main:<path>`)
TARGET SCHEMA: /home/ubuntu/projects/spike-l0-schema/src/schema.sql (working, 24 tests, raw-SQL
invariant tests included — read it and its store.ts)

THE TWO EXISTING SOURCES OF SESSION DATA
  A. pi's native JSONL transcripts — the real format. Read the writer/reader:
     git show origin/main:packages/agent/src/server/harness/pi-coding-agent/sessions.ts
     git show origin/main:packages/agent/src/server/harness/pi-coding-agent/nativeSessionTranscript.ts
     A live example tree exists on this machine at ~/.pi/agent/sessions — inspect real files.
  B. the flag-gated durable event store (`boring_event_stream_*` tables), which persists
     `PiChatEvent` envelopes keyed by an opaque `path`:
     git show origin/main:packages/agent/src/server/events/eventStreamStore.ts
     A prior review found: old event-stream `path` keys DO NOT carry tenancy; historical paths look like
     `sessions/${sessionKey}` where sessionKey serialises session id plus workspace/user context.
     CONFIRM OR REFUTE that, from the code.

ANSWER THESE, WITH RUNNING CODE:
1. Can a real pi JSONL transcript be imported into the target schema losslessly enough to (a) render the
   same transcript in a UI and (b) let pi CONTINUE the session afterwards? Build the importer. Test it
   against real files from ~/.pi/agent/sessions (copy them; do not mutate the originals).
   The tree matters: entry ids, parentId chains, leafId, branches, compaction entries.
2. Can `boring_event_stream_*` rows be promoted to canonical records? Construct the table, populate it
   the way the real store does, and try. Where tenancy cannot be recovered from the `path` key, say so
   and show the failing case.
3. Given breaking changes are allowed, evaluate and COMPARE three strategies, with evidence:
     S-A  full import of both sources
     S-B  import pi JSONL only; abandon the event-store rows (they are a cache/projection)
     S-C  clean break: new sessions only; old sessions become read-only via a legacy reader
   For each: what is lost, what it costs, and what breaks for a user with an open session.
4. Whichever you judge best, IMPLEMENT it far enough to prove it: import real files, then run a pi turn
   from the imported state and show it continues correctly. (pi-agent-core@0.80.7 SessionStorage
   injection is proven to work — see /home/ubuntu/projects/spike-pi-storage for the pattern.
   Model: gemini via `export VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=$(cat ~/.vault-token);
   GEMINI_API_KEY=$(vault kv get -field=api_key secret/agent/gemini)`. If vault or network is blocked in
   your sandbox, say so and prove the storage half offline — do not fabricate model output.)

REPORT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/s5-migration-report.md: the confirm/refute on `path` tenancy, per-source feasibility with
pasted output, the three-way comparison with a RECOMMENDATION, real line counts for the importer, and a
blunt statement of what data is unrecoverable under your recommendation.
No preamble.
