# Visual Review

Build only a thin `visual-review` pending surface:

1. store one pending review item per session;
2. publish a lightweight UI-state hint;
3. add a `WorkspaceAttentionBlocker` with a review session badge;
4. best-effort open `openSurface { kind: "visual-review" }` with
   `openOnlyWhenSessionOpen: true`;
5. render the visual artifact and approval choices in that surface.

- Renderer: `visual-explainer` creates HTML artifact.
- Install only from owner-approved commit SHA.
- Do not auto-approve mutable source, branch, or tag.

```bash
pi install -l git:github.com/nicobailon/visual-explainer#<reviewed-commit-sha>
```

- `--approve`: only after Julien approved that exact commit.
- Fallback: Markdown/HTML; record missing approved tool.

Use for non-trivial owner handoff. Record:

```text
visualReview:
visualReviewId:
artifact:
visualReviewStatus:
```

- Blocked until Julien answers session-scoped review.
- Merge source of truth: pending review record.
- Surface includes: issue/PR, demo, flag, proof, risk, choices.
- Choices: approve, request changes, defer, reject/remove.
- Fallback until surface exists: ask-user with artifact link.
- Copy fallback answer into `visualReviewStatus` for the current artifact.
- Do not invent a second review workflow.
