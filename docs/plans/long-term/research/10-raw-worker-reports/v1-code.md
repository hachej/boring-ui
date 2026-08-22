ADVERSARIAL VERIFICATION. A one-page plan document makes specific factual claims about a codebase.
Your job is to FALSIFY them against the actual code. Do not confirm; hunt for what is wrong,
overstated, or unverifiable. A finding of "this claim is wrong" is worth more than ten confirmations.

THE DOCUMENT: /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/plan.html (plain HTML, read it directly)

THE CODEBASE: /home/ubuntu/projects/boring-ui-v2 — read from `origin/main` via
`git show origin/main:<path>`. The working tree is 636 commits stale; using it is an error.

CHECK EVERY ONE OF THESE, and quote the code you checked against:

C1. "Session state has three owners — pi's transcript, the live pi session, our replay buffer."
    Open `server/pi-chat/harnessPiChatService.ts` `readStateBeforeDispose`. Are there exactly three?
    More? Fewer? Is the durable event store a fourth when the flag is on?
C2. "the snapshot fabricates a cursor with `Math.max(persisted.seq, liveSeq)`" — does that line exist
    verbatim on main? Quote it with its line number. If it has changed, say what it is now.
C3. "About 3,700 lines exist to manage that disagreement." The claimed components are:
    harnessPiChatService reconciliation ~600, piChatReducer 852, remotePiSession 838, usePiSessions 745.
    Verify each line count on main. Then judge the ~600: is that defensible, or invented? Which
    functions did it count? Is the total honest, or does it sweep in code that exists for other reasons?
C4. The lane table claims specific deletions. For each, does the named code actually exist on main and
    is the deletion plausible: reconciliation layer (L1), client cursor arithmetic (L2), pi
    duplication — transcript/compaction/skill parsing/tool schemas/truncation/diff (L4), metering
    coupling (L5)? Name files and line counts. Flag any that are wrong or overstated.
C5. The "what we keep" list: tenant checks, scope verification on every operation, MCP grants, lease
    fences, workspace path authority, submitter identity carried into tool calls, host durable-root
    selection. Does each exist on main? Cite the file. Any that DON'T exist are a serious error.
C6. Issue #979 is described as "implicit sessions". Check with `gh issue view 979`. Is that accurate?
    Also verify #1009 (durability lane) and #1127 (channels) are described correctly where mentioned.
C7. The five "open questions" — are they genuinely open against main, or already answered in the code?
    Specifically: does `message-end.final` cover a message or a turn (check the type and its producer)?
    Can a tool-result arrive after final (check the reducer/merging code)?
C8. Anything else in the document that is factually checkable against the codebase and is WRONG.

OUTPUT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/v1-code-review.md
Format: a table of claim | verdict (CONFIRMED / WRONG / OVERSTATED / UNVERIFIABLE) | evidence with
file:line | correction. Then a short "most serious problems" list, worst first.
Be harsh. If the document is broadly accurate say so plainly, but only after genuinely trying to break it.
No preamble. 300-700 lines.
