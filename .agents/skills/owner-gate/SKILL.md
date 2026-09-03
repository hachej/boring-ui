---
name: owner-gate
description: Raise a factory gate as a durable Inbox Human Intention and block on the owner's decision.
disable-model-invocation: true
---

# Owner gate

A factory gate is a point where the owner decides and the seat must not
proceed. There is exactly one transport: the `ask_user` tool, which raises an
**Inbox Human Intention** and blocks your turn until the owner answers.
`docs/procedures/owner-review-card.md` says WHAT to put in front of the owner;
this says HOW it reaches them.

Never substitute a chat message, a bead comment, or a "let me know" for a gate.
A gate that did not become an inbox item did not happen.

Titles follow `docs/procedures/naming-conventions.md`: `[Feature Name] Plan
approval` / `[Feature Name] Merge approval` — never lead with a bead id.

## The two gates

- **Gate 1 — plan approval** (Orchestrator). Raised after the Bead graph is
  materialized and the adversarial plan review is done, never before. Links
  the plan doc.
- **Gate 2 — merge approval** (Orchestrator). Raised once every epic Bead is
  handed off (per `factory_status` or its equivalent): open or update the
  epic PR (title `[Feature Name] <what changed>`, body = the Owner Review
  card from `docs/procedures/owner-review-card.md` plus a `## Handover`
  section), start a `demo_sandbox` at the exact SHA when that tool is
  available, and put its URL on the card's `Artifact:` line and again in
  `context` with its expiry. Must name the exact SHA and the expected target
  head. **A seat may never approve its own request** — you raise it, the
  owner answers it.

## The call

`ask_user` takes `title`, `context`, `artifacts`, and a form `schema`:

```json
{
  "title": "[Farewell API] Merge approval",
  "context": "The farewell export is ready to merge.\nPR #1234 · head abc1234 · target main\nDemo: https://demo.example/abc1234 (expires in 30m)\nProof: 41 tests green, thermo clean.\nRisk: read-only view, revert = revert the commit.\nPlease test: open Tasks -> Epics, expand br-1100, toggle 'Show closed'.",
  "artifacts": [
    {
      "id": "plan-note",
      "surfaceKind": "workspace.open.path",
      "target": "docs/issues/1187/plan.md",
      "title": "Plan note",
      "description": "Short plan note for this epic"
    }
  ],
  "schema": {
    "wireVersion": 1,
    "submitLabel": "Record decision",
    "fields": [
      {
        "type": "radio",
        "name": "decision",
        "label": "Decision",
        "required": true,
        "options": [
          { "value": "approve", "label": "Approve — merge at this SHA" },
          { "value": "changes", "label": "Request changes" },
          { "value": "defer", "label": "Defer" },
          { "value": "reject", "label": "Reject" }
        ]
      },
      { "type": "textarea", "name": "notes", "label": "Notes", "required": false }
    ]
  }
}
```

Rules that make the item usable rather than merely present:

- **`title` follows `docs/procedures/naming-conventions.md`:** `[Feature
  Name] Plan approval` or `[Feature Name] Merge approval` — never a bead id.
  The feature name, not the id, is the thing the owner recognizes at a glance.
- **The first line of `context` is one plain sentence about what this is** —
  no ids in it. Ids (bead id, PR number, SHA, demo URL) come after that line.
- **`artifacts[].surfaceKind` must be a surface kind the workspace can open.**
  `workspace.open.path` with a workspace-relative `target` opens a file in a
  pane — that is how a plan note or proof file reaches the owner. A surface
  kind nothing resolves is a dead row in the Inbox.
- **URLs are not artifacts.** There is no external-URL surface. PR links, CI
  links, demo URLs, and SHAs go in `context` as plain text (and, at Gate 2,
  on the card's `Artifact:` line too).
- **Everything the owner needs to decide is in `context`.** They should not
  have to open a session transcript. State what changed, the risk and rollback,
  the proof, and the exact test steps.
- **Ask a decision, not an essay.** A `radio`/`select` decision field plus an
  optional notes textarea. Max 8 fields.

## After the answer

The tool returns the owner's values to you, and the same exchange is durable in
the workspace — it, not chat, is the decision record.

- `approve` at Gate 1 → arm durable supervision and dispatch Workers.
- `approve` at Gate 2 → comment on the PR that the owner approved at that SHA
  and report; the agent never merges — the owner merges.
- `changes`/`defer`/`reject` at Gate 2 → open follow-up Beads labelled
  `epic:<key>` and dispatch a Worker; never overwrite prior review evidence,
  never merge.
- `changes`/`defer`/`reject` at Gate 1 → revise the plan and re-raise, or stop
  and report.
- In every case, only at the SHA/plan you named. If the head moved, the
  approval is void; re-raise.

If the tool errors or is unavailable, fall back to a GitHub comment on the PR
carrying the same card, and say in your handoff that the fallback was used.

## Failure modes

- **Restart loses the question.** A pending intention whose server restarted is
  marked `abandoned`, not answered. Treat an abandoned gate as unanswered and
  re-raise it; never read it as consent.
- **A cancelled ask returns an error**, not a decision. Same rule: unanswered.
- **Rate limits** are 6 asks per session per minute. Gates are rare; if you are
  hitting that, you are asking questions that belong in the work, not at a gate.

Return: the intention's title, the artifacts it carried, the owner's decision
verbatim, and the action you took because of it.
