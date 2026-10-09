# Mockups: the cheapest form that settles the question

A mockup exists to settle one question with the expert ("is this what you
mean?"), not to design the product. Pick the cheapest form that settles it:

| The question | Form |
|---|---|
| What happens, in what order, with which outcome | A **Markdown scenario** ([templates/scenario.md](templates/scenario.md)) |
| When sequencing matters more than screens (who does what, retries, hand-offs) | A **Mermaid** flow diagram in Markdown |
| Where things sit on a screen, or how screens connect | A **tldraw canvas** (`.tldr`) |
| What the expert will actually see and do | A **single-file HTML mockup** ([templates/mockup.html](templates/mockup.html)) |
| Which of two or three ways works better | **Variants** behind a picker in one HTML file (Emil Kowalski's `prototype` skill, if installed, does this well) |
| How the real app behaves today, or on a preview | **Screenshots or a journey** of the running app with the project's verify CLI: `node scripts/verify.mjs open <path>`, `viewport 375 812` for a phone, `screenshot mockups/<name>.png` |

## HTML mockups

- One file, no network: no CDN, no font or image downloads. Inline CSS and a
  few lines of script at most.
- The look of the app: the scaffold's tokens (calm green primary, light
  background, rounded cards, system font), as in the template.
- Every state that matters, switchable from a small picker at the top: empty,
  loading, error, long text, and the expert's override (what they do when the
  software is wrong). Use the expert's words for every label.
- Fictional data only.

## Where they go

Everything under `mockups/F-<n>/` on the contract branch (`contract/F-<n>`),
committed with the contract. The contract's `mockups` field lists each one with
its path and the commit that holds it (`git log -1 --format=%H -- <path>`) and
the states it shows. Show the expert the file (open it, or a screenshot) and
ask the one question it is meant to settle.
