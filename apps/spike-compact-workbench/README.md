# Compact Workbench — frontend spike (throwaway)

Clickable prototype of Variant A from the workbench-compaction proposal:
**rail (44px) → compact stacked context column (320px) → dockview tab area (flex-1)**.

Frontend only. No backend, no server, all data is static fixtures in `src/data.ts`
and labelled "demo". Internal quality is deliberately throwaway; the look-and-feel is
the deliverable.

## Run

This app has no `node_modules` of its own — it borrows the monorepo root's
(react, dockview-react, vite, tailwind v4):

    ln -s ../../node_modules apps/spike-compact-workbench/node_modules   # once
    cd apps/spike-compact-workbench
    node ../../node_modules/vite/bin/vite.js --host 0.0.0.0   # SPIKE_PORT=5477 default

## What it demonstrates

- rail is the single inventory of plugin surfaces (6 of them, to show plurality)
- clicking the active rail icon collapses the column to rail-only
- list on top / read-only peek stacked BELOW in the same column (HeroFilePane pattern)
- `⤢ pin` escalates the peek into a real (pinned) dock tab
- double-click a list row → ephemeral/preview tab (`~` prefix), replaced by the next preview
- "Simulate agent open" = `openArtifact(..., { steal: false })`: background ephemeral tab
  + rail icon pulse, no context steal
