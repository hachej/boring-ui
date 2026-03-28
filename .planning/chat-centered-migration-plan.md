# Migration Plan: boring-ui → Stage + Wings (The Surface)

**POC reference**: `poc-stage-wings/` — validated design at http://100.68.199.114:5175/
**Design doc**: `.planning/chat-centered-ux-redesign.md`

---

## Summary

Transform boring-ui from IDE-first (file tree | editor | agent) to chat-first (nav rail | chat | Surface). 6 phases, each independently shippable.

```
BEFORE: [FileTree 280px] [Editor tabs center] [Agent chat right]
AFTER:  [NavRail 48px] [Chat centered] [Surface (floating island, collapsible)]
```

---

## Phase 1: Chat as Center Stage

**Goal**: Agent panel becomes the center, essential, locked. Chat messages get max-width. Surface hidden by default.

**Files to modify**:
| File | Change |
|------|--------|
| `src/front/registry/panes.jsx` | `agent`: placement `'center'`, `essential: true`, `locked: true` |
| `src/front/registry/panes.jsx` | Remove `empty` pane registration |
| `src/front/registry/panes.jsx` | `editor`: placement `'right'` |
| `src/front/registry/panes.jsx` | `review`: placement `'right'` |
| `src/front/App.jsx` | `ensureCorePanels()`: create `agent` as center (not `empty-center`) |
| `src/front/App.jsx` | Remove separate startup chat-opening logic (~lines 2421-2470) |
| `src/front/layout/LayoutManager.js` | Bump `LAYOUT_VERSION` 22 → 23, add migration |
| `src/front/styles.css` | Add `.chat-stage { max-width: 680px; margin: 0 auto }` |
| `src/front/styles.css` | Add pill-shaped input, centered, with ⌘K kbd hints |
| `src/front/providers/pi/nativeAdapter.jsx` | Wrap in max-width container |
| `src/front/providers/pi/backendAdapter.jsx` | Wrap in max-width container |
| `src/front/components/chat/AiChat.jsx` | Wrap in max-width container |

**Files to remove**:
| File | Why |
|------|-----|
| `src/front/panels/EmptyPanel.jsx` | Chat is always visible now |

**Verification**:
- Open app → chat centered with max-width, no file tree, no right panel
- Chat input centered with pill shape
- Agent panel can't be closed or tabbed behind

---

## Phase 2: Nav Rail (Icon Strip + Expandable Panel)

**Goal**: Replace the left sidebar with a 48px icon strip + expandable panel for session history.

**Files to create**:
| File | Purpose |
|------|---------|
| `src/front/components/NavRail.jsx` | 48px icon strip: B, +New, 🕐History, ⚙, 👤 |
| `src/front/components/LeftPanel.jsx` | Expandable 220px panel (slides out from icon strip) |
| `src/front/components/SessionList.jsx` | Session history grouped by date, status dots |
| `src/front/hooks/useSessionState.js` | Global session state (Zustand store) |

**Files to modify**:
| File | Change |
|------|--------|
| `src/front/App.jsx` | Render `NavRail` outside DockView, fixed left |
| `src/front/App.jsx` | Remove DockView left sidebar group entirely |
| `src/front/App.jsx` | Wire session switching to global state |
| `src/front/components/UserMenu.jsx` | Detach from FileTreePanel, move to NavRail bottom |
| `src/front/providers/pi/PiSessionToolbar.jsx` | Rewire to `useSessionState()` |
| `src/front/styles.css` | Nav rail styles from POC (icon buttons, active pill, tooltips) |

**Files to archive** (keep for reference, remove from active):
| File | Why |
|------|-----|
| `src/front/panels/FileTreePanel.jsx` | Replaced by NavRail + LeftPanel + Surface explorer |
| `src/front/panels/DataCatalogPanel.jsx` | Replaced by Surface explorer |
| `src/front/components/SidebarSectionHeader.jsx` | `LeftPaneHeader` + `CollapsedSidebarActivityBar` no longer needed |
| `src/front/hooks/useResponsiveSidebarCollapse.js` | Sidebar gone; Surface has its own collapse |

