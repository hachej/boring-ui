# Highlights example

This fixture inherits the registry's optional shadcn theme, unchanged, in light
and dark. It composes the repository's Base UI `base-nova` controls. The host uses
its system font when no `--font-sans` token exists; the block defines no font,
palette, radius, shadow or motion values.

- Primary, accent and muted tokens distinguish marks; foreground pairs come
  from the same theme. Rebranding changes the host's tokens, not decorations.
- New action/candidate buttons allow 44px targets. Candidate excerpts wrap on a
  phone. No animation is needed for these immediate selection/state changes.
- The existing editor remains intact, including its own toolbar and wording.
- The missing/ambiguous tray is inline, not a modal or a replacement shell.

Evidence: `npm run highlights:journey` captures desktop/phone, French/English,
light/dark and checks horizontal overflow. This is Chromium emulation, not a
complete accessibility audit or real-phone test.
