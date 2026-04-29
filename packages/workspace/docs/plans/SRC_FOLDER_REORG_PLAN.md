# `@boring/workspace` — src/ Folder Reorganization Plan

**Status:** Draft v2 (Opus review applied) — follow-up to j9p7 plugin model epic
**Goal:** Consolidate all scattered root-level `src/` folders into the canonical
4-folder layout (`front/`, `server/`, `shared/`, `plugins/`) so the codebase
matches the plugin model's architectural intent end-to-end.

**Non-goals:** No behavior changes. No public API breakage. Pure moves + re-exports.

---

## Why

After j9p7, `src/` still has 8 directories sitting outside the 4-folder layout:

```
src/
├── __tests__/     ← root-level integration tests (stays — integration scope)
├── data/          ← React data-fetching hooks
├── lib/           ← cn() + validation utils
├── panes/         ← plugin-owned panes sitting outside their plugins
├── store/         ← Zustand store + selectors
├── testing/       ← React test helpers (published as @boring/workspace/testing subpath)
├── theme/         ← CodeMirror + shadcn theme hooks
└── toast/         ← Sonner toast wrapper
```

These belong under `front/` (UI code) or inside their respective `plugins/`
(pane components). Leaving them at root creates two problems:
1. Import paths don't reflect ownership (`../../data` vs `../front/data`)
2. `panes/` is the most glaring — plugin-owned components live outside their plugin

---

## Target Layout

```
src/
├── front/
│   ├── bridge/           (existing)
│   ├── chrome/           (existing — ArtifactSurfacePane + EmptyPane MOVE HERE)
│   │   ├── artifact-surface/
│   │   │   ├── SurfaceShell.tsx          (existing)
│   │   │   ├── definition.ts             (existing)
│   │   │   └── ArtifactSurfacePane.tsx   ← MOVED from panes/ArtifactSurfacePane.tsx
│   │   ├── chat/               (existing)
│   │   ├── chat-stage-placeholder/  (existing)
│   │   ├── empty-file-panel/   (existing — j9p7.12)
│   │   ├── empty-pane/
│   │   │   └── EmptyPane.tsx   ← MOVED from panes/EmptyPane.tsx
│   │   ├── session-list/       (existing)
│   │   └── workbench-left/     (existing)
│   ├── components/
│   │   ├── data-catalog/       ← MOVED from panes/data-catalog/ (see Phase C)
│   │   ├── DataExplorer/       (existing)
│   │   ├── ui/                 (existing)
│   │   └── …                   (existing)
│   ├── data/             ← MOVED from src/data/
│   ├── dock/             (existing)
│   ├── events/           (existing)
│   ├── hooks/            (existing)
│   ├── layout/           (existing)
│   ├── lib/              ← MOVED from src/lib/
│   ├── plugin/           (existing)
│   ├── registry/         (existing)
│   ├── store/            ← MOVED from src/store/
│   ├── testing/          ← MOVED from src/testing/ (published subpath — see Phase A note)
│   ├── theme/            ← MOVED from src/theme/
│   ├── toast/            ← MOVED from src/toast/
│   └── WorkspaceProvider.tsx (existing)
│
├── plugins/
│   ├── filesystemPlugin/       (existing — panes move IN)
│   │   ├── index.ts            (plugin def — update import paths)
│   │   ├── FileTreeView.tsx    ← MOVED from panes/file-tree/ (exports FileTreePane + FileTreeView)
│   │   ├── FileTree.tsx        ← MOVED from panes/file-tree/
│   │   ├── CodeEditorPane.tsx  ← MOVED from panes/code-editor/ (exports CodeEditorPane)
│   │   ├── CodeEditor.tsx      ← MOVED from panes/code-editor/ (exports CodeEditor)
│   │   ├── MarkdownEditorPane.tsx ← MOVED from panes/markdown-editor/
│   │   ├── MarkdownEditor.tsx  ← MOVED from panes/markdown-editor/
│   │   ├── defaultEditorPanels.ts ← MOVED from panes/ (3 apps consume via barrel — keep)
│   │   └── __tests__/
│   │
│   └── factories/              (existing — makeStaticDataPlugin)
│
├── server/           (existing)
└── shared/           (existing)
```

`src/panes/` is **deleted entirely** once all contents are rehomed.
`src/__tests__/` stays at root (integration tests covering the full package).

---

## Why DataCatalog is NOT a plugin

`DataCatalog` / `DataCatalogPane` are **presentation components** — generic UI shells
with no concrete data of their own. Real catalogs come from `makeStaticDataPlugin`
(already in `plugins/factories/`). A "data-catalog" built-in plugin would be a
no-op: apps would register it and wonder why nothing shows up.

