# Session handoff

Transfer one live task between agent sessions or roles. A handoff is a compact
resume contract communicating observed state; GitHub, Beads, task/session
links, reviewed artifacts, and human decisions stay authoritative. Use
[`owner-review-card.md`](owner-review-card.md) when a human owes the next
decision.

Full field-by-field contract template and formal semantics (digest algorithm,
atomic admission, required/optional field lists) live in
[`.agents/skills/handoff/CONTRACT.md`](../../../.agents/skills/handoff/CONTRACT.md).
This file covers when to hand off and the operative checklists only.

## When to hand off

Hand off when a live task must move to another session or role — a shift
change, a role change (Worker → Reviewer), or an explicit pause/resume across
sessions. Don't hand off if the task is done or can finish in the current
session.

## Create checklist

1. Require an intended receiver/role and one bounded purpose.
2. Read the canonical issue, approved plan/TODO revision, current/root Bead,
   PR, task/session link, Human Intention decision, and linked proof/review
   when each exists. Probe current git/worktree and tracker state — don't
   copy it from chat.
3. Fill in the contract template from `CONTRACT.md`, marking every authority,
   revision, execution-anchor, completion, and blocker claim as
   `[verified: <probe/receipt>]` or `[unverified: <source>]`.
4. Resolve repository/worktree paths through `Workspace`; redact secrets,
   credentials, private content, PII, raw host paths, and unrelated
   transcript material.
5. Persist through the task/session artifact transport (never a repo file or
   OS-temp file) and confirm a successful read-back receipt. Link the
   artifact to the current Bead, or GitHub issue/PR as fallback authority.
6. Send one deduplicated notice only after persistence, and record the
   notification receipt or `not-sent` plus reason.

## Resume checklist

1. Require one artifact reference. Read canonical authorities before trusting
   its narrative; verify the artifact revision/digest and task link.
2. Resolve every supplied path through `Workspace`.
3. Compare current state against every authority and execution field;
   re-probe every unverified or drifted claim.
4. Acquire or verify the receiving session's atomic admission receipt. A
   receipt owned by another session, or no receipt, permits read-only
   inspection only — record the conflict and stop before execution.
5. Append a durable consumption receipt before executing.
6. Execute only the stated next action. Scope growth returns to `triage` or
   `plan`; stale human decisions return to Human Intentions.

See `CONTRACT.md` for the full contract fields and the formal accept/stop exit
conditions.
