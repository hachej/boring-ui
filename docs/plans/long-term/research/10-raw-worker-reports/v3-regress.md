ADVERSARIAL REVIEW, ROUND 2. A one-page plan was reviewed, eleven claims were found wrong, and the
author rewrote it. Your job is to check whether the REWRITE is honest and correct — and to attack what
the first round missed.

THE DOCUMENT (rev 2): /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/plan.html
THE PRIOR REVIEWS (what was supposed to be fixed): /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/v1-code-review.md and /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/v2-flue-review.md
THE CODEBASE: /home/ubuntu/projects/boring-ui-v2 at `origin/main` (`git show origin/main:<path>`).
The working tree is 636 commits stale — using it is an error.

PART 1 — REGRESSION CHECK. For each of the eleven corrections claimed in the document's own §07
"What rev 1 got wrong": was it actually applied to the body of the document, correctly, and without
introducing a NEW error? Specifically check that the fix did not overcorrect:
  - Is 3,035 the right total, and is the "~600 reconciliation" figure itself defensible? Name the
    functions it should count. If ~600 is still invented, say so.
  - Is "four owners under the flag-enabled configuration" accurate? Is the flag on anywhere by default?
  - Is L4 now UNDERstated? Is there real pi duplication beyond raw transcript wrappers that the
    correction wrongly removed from scope?
  - Is "scope verification on public gateway and live-connection operations" now correctly bounded, or
    now too narrow?

PART 2 — ATTACK WHAT ROUND 1 MISSED. Round 1 concentrated on factual claims. Attack the parts it did
not:
  - The LANE STRUCTURE. Are the dependencies real? Is L3 genuinely satisfiable with only "L0's pause
    record", or does a durable pause require L1's admission/settlement machinery to be meaningful?
    Does L2 really need L1? Does L5?
  - The CLAIM THAT L4/L5 "need L1". Check the code: could either proceed independently?
  - "Do L0 + L3. Stop there." Is that coherent? What breaks or is left half-built if you do exactly
    that and nothing else? Name the specific inconsistent state the codebase would be left in.
  - The status labels: "L3 branch open" — check what the 786 branch actually contains on the remote and
    whether it is really human-intention work in the sense the document means.
  - Anything in rev 2 that is newly wrong, vague, or unfalsifiable.

OUTPUT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/v3-regression.md
Table: item | verdict (FIXED / STILL WRONG / OVERCORRECTED / NEWLY WRONG / UNFALSIFIABLE) | evidence
file:line | what to write instead. Then "most serious remaining problems", worst first.
If rev 2 is now substantially sound, say so plainly — but only after genuinely trying to break it.
No preamble. 300-600 lines.
