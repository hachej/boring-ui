# Migration note fragments

A PR that changes a published package or registry recipe adds one file here, `migrating/<pr-number-or-slug>-<short-name>.md`, holding its bullet(s) exactly as they would read under `# Unreleased` in MIGRATING.md. Do not edit MIGRATING.md: that is what caused the merge conflicts.
`npm run release:version -- <version>` appends every fragment (filename order) after any bullets already under `# Unreleased`, promotes the section to `# Migrating to <version>` and deletes the fragments.

Example, `migrating/2290-app-shell-resize.md`:
`- **\`app-shell\`: the composer can be resized (additive).** What changed, and what an app must do.`
