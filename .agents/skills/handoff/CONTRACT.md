# Handoff contract

Full field-by-field contract template and formal semantics for
`docs/kanzen/procedures/session-handoff.md`.

A handoff ID deduplicates artifact creation and notification only — it never
admits a session or makes execution exactly-once. Execution requires the
current Bead claim, addressed task/session binding, or equivalent atomic
admission receipt owned by the receiving session.

## Create

1. Require an intended receiver/role and one bounded purpose.
2. Read the canonical issue, approved plan/TODO revision, current/root Bead,
   PR, task/session link, Human Intention decision, and linked proof/review
   when each exists. Probe current git/worktree and tracker state, don't copy
   it from chat.
3. Write the contract below. Reference settled artifacts by Workspace-relative
   path or stable URL instead of restating them. Mark every authority,
   revision, execution-anchor, completion, and blocker claim as
   `[verified: <probe/receipt>]` or `[unverified: <source>]`.
4. Resolve repository/worktree paths through `Workspace`. Reject traversal,
   symlink escape, a mismatched git top-level/common directory, and paths
   outside the assigned Workspace. Redact secrets, credentials, private
   content, PII, raw host paths, signed URL queries, and unrelated transcript
   material.
5. Persist through the task/session artifact transport: artifact reference,
   revision, content digest (SHA-256 over LF-normalized UTF-8 bytes from
   `## Authority` through the end of the contract; the metadata section
   holding the digest is excluded), and a successful read-back receipt. Link
   the artifact to the current Bead — root Bead, then GitHub issue/PR, as
   fallback authority when none exists. Repo files and OS-temp files are
   drafts, never resumable handoffs; when durable transport is unavailable,
   stop with a blocker.
6. Send one deduplicated notice only after persistence. Record the provider
   event/message ID as the notification receipt, or `not-sent` plus reason.

Creation is complete only when required fields are present, authority and
anchor claims carry probes, optional fields say `none: <reason>`, artifact
digest and read-back match, the task-link result is recorded, and notification
has either a receipt or an explicit `not-sent` result.

## Contract

```md
# Handoff — <primary task> — <purpose>

## Identity and transport
- Handoff ID / idempotency key:                 # required
- Created at:                                   # required
- From: <AgentSessionRef {agentTypeId, sessionId}> # required
- To: <AgentSessionRef or intended role>        # required
- Artifact reference / revision / digest:       # required
- Read-back receipt / task-link receipt:        # required
- Notification receipt or `not-sent: <reason>`: # required
- Transfer scope: durable                        # required

## Authority
- Primary task: <current Bead, root Bead, or GitHub issue/PR> # required
- GitHub issue / root Bead / current Bead / PR:
- Approved plan/TODO reference and digest:
- Task/session binding and revision:
- Human Intention ID, decision revision, target artifact/revision:

## Execution anchor
- Repository / Workspace:                       # required
- Workspace-relative worktree:
- Branch:
- Base SHA / source SHA:
- Expected integration head:
- Working-tree state:
- Admission/claim receipt expected by receiver:

## Live thread
- Outcome sought:                               # required
- Current status:                               # required
- Decisions and rationale:
- Changes made:
- Remaining work:

## Evidence
- Commands and results:
- Proof / demo / artifacts:
- Review artifact, verdict, reviewed SHA, and digest:

## Risks and recovery
- Blockers / risks / rollback:
- Failed approaches worth preserving:
- Agent-communication thread references:

## Resume
- Exact next action:                            # required
- Suggested skill:                              # required
- Exact invocation: `/skill:handoff resume <artifact-reference>` # required
- Stop conditions or required human decision:

## Claim ledger
- [verified: <probe/receipt>] <load-bearing claim>
- [unverified: <source>] <claim the receiver must re-probe>
```

Required means a concrete value is present. Optional fields use
`none: <reason>`, never a bare `none`. `AgentSessionRef` contains `agentTypeId`
and `sessionId`, never a host identifier. Message threads remain references, not
task state.

## Resume

1. Require one artifact reference. Read canonical authorities before trusting
   its narrative; verify the artifact revision/digest and task link.
2. Resolve every supplied path through `Workspace`; verify the assigned git
   top-level/common directory before inspecting source.
3. Compare current state with every authority and execution field: approved
   plan/TODO digest; issue, Bead, PR, and task/session-link revisions; Human
   Intention identity, decision revision, authorization, target artifact and
   revision; review artifact/digest and reviewed SHA; claim, worktree, branch,
   source SHA, and expected integration head. Re-probe every unverified or
   drifted field.
4. Acquire or verify the receiving session's atomic admission receipt: for a
   Worker, the current Bead claim and task/session binding; for a Steward or
   Reviewer, the addressed assignment and exact artifact or SHA. A receipt
   owned by another session, or no receipt, permits read-only inspection only
   — record the conflict and stop before execution.
5. Append a consumption receipt (handoff ID, receiving `AgentSessionRef`,
   authority digest, admission receipt, consumed time). Use compare-and-set
   consumption when the transport supports it and stop if already consumed;
   otherwise the admission receipt is the exclusivity guard — never infer
   exclusivity from the handoff itself.
6. Execute only the stated next action. Scope growth returns to `triage` or
   `plan`; stale human decisions return to Human Intentions.

Resume has two valid exits:

- **Accepted:** artifact and authority digests match, every unverified/drifted
  claim has a recorded probe, admission belongs to this session, the consumption
  receipt is durable, and one bounded next action has started.
- **Stopped:** a foreign/missing admission, stale authority, invalid path,
  missing artifact, or prior-consumption receipt is recorded durably and no
  execution or new consumption is claimed.
