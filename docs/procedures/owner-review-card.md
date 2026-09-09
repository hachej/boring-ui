# Owner review card

Create an Inbox Human Intention only when a protected boundary in
[boring-loop](boring-loop.md#where-the-owner-reviews) requires an owner decision,
or an existing gate still applies during rollout. Routine automatic-eligible
work gets a proof/merge receipt, not an approval request; this includes plugin UI
with its before/after video. Obtain plan decisions before implementation and
merge decisions after proof/reviews. Tie the intention to the exact bead, task,
artifact, scope and revision — title follows
[`naming-conventions.md`](naming-conventions.md): `[Feature Name] Plan
approval` or `[Feature Name] Merge approval`, never a bead id. That durable
record — not chat — is the decision source of truth. Use `ask_user` for the
decision transport when available (GitHub comment fallback). The intention
links a **PR review doc** — self-contained visual HTML per
[`visual-review-doc.md`](visual-review-doc.md). The card's `Artifact:` line
carries the running demo URL (from `demo_sandbox`, with its expiry) or the
best non-UI proof file — put the same URL in the Inbox `context` too:

```md
## Owner Review
Bead / PR / issue:
What changed / why:
Why you are needed (matched protected boundary):
Recommendation / alternatives:
Scope / base / head SHA:
What approval authorizes (plan, merge, or a specific exception):
Risk / rollback:
Proof / independent review / abstraction verdict links:
Artifact: <running UI demo or best non-UI proof file>
Please test:
1. <exact step>
Decision: approve | request changes | defer | reject

## Show me
<diff-shaped views (component/call/file tree diff) plus one sequence diagram
of the shipped flow, derived from the actual commits — see
`.agents/skills/show-me/SKILL.md` and `.agents/skills/owner-gate/SKILL.md`>
```

For UI, attach the Playwright before/after video, keep the playground/demo
running for its stated lifetime, and include desktop/mobile checks. For other
work, attach the most useful artifact and validation steps. Request-changes
resumes the same task/PR loop with a new artifact/revision; do not overwrite prior
review evidence. Protected-boundary merges require explicit revision-bound
approval; automatic-eligible work follows boring-loop's verification and rollout
gates instead. Plan approval never authorizes an unseen implementation. Approval
cannot waive an abstraction violation or silently cover later material changes.
Pending, rejected, expired, unreadable or missing decisions do not grant authority.

The `## Show me` section is mandatory (owner ruling), sits between the Owner
Review card and `## Handover`, and is mirrored to
`docs/issues/<issue>/show-me-<short sha>.md`, passed as an artifact per
`docs/procedures/naming-conventions.md`.