**Verification**:
- 48px icon strip on left, collapsed by default
- Click 🕐 → history panel slides out with sessions grouped by date
- Click session → chat switches
- Click 🕐 again → panel collapses
- ⌘K opens command palette (or placeholder)

---

## Phase 3: The Surface (Right-Side Artifact Display)

**Goal**: Floating island on the right that shows artifacts. Explorer sidebar + viewer. Hidden until first artifact.

**Files to create**:
| File | Purpose |
|------|---------|
| `src/front/components/Surface.jsx` | Floating island container (explorer + viewer) |
| `src/front/components/SurfaceExplorer.jsx` | Artifact browser sidebar (grouped by category) |
| `src/front/components/SurfaceViewer.jsx` | Active artifact display (polymorphic) |
| `src/front/components/SurfaceTopBar.jsx` | Explorer toggle + tabs + close |
| `src/front/registry/artifacts.js` | Artifact type → React component mapping |
| `src/front/hooks/useArtifactState.js` | Global artifact state (open, active, per-session) |

**Files to modify**:
| File | Change |
|------|--------|
| `src/front/App.jsx` | Render Surface outside DockView (or as single right DockView group) |
| `src/front/App.jsx` | Surface hidden when no artifacts open |
| `src/front/hooks/usePanelActions.js` | `openFile()` → opens in Surface viewer (not center editor tabs) |
| `src/front/styles.css` | Surface island styles from POC (backdrop blur, rounded corners, shadow, animation) |
| `src/front/styles.css` | Floating scrollbars, scroll masks |

**Key decisions**:
- Surface is rendered outside DockView OR as a managed DockView group on the right
- Explorer sidebar: collapsed by default, toggle via 📂 button
- Viewer: polymorphic renderer based on artifact type
- Tabs: pill-style, not IDE tabs
- Artifacts persist across session switches (right wing independent of chat)

**Verification**:
- No Surface visible on fresh load
- Click artifact link in chat → Surface slides in with the artifact
- Toggle explorer sidebar → browse all session artifacts
- Close all artifacts → Surface disappears
- Resize Surface via drag handle
- ⌘2 toggles Surface

---

## Phase 4: Artifact Links in Chat

**Goal**: Agent tool-use outputs become clickable artifact cards that open in the Surface.

**Files to modify**:
| File | Change |
|------|--------|
| `src/front/components/chat/toolRenderers.jsx` | Add artifact card rendering for write/edit/read tool outputs |
| `src/front/components/chat/ToolUseBlock.jsx` | Wrap tool outputs with clickable artifact cards |
| `src/front/components/chat/MessageList.jsx` | Wire artifact card clicks to `useArtifactState().open(id)` |

**Files to create**:
| File | Purpose |
|------|---------|
| `src/front/components/chat/ArtifactCard.jsx` | Clickable card in chat (icon + title + type + chevron) |

**Design from POC**:
- Cards have gradient background, subtle shadow, icon with color
- Active artifact card highlighted (accent border + glow)
- Chevron affordance on the right
- Avatar icons for user/agent messages

**Verification**:
- Agent edits a file → artifact card appears in chat
- Click card → Surface opens showing the file/diff
- Active card highlighted while viewing in Surface
- Multiple artifacts → each clickable independently

---

## Phase 5: Agent Auto-Open + Diff UX

**Goal**: Agent edits auto-open diffs. Multi-file edits show summary blocks.

**Files to modify**:
| File | Change |
|------|--------|
| `src/front/providers/pi/defaultTools.js` | After write/edit completion → auto-open artifact in Surface |
| `src/front/components/chat/toolRenderers.jsx` | Multi-file edits: summary block with file list + Accept All / Reject All |
| `src/front/components/GitDiff.jsx` | Add inline Accept/Reject per hunk |

