EXECUTABLE SPIKE: prove or disprove that a human-in-the-loop pause can survive a process restart.
This validates the single lane that has work already in flight. Write code, run it, report what happened.

THE CLAIM UNDER TEST
"A question/approval is a durably journaled request, not a blocked process. The waiting tool call can be
resumed minutes later, from a different surface, after a restart, with no process held open."

THE CURRENT REALITY (verify this first, in /home/ubuntu/projects/boring-ui-v2 at `origin/main`):
  plugins/ask-user/src/server/askUserRuntime.ts  -> `InProcessAskUserCoordinator` (line ~37)
  plugins/ask-user/src/server/askUserStore.ts (and its tests)
A prior review claims the failure mode is:
  1. Ask User writes a `ready` question row to a JSON file
  2. the blocked tool call waits only in `InProcessAskUserCoordinator.waiters` (in memory)
  3. the process restarts or loses ownership
  4. the row survives, the waiter does not; startup marks it `abandoned`
  5. answering cannot resume the original call -> "question waiter is no longer available"
CONFIRM OR REFUTE THAT by reading the real code. Quote the lines that decide it. If the review was
wrong, say so — that is the most valuable possible outcome.

WORKSPACE: /home/ubuntu/projects/spike-durable-pause (empty — scaffold it: package.json type:module, vitest, node:sqlite available on Node 22).
You may copy/adapt code from the repo but do NOT modify the repo.

BUILD AND PROVE:
1. A minimal durable pause store (SQLite) with, at least:
     pause_id, session_id, submission_id, tool_call_id, continuation_key,
     kind (approval|question), action_name, canonical_args, args_digest,
     state (pending|responded|consumed|denied|expired|cancelled),
     answer_policy, responded_by, response_payload, created_at, expires_at
2. A tool-call continuation that is NOT an in-memory promise: the pause must be resumable from the
   store alone. Model the agent side as a function that (a) requests a pause and yields, and
   (b) can be re-entered later with the answer.
3. TESTS THAT MUST PASS — each one an executable scenario, not an assertion about intent:
   T1 restart continuation: request a pause, KILL THE PROCESS (spawn a real child process and kill it,
      as spike-pi-storage did), start a new process, answer the pause, and prove the original tool call
      completes with the answer. Different PIDs must be shown.
   T2 stale answer: answer a pause whose action/args no longer match (or which was superseded).
      Prove the old call is NOT authorized and the answer is demoted rather than applied.
   T3 one-shot: prove an approval cannot be consumed twice — replay the same answer and show the second
      attempt is rejected BY A CONSTRAINT, not by application discipline. (Run a mutation check:
      disable the app-level guard and confirm a test still fails.)
   T4 expiry: an expired pause cannot be answered.
   T5 responder authorization: a principal who is not permitted by answer_policy cannot answer.
4. Run a MUTATION CHECK on every invariant, exactly as in the sibling spike: if removing a DB
   constraint does not fail a test, that invariant is adapter-only — report it as such rather than
   claiming it is structural.

REPORT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/s4-pause-report.md:
  - the confirm/refute of the current failure mode, with quoted code
  - the five tests with pasted `npm test` output
  - the mutation-check results per invariant (CONSTRAINT vs ADAPTER-ONLY)
  - what this would take to land in plugins/ask-user for real: files touched, rough line estimate,
    and what it depends on (be specific about whether it needs the full L1 durability machinery or a
    smaller transactional writer)
  - a blunt verdict
No preamble.
