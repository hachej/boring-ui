# Highlights example

This fixture inherits the registry's optional shadcn theme, unchanged, in light
and dark. It composes the repository's Base UI `base-nova` controls. The host uses
its system font when no `--font-sans` token exists; the block defines no font,
palette, radius, shadow or motion values.

- Marks blend their primary, accent or muted role with the chart-4 marker tint
  and the background, keeping the normal foreground. Both hues come from host
  tokens. A focused mark has a ring-token outline; a comment adds a small
  speech-bubble indicator. Neither is browser text selection.
- Actions use unchanged outline/secondary shadcn Buttons in size sm, at their
  natural width. Candidate excerpts sit above their action, keep whole-word
  context and emphasise the match. No animation is needed for these immediate
  selection/state changes.
- The existing editor remains intact, including its own toolbar and wording.
- The missing/ambiguous tray is inline, not a modal or a replacement shell.

Evidence: `npm run highlights:journey` captures desktop/phone, French/English,
light/dark and checks horizontal overflow. This is Chromium emulation, not a
complete accessibility audit or real-phone test.