`DataCatalog` belongs alongside `DataExplorer` in `front/components/` — both are
presentational peers. Move `panes/data-catalog/*` → `front/components/data-catalog/*`.
No new plugin. No `WorkspaceProvider` defaults decision needed.

---

## Public API — Zero Breaking Changes

All current `src/index.ts` exports remain. New locations are re-exported:

```typescript
// Standalone components — still exported from new locations
export { FileTreeView, FileTreePane } from "./plugins/filesystemPlugin/FileTreeView"
export { FileTree } from "./plugins/filesystemPlugin/FileTree"
export { CodeEditorPane } from "./plugins/filesystemPlugin/CodeEditorPane"
export { CodeEditor } from "./plugins/filesystemPlugin/CodeEditor"
export { MarkdownEditorPane } from "./plugins/filesystemPlugin/MarkdownEditorPane"
export { MarkdownEditor } from "./plugins/filesystemPlugin/MarkdownEditor"
export { defaultEditorPanels } from "./plugins/filesystemPlugin/defaultEditorPanels"

export { DataCatalog } from "./front/components/data-catalog/DataCatalog"
export { DataCatalogPane } from "./front/components/data-catalog/DataCatalogPane"
export { ArtifactSurfacePane } from "./front/chrome/artifact-surface/ArtifactSurfacePane"
export { EmptyPane } from "./front/chrome/empty-pane/EmptyPane"

// Data layer, store, theme, toast, utils — re-exported from new front/ locations
export { DataProvider, useDataClient, useApiBaseUrl } from "./front/data"
export { FetchClient, FetchError } from "./front/data"
export { createWorkspaceStore } from "./front/store"
export { bindStore, useActiveFile, … } from "./front/store/selectors"
export { createShadcnTheme, useShadcnTheme } from "./front/theme"
export { toast, Toaster, dismissToast } from "./front/toast"
export { cn } from "./front/lib/utils"
```

`public-api.test.ts` catches any accidental drops (verify file exists at
`src/__tests__/public-api.test.ts` before starting).

---

## Phases

### Phase A1 — Move lib/ first (zero dependents in other moved folders)

Move `src/lib/` → `src/front/lib/`. Update all internal imports.
Run `pnpm --filter @boring/workspace typecheck` — must be green before A2.

**Why first:** `store/`, `data/`, `toast/` all import `lib/utils` and
`lib/validation`. Moving lib first avoids transient broken imports in A2.

---

### Phase A2 — Remaining utility folders (parallel after A1)

Move 5 directories simultaneously:

| From | To |
|------|----|
| `src/data/` | `src/front/data/` |
| `src/store/` | `src/front/store/` |
| `src/theme/` | `src/front/theme/` |
| `src/toast/` | `src/front/toast/` |
| `src/testing/` | `src/front/testing/` |

**Critical — `vite.config.ts` build entry must be updated:**
```diff
-  testing: "src/testing/index.ts",
+  testing: "src/front/testing/index.ts",
```
Failure to do this silently breaks the `@boring/workspace/testing` subpath
export in published dist.

**Acceptance:**
- `pnpm --filter @boring/workspace typecheck` green
- `pnpm --filter @boring/workspace test` green
- `pnpm --filter @boring/workspace build` produces `dist/testing.js` + `dist/testing.d.ts`
- Subpath smoke: `node -e "import('@boring/workspace/testing').then(m=>console.log(Object.keys(m)))"`

---

### Phase B — Chrome panes into front/chrome/

Move `ArtifactSurfacePane` and `EmptyPane` to sit alongside the rest of chrome:

| From | To |
|------|----|
| `src/panes/ArtifactSurfacePane.tsx` | `src/front/chrome/artifact-surface/ArtifactSurfacePane.tsx` |
| `src/panes/__tests__/ArtifactSurfacePane.*.test.tsx` | `src/front/chrome/artifact-surface/__tests__/` |
| `src/panes/EmptyPane.tsx` | `src/front/chrome/empty-pane/EmptyPane.tsx` |

**Internal imports to update:**
- `src/front/chrome/artifact-surface/SurfaceShell.tsx`: `../../../panes/ArtifactSurfacePane` → `./ArtifactSurfacePane`

Update `src/panes/index.ts` + `src/index.ts` re-exports.

**Note:** `src/front/chrome/empty-file-panel/` (j9p7.12, the *registered panel*) and
`empty-pane/EmptyPane.tsx` (the *generic empty state component*) coexist — keep separate.

