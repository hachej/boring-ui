# [Production Deps Group Retry] What changed, visually

This file keeps its historical name because it was linked from PR #1572 before the retry. The retry supersedes that earlier outcome: no dependency bump or bump-only product configuration remains.

## Final package resolution

```diff
 grouped Dependabot proposal
-├── TypeScript 7.0.2                    # tsup/rollup-plugin-dts crash
-├── Mermaid 11.17.2                     # CLI entry resource budget
-├── streamdown 2.6.0                    # CLI resource budget isolation
-├── lucide-react 1.39.0                 # CLI resource budget isolation
-├── Vite 8.2.2                          # CLI entry resource budget
-├── motion 13.1.1                       # CLI entry resource budget
-├── @vercel/sandbox 3.2.1               # CLI entry resource budget
-├── ai 7.0.90                           # CLI entry resource budget
-└── @earendil-works/pi-ai 0.84.4        # CLI entry resource budget
+    manifests + pnpm-lock.yaml = origin/main 6b540ec3
```

## Source accommodation removed

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
```

The removed vendor rules were introduced only to make upgraded dependencies fit existing budgets. The retry rule forbids changing product source to accommodate a dependency, so the five then-retained bumps and this workaround were dropped together.

## Exact evidence for every drop

| Package | Isolated evidence | Disposition |
|---|---|---|
| TypeScript 7.0.2 | `c9c344125`; tsup 8.5.1 / rollup-plugin-dts crashed reading `useCaseSensitiveFileNames` | dropped |
| Mermaid 11.17.2 | `db571dc05`; CLI entry measured 1,243,498 B and preload 1,244,604 B against 1,000,000 B limits | dropped |
| streamdown 2.6.0 | `83e538637`; budget-isolation commit removed the bump | dropped |
| lucide-react 1.39.0 | `5d0392cac`; budget-isolation commit removed all workspace ranges | dropped |
| Vite 8.2.2 | `d5551933d`; isolated entry-budget blocker | dropped |
| motion 13.1.1 | `2d515bff5`; isolated entry-budget blocker | dropped |
| @vercel/sandbox 3.2.1 | `15356fd64`; isolated entry-budget blocker | dropped |
| ai 7.0.90 | `08a7b7bc5`; isolated entry-budget blocker | dropped |
| @earendil-works/pi-ai 0.84.4 | `e4b3a3e4f`; isolated entry-budget blocker | dropped |

At reconciliation commit `36dced126`, every manifest, `pnpm-lock.yaml`, and `packages/cli/vite.config.ts` matches current main exactly. Exact-head GitHub runs 34394498013 and 34394498006 pass all applicable required jobs, including lint, typecheck, changed units, invariants, Runtime Refactor P8, and PR Fast Summary. Heavy jobs are correctly skipped because the final PR has no product or dependency delta.

## Prior red checks diagnosed

```text
Runtime Refactor P8 ─┐
E2E ─────────────────┼─ Google Chrome apt index Hash Sum mismatch (external)
UI Review ───────────┘
PR Fast Summary ─────── aggregate failure caused by E2E
```

The retry leaves a docs/Factory-metadata-only diff against current main. There is no runtime API, package export, authority, UI behavior, design-system, dependency, lockfile, or production-source change.