**Files to create**:
| File | Purpose |
|------|---------|
| `src/front/components/chat/MultiFileBlock.jsx` | Summary card for multi-file edits |
| `src/front/components/artifacts/DiffArtifact.jsx` | Diff viewer with accept/reject in Surface |

**Behavior**:
- Single file edit → auto-open diff in Surface
- Multiple files → summary block in chat, click file → opens in Surface
- Accept → diff closes, chat shows ✓
- Reject → reverts change
- Chat retains focus during auto-open

**Verification**:
- Agent edits auth.js → Surface opens with diff automatically
- Agent edits 5 files → summary block with Accept All / Reject All
- Click individual file in summary → diff opens in Surface

---

## Phase 6: Artifact Types (Charts, Tables, Docs)

**Goal**: Surface renders not just code but charts, tables, documents, images.

**Files to create**:
| File | Purpose |
|------|---------|
| `src/front/components/artifacts/ChartArtifact.jsx` | Chart renderer (bar, line, pie) |
| `src/front/components/artifacts/TableArtifact.jsx` | Interactive data table |
| `src/front/components/artifacts/DocumentArtifact.jsx` | PDF/markdown document viewer |
| `src/front/components/artifacts/ImageArtifact.jsx` | Image viewer |
| `src/front/components/artifacts/CodeArtifact.jsx` | Code viewer (wraps existing EditorPanel) |

**Files to modify**:
| File | Change |
|------|--------|
| `src/front/registry/artifacts.js` | Register type → component mappings |
| `src/front/components/SurfaceViewer.jsx` | Use registry to polymorphically render artifacts |

**Verification**:
- Agent creates chart → chart renders in Surface
- Agent queries database → table renders in Surface
- Agent finds PDF → document renders in Surface
- Switch between artifact types via tabs

---

## CSS Migration Strategy

### From POC to boring-ui
The POC's `index.css` contains the complete design language. Migration approach:

1. **Keep** boring-ui's existing CSS variable system but update values to match POC
2. **Add** new variables: `--bg-canvas`, `--bg-surface`, `--bg-elevated`, `--border-subtle`, `--border-hover`
3. **Add** new classes: `.nav-rail`, `.left-panel`, `.surface`, `.sf-*`, `.chat-stage`
4. **Remove** old classes: `.filetree-panel`, `.datacatalog-panel`, `.sidebar-activity-bar`, `.left-pane-header`
5. **Keep** existing component styles (CodeEditor, GitDiff, etc.) — they work inside the Surface

### Key CSS values from POC:
```css
--bg-canvas: #0a0a0a;
--bg-surface: #111113 (or rgba(17,17,19,.85) with backdrop-filter);
--bg-elevated: #151518;
--border-subtle: rgba(255,255,255,0.06);
--radius-xl: 16px; /* Surface island */
--chat-max-width: 680px;

/* Surface island */
backdrop-filter: blur(16px);
border-radius: 16px;
box-shadow: 0 24px 48px -12px rgba(0,0,0,.75), inset 0 1px 0 rgba(255,255,255,.08);
animation: 0.4s cubic-bezier(0.16,1,0.3,1);

/* Chat input */
border-radius: 24px; /* pill */
box-shadow: 0 2px 6px rgba(0,0,0,0.2);

/* Send button */
background: var(--text-primary); /* white on dark */
border-radius: 16px; /* circle */
```

---

## DockView Strategy

### Option A: Minimal DockView (recommended for Phase 1-3)
- DockView manages only the center (chat) and right (Surface) groups
- Nav rail + left panel are pure React components outside DockView
- Surface is a single DockView group with tabs
- Simpler, fewer DockView edge cases

### Option B: Full DockView
- Nav rail outside, everything else in DockView
- Left panel is a DockView group (locked, collapsible)
- Center chat is a DockView group (locked, essential)
- Right Surface is a DockView group (tabs, splits)
- More DockView features (drag-and-drop) but more complexity

