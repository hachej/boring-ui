# Dead Code Verification Report

**Date:** 2026-04-30  
**Scope:** `packages/workspace/src/front/` + all `apps/`  
**Method:** grep search for all imports and references across the entire project

---

## ✅ VERIFIED: SAFE TO DELETE

### 1. `chat-stage-placeholder/` folder
**Location:** `packages/workspace/src/front/chrome/chat-stage-placeholder/`  
**Files:** 2 files (ChatStagePlaceholder.tsx, definition.ts)

**Evidence of non-usage:**
- ❌ Not registered in `coreRegistrations.ts`
- ❌ Not imported anywhere in `packages/workspace/src/` (except its own files)
- ❌ Not imported anywhere in `apps/`
- ❌ Not referenced in any layout (ChatLayout, IdeLayout, etc.)
- ❌ Exported from `chrome/index.ts` but never consumed

**What it is:** A placeholder component for chat stage with suggestion cards. Looks like it was prepared for a feature that was never implemented.

**Action:** ✅ **DELETE** entire folder

---

## ❌ VERIFIED: IN USE - KEEP

### 2. `empty-file-panel/` folder
**Location:** `packages/workspace/src/front/chrome/empty-file-panel/`  
**Files:** 2 files (EmptyFilePanel.tsx, definition.ts)

**Evidence of usage:**
- ✅ Registered in `coreRegistrations.ts`: `import { emptyFilePanelDef } from "../chrome/empty-file-panel/definition"`
- ✅ Used in `SurfaceShell.tsx`: `return "empty-file-panel"` (fallback for unknown file types)
- ✅ Referenced in tests: `WorkspaceProvider.test.tsx`, `plugin-integration.test.tsx`
- ✅ Referenced in test: `resolvePanelForPath.test.ts` (3 test cases)

**What it is:** Fallback panel shown when no editor is registered for a file extension.

**Action:** ❌ **KEEP** - Active fallback mechanism

---

### 3. `workbench-left/` folder
**Location:** `packages/workspace/src/front/chrome/workbench-left/`  
**Files:** 2 files (WorkbenchLeftPane.tsx, definition.ts)

**Evidence of usage:**
- ✅ Registered in `coreRegistrations.ts`: `import { workbenchLeftPanel } from "../chrome/workbench-left/definition"`
- ✅ Used as default sidebar in ChatLayout
- ✅ Used in `apps/workspace-playground/src/App.tsx`: `sidebar="workbench-left"`

**What it is:** Composite left sidebar with file tree + data explorer tabs.

**Action:** ❌ **KEEP** - Active component used in layouts

---

### 4. `recent/` folder
**Location:** `packages/workspace/src/front/components/recent/`  
**Files:** 4 files (recentStore.ts, migrate.ts, types.ts, index.ts)

**Evidence of usage:**
- ✅ Used in `CommandPalette.tsx`:
  ```typescript
  import {
    loadRecent,
    addCatalogToRecent,
    addCommandToRecent,
  } from "../recent/recentStore"
  
  const entries = loadRecent()
  addCatalogToRecent(catalog.id, row)
  addCommandToRecent(cmd.id, cmd.title)
  ```
- ✅ Referenced in test: `CommandPalette.test.tsx`

**What it is:** Recent items storage for command palette quick-open.

**Action:** ❌ **KEEP** - Active feature

---

## ⚠️ VERIFIED: REDUNDANT EXPORT - CLEANUP NEEDED

### 5. `useShadcnTheme` hook
**Location:** `packages/workspace/src/front/theme/useShadcnTheme.ts`

**Evidence:**
- ✅ `createShadcnTheme` is used internally (CodeEditor.tsx, useShadcnTheme.ts)
- ❌ `useShadcnTheme` is **never called** anywhere in the codebase
- ❌ Only export site: `packages/workspace/src/front/theme/useShadcnTheme.ts`
- ❌ Only export site: `packages/workspace/src/index.ts`

