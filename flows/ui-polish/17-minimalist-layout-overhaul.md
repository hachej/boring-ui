# UI Polish: Minimalist Layout Overhaul

**Priority:** CRITICAL
**Component:** Global layout, sidebar, terminal, chat panel
**Screenshots:** 01-initial-load, 02-file-tree, 04-editor, 05-dark-mode, 14-user-menu, 19-agent-tool-use
**Source:** Gemini 2.5 Pro + Gemini 3.1 Pro: "delete half the controls, trust keyboard shortcuts and hover"

## Core Problem
The UI exposes too many controls simultaneously. The left sidebar alone has 5 visual layers before a single file is visible (brand title -> header bar -> toolbar -> search -> section header). Every panel has redundant headers, permanent buttons for rare actions, and borders creating a boxy feel.

## Philosophy
- **Progressive disclosure**: hide secondary controls, reveal on hover or focus
- **Command palette first**: move rare actions to Cmd+K, not permanent buttons
- **Trust the user**: devs know Cmd+C, Enter to send, right-click for context menus

---

## P0 - Must Do

### 1. Flatten the left sidebar from 5 layers to 2

**Current layers:**
1. Brand title ("B app")
2. Header bar (bot icon + collapse chevron)
3. Toolbar (folder/git toggle + new file button)
4. Search input
5. Section header ("Other" with ... menu + collapse)

**Target:**
1. Project name row (with hover-revealed actions)
2. File tree (immediately)

**Note:** Left sidebar supports horizontal splits (e.g., filetree + data catalog in boring-macro). `LeftPaneHeader` renders once on the first panel only. Each stacked panel keeps its own `SidebarSectionHeader`.