**Recommendation**: Start with Option A. Migrate to B later if power users want drag-and-drop between Surface panes.

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Layout migration breaks existing users | LAYOUT_VERSION bump with migration; fallback to fresh layout |
| Chat max-width causes text reflow issues | Use `max-width` on message container, not flex-basis |
| Surface animation performance | Use `transform` + `opacity` only (GPU composited) |
| Session state conflicts with PI backend | Keep PI session logic; add UI-layer session switching on top |
| Large CSS refactor breaks existing styles | Additive approach: add new classes, don't delete old ones until phase complete |
| DockView group changes break persistence | Clear saved layout on version bump; users get fresh layout |

---

## Effort Estimate

| Phase | Description | New Files | Modified | Removed | Effort |
|-------|-------------|-----------|----------|---------|--------|
| 1 | Chat as Center Stage | 0 | 8 | 1 | 1-2 days |
| 2 | Nav Rail + Left Panel | 4 | 6 | 4 (archived) | 2-3 days |
| 3 | The Surface | 6 | 5 | 0 | 3-4 days |
| 4 | Artifact Links in Chat | 1 | 3 | 0 | 1-2 days |
| 5 | Auto-Open + Diff UX | 2 | 3 | 0 | 2-3 days |
| 6 | Artifact Types | 5 | 2 | 0 | 2-3 days |
| **Total** | | **18** | **27** | **5** | **~12-17 days** |

---

## File Inventory

### CREATE (18 files)
```
src/front/components/NavRail.jsx
src/front/components/LeftPanel.jsx
src/front/components/SessionList.jsx
src/front/components/Surface.jsx
src/front/components/SurfaceExplorer.jsx
src/front/components/SurfaceViewer.jsx
src/front/components/SurfaceTopBar.jsx
src/front/components/chat/ArtifactCard.jsx
src/front/components/chat/MultiFileBlock.jsx
src/front/components/artifacts/ChartArtifact.jsx
src/front/components/artifacts/TableArtifact.jsx
src/front/components/artifacts/DocumentArtifact.jsx
src/front/components/artifacts/ImageArtifact.jsx
src/front/components/artifacts/CodeArtifact.jsx
src/front/components/artifacts/DiffArtifact.jsx
src/front/registry/artifacts.js
src/front/hooks/useSessionState.js
src/front/hooks/useArtifactState.js
```

### MODIFY (27 files)
```
src/front/App.jsx
src/front/styles.css
src/front/registry/panes.jsx
src/front/layout/LayoutManager.js
src/front/hooks/useDockLayout.js
src/front/hooks/usePanelActions.js
src/front/hooks/useKeyboardShortcuts.js
src/front/panels/AgentPanel.jsx
src/front/panels/EditorPanel.jsx
src/front/panels/ReviewPanel.jsx
src/front/panels/FileTreePanel.jsx (extract tree core)
src/front/panels/DataCatalogPanel.jsx (extract list core)
src/front/components/UserMenu.jsx
src/front/components/FileTree.jsx
src/front/components/GitChangesView.jsx
src/front/components/chat/AiChat.jsx
src/front/components/chat/ClaudeStreamChat.jsx
src/front/components/chat/MessageList.jsx
src/front/components/chat/ToolUseBlock.jsx
src/front/components/chat/toolRenderers.jsx
src/front/providers/pi/nativeAdapter.jsx
src/front/providers/pi/backendAdapter.jsx
src/front/providers/pi/PiSessionToolbar.jsx
src/front/providers/pi/sessionBus.js
src/front/providers/pi/defaultTools.js
src/front/components/GitDiff.jsx
src/front/config/appConfig.js (or equivalent)
```

### REMOVE/ARCHIVE (5 files)
```
src/front/panels/EmptyPanel.jsx
src/front/components/SidebarSectionHeader.jsx
src/front/hooks/useResponsiveSidebarCollapse.js
src/front/components/SyncStatusFooter.jsx (if it exists)
```