**Issue:** The hook is exported but unused. The public API is `useTheme()` from `WorkspaceProvider`, which is what apps should use.

**Action:** ⚠️ **REMOVE EXPORT** only (keep `createShadcnTheme` for internal use)

**Changes needed:**
```typescript
// packages/workspace/src/front/theme/index.ts
export { createShadcnTheme } from "./codemirror-theme"
// Remove: export { useShadcnTheme } from "./useShadcnTheme"

// packages/workspace/src/index.ts
export { createShadcnTheme } from "./front/theme"
// Remove: export { useShadcnTheme } from "./front/theme"
```

---

## 📊 SUMMARY

| Item | Location | Status | Action | Files to Delete |
|------|----------|--------|--------|-----------------|
| chat-stage-placeholder | `chrome/chat-stage-placeholder/` | ✅ Dead | DELETE | 2 |
| empty-file-panel | `chrome/empty-file-panel/` | ❌ Active | KEEP | 0 |
| workbench-left | `chrome/workbench-left/` | ❌ Active | KEEP | 0 |
| recent | `components/recent/` | ❌ Active | KEEP | 0 |
| useShadcnTheme export | `theme/` + `index.ts` | ⚠️ Redundant | Remove export | 0 |

**Total files to delete:** 2  
**Total exports to remove:** 2 lines

---

## 🔧 EXECUTION PLAN

### Step 1: Delete dead folder (5 min)
```bash
cd /home/ubuntu/projects/boring-ui-v2-reorg/packages/workspace
rm -rf src/front/chrome/chat-stage-placeholder/
```

### Step 2: Remove redundant export (5 min)
Edit `src/front/theme/index.ts`:
```diff
 export { createShadcnTheme } from "./codemirror-theme"
-export { useShadcnTheme } from "./useShadcnTheme"
```

Edit `src/index.ts`:
```diff
-export { createShadcnTheme, useShadcnTheme } from "./front/theme"
+export { createShadcnTheme } from "./front/theme"
```

### Step 3: Verify build & tests (5 min)
```bash
cd /home/ubuntu/projects/boring-ui-v2-reorg/packages/workspace
pnpm typecheck
pnpm test
```

### Step 4: Update exports index if needed
Check `src/front/chrome/index.ts` - remove the export:
```diff
 export { chatPanel } from "./chat/definition"
 export { ChatPanelHost } from "./chat/ChatPanelHost"
 export { sessionListPanel } from "./session-list/definition"
 export { workbenchLeftPanel } from "./workbench-left/definition"
 export { artifactSurfacePanel } from "./artifact-surface/definition"
-export { chatStagePlaceholderPanel } from "./chat-stage-placeholder/definition"
```

---

## 📝 NOTES

1. **EmptyFilePanel is critical** - It's the fallback for unknown file types. Removing it would break file opening for unregistered extensions.

2. **WorkbenchLeftPane is actively used** - It's the default sidebar in ChatLayout and used in workspace-playground app.

3. **Recent store powers CommandPalette** - The "recent files" and "recent commands" feature in Cmd+P relies on this.

4. **useShadcnTheme is dead code but low risk** - Removing the export is safe since nothing uses it. The underlying `createShadcnTheme` function is still needed internally.

---

## ✅ VERIFICATION COMMANDS

To verify these findings yourself:

```bash
# Check chat-stage-placeholder usage
grep -r "chat-stage-placeholder\|ChatStagePlaceholder" . --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "chat-stage-placeholder/"

# Check empty-file-panel usage  
grep -r "empty-file-panel\|EmptyFilePanel" . --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "empty-file-panel/"

# Check workbench-left usage
grep -r "workbench-left\|WorkbenchLeftPane" . --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "workbench-left/"

# Check recent store usage
grep -r "recentStore\|loadRecent\|addCatalogToRecent" . --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "components/recent/"

# Check useShadcnTheme usage
grep -r "useShadcnTheme(" . --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "theme/useShadcnTheme.ts"
```

All commands should return **no results** (except the source files themselves) for items marked as dead code.