**Specific changes:**
- **SIMPLIFY** the "B app" brand block — merge into a single compact row: `app [<]` (workspace name + collapse chevron). No big orange "B" logo block
- **MOVE** the bot icon (🤖 "Open new chat pane") from the sidebar header → right end of the **editor tab strip** (via DockView's `rightHeaderActionsComponent`, already wired in App.jsx:1091). This mirrors VS Code putting the Copilot icon at the right of the tab bar
- **KEEP** the collapse chevron `[<]` in the sidebar (needed — it collapses the whole multi-panel sidebar)
- **HIDE** the new file `+` button — reveal on hover over the project root or any folder row
- **KEEP** the file/git toggle `[📁][🌿]` but merge into the same row as workspace name: `app [📁][🌿] [🔍] [<]`
- **REPLACE** the persistent search input with a magnifying glass icon `[🔍]` that expands on click, or rely on Cmd+P
- **REMOVE** the "Other" section header — list root files directly, the folder/file distinction is clear enough without grouping

### 2. Merge redundant chat panel headers

**Current:** Tab bar ("PI Agent X") + header below ("PI Agent | New session dropdown | + button") = same info twice

**Fix:**
- Remove the second header entirely
- Integrate session dropdown into the tab bar line: `[PI Agent ▾] [+] [X]`
- The `+` and dropdown are redundant — merge into single dropdown that includes "New session" as an option

### 3. Merge redundant terminal headers

**Current:** Tab bar ("Shell") + session toolbar ("Shell 1 - d94a1cda | copy | + | Close")

**Fix:**
- Merge into single header: `[Terminal 1 ▾] [+] [X]`
- **REMOVE** the Copy button — users know Cmd+C in a terminal
- Simplify session names: "Terminal 1", "Terminal 2" not "Shell 1 - d94a1cda"

---

## P1 - Should Do

### 4. Hide action buttons behind hover

- **File tree**: rename, delete, new file — hover-revealed on the specific row, or right-click context menu only
- **Sidebar section actions**: `...` context menu — hover-only on section header
- **Terminal buttons**: copy, new, close — hover-only on terminal header area
- **Chat input accessories**: attachment icon, globe/brain toggle — reveal only when input is focused

### 5. Remove or soften panel borders

Current borders around every panel create a boxy, dated feel. Replace with:
- Subtle background color differences between zones
- Keep only the sidebar-to-editor border (thin, `1px solid var(--color-border)`)
- Remove border between editor and right panel — use whitespace
- Remove heavy border around terminal area — just use the tab/header bar as visual separator

### 6. Simplify editor sub-toolbar

The "Code | Diff" toggle + green checkmark creates a 3rd header row under file tabs.
- **HIDE** the Code/Diff toggle — Diff mode triggered by git actions or command palette, not a permanent toggle
- Checkmark (save status) can be a subtle dot indicator in the tab itself

### 7. Clean up user menu

- Reduce popover size — it's oversized for 4 items
- Fix contradictory state ("Signed in user" + "Not signed in. Retry" shown simultaneously)
- Remove "workspace: app" label if workspace name matches the project root folder already shown in the tree

---

## P2 - Nice to Have

### 8. Activity Bar (DEFERRED — evaluate later)

A VS Code-style thin vertical icon strip on the far left (Files/Git/Search/Agent) could further clean up the sidebar. But with the bot icon moved to the editor tab strip and file/git toggle kept as small icons, this may not be needed. Evaluate after P0/P1 changes land.

### 9. Command palette (Cmd+K)

Move 50% of visible buttons into a command palette:
- New file, new folder, new terminal, new chat session
- Toggle dark/light mode
- Switch workspace
- Open settings
- Git operations

### 10. Tone down chat input controls

The chat input (rendered by `@mariozechner/pi-web-ui` ChatPanel in Shadow DOM) has a bottom toolbar: `[📎] [🧠 Off ▾] claude-sonnet.. [▲ Send]`. All controls stay functional but need to be visually quieter.

**Controls are configurable** via `AgentInterface` properties (nativeAdapter.jsx line 76-78):
- `enableAttachments = true` → 📎 button
- `enableThinkingSelector = true` → 🧠 thinking toggle
- `enableModelSelector = true` → model dropdown

**Keep all enabled**, but via CSS overrides in the shadow DOM styles (nativeAdapter.jsx lines ~216-220):
- Reduce icon size to 14px, use `color: var(--muted-foreground)` (not primary)
- Model selector text: `font-size: 11px; opacity: 0.6` until hovered
- Send button: smaller, ghost style until input has text, then subtle accent
- Thinking toggle: smaller text, muted color
- Overall toolbar: reduce padding, tighter spacing, visually recede behind textarea

---

## Target layout

```
┌──────────────────────┬───────────────────────────────────────┬──────────────────────────┐
│ app  [📁][🌿] [🔍][<]│ README.md   pyproject.toml  X   [🤖] │ PI Agent ▾  [+]  X      │
│──────────────────────│───────────────────────────────────────│─────────────────────────│
│  📁 .venv            │                                       │                         │
│  📁 scripts          │                                       │   (chat messages)       │
│  📁 src              │     (editor content)                  │                         │
│  📄 pyproject.toml   │                                       │                         │
│  📄 README.md        │                                       │                         │
│┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│                                       │─────────────────────────│
│ DATA CATALOG    [+]  │                                       │ Message...              │
│  📊 users            │                                       │ 📎 🧠Off claude.. ▲    │
│  📊 orders           │───────────────────────────────────────│─────────────────────────│
│──────────────────────│ [Terminal 1 ▾]              [+] [X]   │                         │
│ 🟠 user@mail.com    │ $ npm run dev                                                   │
└──────────────────────┴─────────────────────────────────────────────────────────────────┘
                             🤖 = "open chat pane" button
                             (moved from sidebar to editor tab strip right edge)
                             chat input controls: all present but visually muted
```

## Files to modify
- `src/front/panels/FileTreePanel.jsx` (sidebar structure)
- `src/front/components/SidebarSectionHeader.jsx` (simplify LeftPaneHeader)
- `src/front/components/FileTree.jsx` (hover actions)
- `src/front/panels/ShellTerminalPanel.jsx` (merge headers)
- `src/front/panels/TerminalPanel.jsx` (merge headers)
- `src/front/panels/CompanionPanel.jsx` (merge chat headers)
- `src/front/providers/pi/PiSessionToolbar.jsx` (simplify)
- `src/front/providers/pi/nativeAdapter.jsx` (chat input CSS: mute toolbar controls)
- `src/front/App.jsx` (move bot icon to RightHeaderActions, brand simplification)
- `src/front/styles.css` (borders, hover states, layout)

## Design references
- **Zed**: Borderless, completely flat file tree, pure focus on text
- **Cursor**: Sleek AI chat input (Cmd+L), model as tiny badge, auto-expanding input
- **Linear**: Almost zero persistent buttons, everything via Cmd+K command palette
- **VS Code**: Activity Bar pattern for top-level view switching (Files/Git/Search/Extensions)

## Acceptance criteria
- Sidebar shows project name + file tree immediately (no 5-layer header stack)
- No redundant headers (chat, terminal)
- Action buttons hidden by default, revealed on hover
- Overall control count reduced by ~50%
- Feels calm and focused, not like a dashboard of buttons
