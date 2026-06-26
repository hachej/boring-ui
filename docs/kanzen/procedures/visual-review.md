# Visual Review

Do not build a broad GitHub review plugin. The only boring-ui layer needed is a
thin `visual-review` pending surface, modeled on `ask-user`:

1. store one pending review item per session;
2. publish a lightweight UI-state hint;
3. add a `WorkspaceAttentionBlocker` with a review session badge;
4. best-effort open `openSurface { kind: "visual-review" }` with
   `openOnlyWhenSessionOpen: true`;
5. render the visual artifact and approval choices in that surface.

Use `visual-explainer` only as the renderer that creates the HTML artifact.

Install locally only from an owner-approved commit SHA. Do not auto-approve a
new mutable external source, branch, or tag from the loop itself:

```bash
pi install -l git:github.com/nicobailon/visual-explainer#<reviewed-commit-sha>
```

Use `--approve` only when Julien has already approved that exact commit.
Otherwise fall back to Markdown/HTML review material and record the missing
approved tool.

Use it for owner handoff when a plan, PR, stack, or proof story is non-trivial.
Record:

```text
visualReview:
visualReviewId:
artifact:
visualReviewStatus:
```

The handoff stays blocked until Julien answers the session-scoped review item.
Owner comments can inform the item, but the pending review record is the merge
source of truth. The review surface must open with the visual artifact ready and
include the issue/PR, demo surface, flag state, proof, risk, and exact choices:
approve, request changes, defer, reject/remove.

Until that thin surface exists, use `ask-user` as a compatibility fallback with
the artifact link in the question context, and comment the fallback ask-user
session id. Copy the ask-user answer into `visualReviewStatus` for the current
artifact so the merge gate stays the same. Do not replace the renderer or invent
a second review workflow.