**Acceptance:** typecheck + tests green, public API test green.

---

### Phase C — Move data-catalog into front/components/

`DataCatalog` is a presentation component, not a plugin (see rationale above).

Move `src/panes/data-catalog/*` → `src/front/components/data-catalog/*`.
Update `src/panes/index.ts` + `src/index.ts` re-exports. No new plugin file.

**Acceptance:** typecheck + tests green, public API test green.

---

### Phase D — Filesystem panes into filesystemPlugin

Move the 3 pane families into `src/plugins/filesystemPlugin/`:

| From | To |
|------|----|
| `src/panes/file-tree/` | `src/plugins/filesystemPlugin/file-tree/` |
| `src/panes/code-editor/` | `src/plugins/filesystemPlugin/code-editor/` |
| `src/panes/markdown-editor/` | `src/plugins/filesystemPlugin/markdown-editor/` |
| `src/panes/defaultEditorPanels.ts` | `src/plugins/filesystemPlugin/defaultEditorPanels.ts` |

Update `filesystemPlugin/index.ts` imports (relative path changes only).
Re-export `FileTree`, `FileTreeView`, `FileTreePane`, `CodeEditor`, `CodeEditorPane`,
`MarkdownEditor`, `MarkdownEditorPane`, `defaultEditorPanels` via `src/index.ts`.

**Internal imports to update:**
- `src/front/chrome/workbench-left/WorkbenchLeftPane.tsx`: `../../../panes/file-tree/FileTreeView` → `../../../plugins/filesystemPlugin/file-tree/FileTreeView`
- `stories/*.stories.tsx` + `stories/storybook-mocks.tsx`: update pane import paths (or document Storybook as deferred)

**Note on `defaultEditorPanels.ts`:** Consumed externally by `workspace-playground`,
`boring-macro-v2`, `full-app` via the barrel. Uses `source: "app"` panel defs
(distinct from `filesystemPlugin`'s `source: "builtin"` panels). Keep as-is for
now — deduplication is a separate follow-up.

**Acceptance:** typecheck + tests green, `filesystemPlugin` exports all its panes,
public API test green, no remaining files in `src/panes/`.

---

### Phase E — Delete src/panes/

`src/panes/` should now be empty except `index.ts` (now an empty barrel).

```bash
rm -rf src/panes/
```

Remove the now-dead `export * from "./panes"` line from `src/index.ts` if present.
Grep for any remaining `from "../../panes"` hits — must be zero.

**Acceptance:** `pnpm -w build` clean, all tests green.

---

### Phase F — Verification gate

1. `pnpm --filter @boring/workspace typecheck` — zero errors
2. `pnpm --filter @boring/workspace test` — zero failures
3. `pnpm --filter @boring/workspace build` — all dist subpaths present:
   `dist/{workspace,testing,ui-shadcn,shared,server,events}.js` + `.d.ts`
4. Public API: `public-api.test.ts` passes (all exported symbols present)
5. Subpath smoke: `@boring/workspace/testing` importable
6. Grep: `grep -r 'from ".*\.\.\/panes"' src/` → zero hits
7. Storybook: confirm `stories/*` typecheck or explicitly defer

---

## Implementation Notes

- **Do phases in order** — each phase is independently committable and verifiable
- **git mv** for all moves to preserve file history
- **`vite.config.ts` lib.entry.testing** is the only build-config change required
- **`tsconfig.front.json`**: excludes `src/server/**` and plugin server files — no update needed (no server code in moved paths)
- **`tsconfig.server.json`**: excludes `src/shared/plugin/**` — no update needed
- **`package.json` exports field**: references `dist/*` — no update needed; build entry handles it
- **Apps** consuming via `@boring/workspace` barrel (`workspace-playground`, `boring-macro-v2`, `full-app`) — zero changes required; all exports are re-exported from barrel unchanged
- **`tsup.config.ts`**: verify no hardcoded `src/testing/` include before Phase A2

---

## Estimated Effort

| Phase | Files touched | Risk |
|-------|--------------|------|
| A1 (lib/) | ~10 import updates | Very low |
| A2 (5 utility folders + vite.config) | ~50 import updates | Low — vite entry is the trap |
| B (chrome panes) | ~15 import updates | Low |
| C (data-catalog → components) | ~10 files | Low |
| D (filesystem panes) | ~35 import updates + stories | Medium |
| E (delete panes/) | cleanup | Low |
| F (gate) | verify only | — |

Total: ~2 agent-days. Optimal swarm: A1 solo → A2+B in parallel → C → D → E+F.
