# [Production Deps Group Retry] What changed, visually

This view is derived from reviewed implementation/evidence commit `9686bc4caafe3777cc680405e1f76f2235234487` against current `origin/main` `6b540ec3e421db6b66c36ec8f3d301a3a51bcf92`. A later docs-only artifact commit may carry this file; the reviewed product state remains `9686bc4ca`.

## Final package resolution

```diff
 grouped Dependabot proposal
-├── TypeScript 7.0.2                    # tsup / rollup-plugin-dts compiler crash
-├── Mermaid 11.17.2                     # CLI entry and preload budget breach
-├── streamdown 2.6.0                    # CLI resource-budget isolation
-├── lucide-react 1.39.0                 # CLI resource-budget isolation
-├── Vite 8.2.2                          # CLI entry-budget blocker
-├── motion 13.1.1                       # CLI entry-budget blocker
-├── @vercel/sandbox 3.2.1               # CLI entry-budget blocker
-├── ai 7.0.90                           # CLI entry-budget blocker
-└── @earendil-works/pi-ai 0.84.4        # CLI entry-budget blocker
++    every manifest + pnpm-lock.yaml = origin/main@6b540ec3
```

## Bump-only source accommodation removed

```diff
 packages/cli/vite.config.ts
   manualChunks(id)
     vendor-react
     vendor-dockview
-    vendor-ai
-    vendor-zod
-    vendor-lucide
-    vendor-motion
-    vendor-streamdown
+  # file is byte-identical to origin/main@6b540ec3
```

Product source may not be changed to force a dependency update through existing budgets. The retry therefore removed both the five retained upgrades and their chunk workaround.

## Delivery flow

```mermaid
sequenceDiagram
    participant D as Dependabot group
    participant B as Required checks / budgets
    participant W as Retry worker
    participant R as Independent reviewer
    participant P as PR #1572
    D->>B: nine production bumps
    B-->>W: compiler and fixed-budget failures
    W->>W: isolate and drop all nine bumps
    W->>W: restore manifests, lock, CLI config to main
    W->>R: review exact 9686bc4ca
    R-->>W: standards PASS; thermo PASS; abstraction PASS
    W->>P: docs/metadata-only automatic admission evidence
```

## Exact evidence for every drop

| Package | Isolated evidence | Disposition |
|---|---|---|
| TypeScript 7.0.2 | `c9c344125`; tsup 8.5.1 / rollup-plugin-dts crashed reading `useCaseSensitiveFileNames` | dropped |
| Mermaid 11.17.2 | `db571dc05`; CLI entry 1,243,498 B and preload 1,244,604 B exceeded 1,000,000 B limits | dropped |
| streamdown 2.6.0 | `83e538637`; CLI resource-budget isolation | dropped |
| lucide-react 1.39.0 | `5d0392cac`; CLI resource-budget isolation across workspace ranges | dropped |
| Vite 8.2.2 | `d5551933d`; isolated CLI entry-budget blocker | dropped |
| motion 13.1.1 | `2d515bff5`; isolated CLI entry-budget blocker | dropped |
| @vercel/sandbox 3.2.1 | `15356fd64`; isolated CLI entry-budget blocker | dropped |
| ai 7.0.90 | `08a7b7bc5`; isolated CLI entry-budget blocker | dropped |
| @earendil-works/pi-ai 0.84.4 | `e4b3a3e4f`; isolated CLI entry-budget blocker | dropped |

## Final classification

```text
base  6b540ec3 current main
  └─ head 9686bc4ca reviewed state
       ├─ production source changed:       0 files / 0 lines
       ├─ dependency metadata changed:     0 files / 0 lines
       ├─ package public seams changed:    none
       ├─ protected-boundary triggers:     none
       └─ remaining PR diff:               docs + Factory metadata
```

Exact-head GitHub runs [34399996416](https://github.com/hachej/boring-ui/actions/runs/34399996416) and [34399996424](https://github.com/hachej/boring-ui/actions/runs/34399996424) are green. Review session `8354e1ef-c5f7-4b8d-aac7-d5e6c0915309` (`openai-codex/gpt-5.6-sol`) approved exact `9686bc4ca` with standards/spec PASS, thermo PASS, and explicit package-abstraction PASS. UI evidence is N/A because no product or UI delta remains.
