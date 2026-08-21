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

## The two gates

- **Gate 1 — plan approval** (steward). Raised after the adversarial plan
  review, never before. Links the plan doc.
- **Gate 2 — merge approval** (worker). Raised after green proof, required
  reviews, and the present-pr artifact exist. Must name the exact SHA and the
  expected target head. **A seat may never approve its own request** — you
  raise it, the owner answers it.

## The call

`ask_user` takes a human-first `title`, structured `correlationId` and `kind`
metadata, Markdown `context`, `artifacts`, and a form `schema`:

```json
{
  "title": "Merge: epics-first Tasks view",
  "correlationId": "br-123 · PR #1234",
  "kind": "merge",
  "context": "## What changed\nTasks now opens epics first so active work is visible immediately.\n\n## Proof\n- Head `abc1234` against `main`\n- 41 tests green\n- Thermo and fresh-eyes reviews clean\n\n## Risk and rollback\nRead-only presentation change. Roll back by reverting `abc1234`.\n\n## Test steps\n1. Open **Tasks → Epics**.\n2. Expand `br-1100`.\n3. Toggle **Show closed**.",
  "artifacts": [
    {
      "id": "present-pr",
      "surfaceKind": "workspace.open.path",
      "target": "docs/issues/1187/present/pr-1234.html",
      "title": "PR review doc",
      "description": "Self-contained visual review artifact"
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

- **`title` is WHAT + WHY in plain language, at most 60 characters.** Start
  with the decision verb (`Merge:`, `Plan:`, `Choose:`, `Escalation:`). Never
  prefix the title with an opaque bead, task, issue, PR, branch, or SHA.
- **`correlationId` carries the durable correlation key.** Include the exact
  bead ID and, when useful, the PR/issue number. This metadata renders as a
  compact chip without consuming the subject line.
- **`kind` is required for factory gates.** Use `plan` for Gate 1 and `merge`
  for Gate 2. `question` and `escalation` are available for non-gate decisions.
- **`context` is concise Markdown with a stable hierarchy.** For owner review,
  use `## What changed`, `## Proof`, `## Risk and rollback`, and
  `## Test steps` in that order. Prefer bullets and numbered steps over a
  punctuation-heavy paragraph. Plain strings remain compatible but are not the
  factory convention.
- **`artifacts[].surfaceKind` must be a surface kind the workspace can open.**
  `workspace.open.path` with a workspace-relative `target` opens a file in a
  pane — that is how the present-pr page and any proof file reach the owner.
  A surface kind nothing resolves is a dead row in the Inbox.
- **URLs are not artifacts.** There is no external-URL surface. PR links, CI
  links, and SHAs go under the relevant Markdown heading in `context`.
- **Everything the owner needs to decide is in `context`.** They should not
  have to open a session transcript. The artifact list is supporting material,
  not a substitute for the four-section summary.
- **Ask a decision, not an essay.** A `radio`/`select` decision field plus an
  optional notes textarea. Max 8 fields.

## After the answer

The tool returns the owner's values to you, and the same exchange is durable in
the workspace — it, not chat, is the decision record.

- `approve` → proceed, and only at the SHA you named. If the head moved, the
  approval is void; re-raise.
- `changes`/`defer`/`reject` → resume the task loop with a NEW artifact
  revision. Never overwrite prior review evidence, and never merge.

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
