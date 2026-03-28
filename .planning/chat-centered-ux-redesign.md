# Chat-Centered UX Redesign for boring-ui

## Context

boring-ui currently has an IDE-first layout: left sidebar (file tree) | center (editor tabs) | right (agent chat). The goal is to flip this into a **chat-first agent interface** using the "Stage + Wings" layout — chat is always the center stage, with a browser/list wing on the left and a persistent artifact workbench on the right.

**Validated by**: Gemini 3.1 Pro (5 rounds), OpenAI o3. Both independently picked "Stage + Wings" from 12 candidates.

---

## Core Concepts

### Three Zones, Three Purposes

```
┌──────┐┌─ LEFT WING ──────┐┌──── CENTER STAGE ────┐┌── RIGHT WING ────────┐
│      ││                   ││                      ││                      │
│ NAV  ││  BROWSER / LIST   ││      CHAT            ││  ARTIFACT WORKBENCH  │
│ RAIL ││                   ││   (active session)   ││                      │
│      ││  File tree        ││                      ││  Editors             │
│ 48px ││  Git changes list ││   Always visible     ││  Diffs               │
│      ││  Data table list  ││   Locked, primary    ││  Terminal            │
│      ││  Search results   ││                      ││  Previews            │
│      ││  Session history  ││                      ││  Schema viewer       │
│      ││  Deck list        ││                      ││  Deck viewer         │
│      ││  Connector list   ││                      ││                      │
└──────┘└───────────────────┘└──────────────────────┘└──────────────────────┘
  pick     browse / list         conversation           view / edit
  WHAT     items of that type    with the agent          the selected item
```

| Zone | Role | Lifecycle | Interaction |
|------|------|-----------|-------------|
| **Nav rail** (48px) | Choose WHAT to browse | Permanent | Click icon → left wing switches |
| **Left wing** | Browse/list items | Switches with rail clicks. Session list is session-scoped. | Click item → opens in right wing |
| **Center stage** | Active chat session | Session-scoped (switches with session) | Type, read, click artifact links |
| **Right wing** | View/edit artifacts | **Persistent across sessions** — your desk | Tabs, splits, drag-and-drop (DockView) |

### Two Independent Workbenches

```
CHAT WORKBENCH                      ARTIFACT WORKBENCH
(left wing + center)                (right wing)
──────────────────                  ──────────────────
Session-scoped                      Persistent
Switches when you change session    Stays put across sessions
Contains: session list, chat        Contains: editors, diffs, terminal
Your conversations                  Your desk
```

**Switching sessions changes the chat. Your open files stay.**

---

## The Flow

### Nav Rail → Left Wing → Right Wing

```
NAV RAIL        LEFT WING (browser)         RIGHT WING (artifact)
click icon  →   list appears            →   click item  →  viewer opens

📁 Files    →   file tree                →   click file  →  editor tab
⎇  Git      →   changed files list       →   click file  →  diff tab
🔍 Search   →   search results           →   click result → editor tab
🗄 Data     →   table list (42k rows..)  →   click table  → schema/preview tab
💬 Sessions →   conversation history      →   click session → chat switches
🔗 Connect  →   connector list + status   →   click one    → settings/detail
📊 Decks    →   deck list                →   click deck   → deck viewer tab
```

### Chat → Right Wing

```
Chat action             →   RIGHT WING (artifact)

Agent edits file        →   diff tab auto-opens
Agent runs command      →   terminal output (inline or tab)
User clicks file link   →   editor tab opens
User clicks "Accept"    →   diff closes, editor stays
```

---

## Layout States

### State 0 — Default (chat only)
```
┌────┐┌──────────────────────────────────────────────────────┐
│    ││                                                      │
│    ││  [346px    ┌───────────────────────┐    346px]        │
│Rail││  margin    │     CHAT (700px)      │    margin        │
│    ││            │   max-width centered  │                  │
│    ││            └───────────────────────┘                  │
└────┘└──────────────────────────────────────────────────────┘
 48px                     1392px
```

### State 1 — Left wing open (clicked Files in rail)
Chat slides right slightly. Left margin absorbed.
```
┌────┐┌────────────────────┐┌────────────────────────────────────┐
│    ││ Explorer         🔍 ││                                    │
│    ││──────────────────  ││  ┌───────────────────────┐         │
│Rail││ ▼ src/             ││  │     CHAT (700px)      │         │
│    ││   auth.js          ││  │  no text reflow       │         │
│    ││   config.js        ││  └───────────────────────┘         │
│    ││ ▼ tests/           ││                                    │
└────┘└────────────────────┘└────────────────────────────────────┘
 48px    240px browser             700px chat + right margin
```

### State 2 — Left + right wing (clicked a file, or agent edited)
```
┌────┐┌────────────────────┐┌─────────────────┐┌────────────────┐
│    ││ Explorer         🔍 ││                 ││ auth.js    ✕   │
│    ││──────────────────  ││                 ││────────────────│
│Rail││ ▼ src/             ││  CHAT (480px)   ││  1│ import jwt │
│    ││   auth.js  ●       ││                 ││  2│ export ..  │
│    ││   config.js        ││  Agent: Fixed.  ││  3│ fn login() │
│    ││ ▼ tests/           ││                 ││                │
└────┘└────────────────────┘└─────────────────┘└────────────────┘
 48px    240px browser         480px chat         648px artifact
         (left wing)           (flex-shrink)      (right wing)
```

### State 3 — Right wing only (closed left, or agent opened file directly)
Chat slides left, right margin collapses. **No text reflow.**
```
┌────┐┌──────────────────────────┐┌──────────────────────────┐
│    ││32px┌───────────────────┐ ││ [auth.js] [config.js]    │
│    ││    │  CHAT (700px)     │ ││──────────────────────────│
│Rail││    │                   │ ││  1│ import jwt from ..   │
│    ││    │  no text reflow   │ ││  2│ export async fn ..   │
│    ││    │                   │ ││  3│ ...                  │
│    ││    └───────────────────┘ ││                          │
└────┘└──────────────────────────┘└──────────────────────────┘
 48px    32 + 700px chat + 12gap    648px artifact workbench
```

### State 4 — Session switch (right wing STAYS)
```
BEFORE (session: "Fix auth"):       AFTER (session: "Setup CI"):
┌────┐┌──────────┐┌───────┐┌─────┐ ┌────┐┌──────────┐┌───────┐┌─────┐
│    ││ Sessions  ││ CHAT  ││auth │ │    ││ Sessions  ││ CHAT  ││auth │
│Rail││           ││(auth) ││.js  │ │Rail││           ││ (CI)  ││.js  │
│    ││ ● auth  ◀ ││       ││     │ │    ││ ◐ auth    ││       ││     │
│    ││ ◐ CI     ││       ││     │ │    ││ ● CI   ◀  ││       ││     │
└────┘└──────────┘└───────┘└─────┘ └────┘└──────────┘└───────┘└─────┘
                   switches  STAYS                     switches  STAYS
```

---

## Pixel Math (1440px viewport)

| State | Rail | Left Wing | Gap | Chat | Gap | Right Wing | Total |
|-------|------|-----------|-----|------|-----|------------|-------|
| **0: Chat only** | 48 | — | — | 700 (centered in 1392) | — | — | 1440 |
| **1: Left wing** | 48 | 240 | 12 | 700 (shifted right) | — | — | 1440 |
| **2: Both wings** | 48 | 240 | 12 | 480 (flex-shrink) | 12 | 648 | 1440 |
| **3: Right wing** | 48 | — | — | 700 (shifted left, 32px margin) | 12 | 648 | 1440 |

Chat min-width: 400px. Text reflow only in state 2 (both wings). Auto-collapse left wing below 1280px viewport.

---

## Nav Rail UX Spec

### Layout (48px fixed, outside DockView)

```
┌──────────────────┐
│   [ ◈ ]          │  BRAND: workspace logo/initial
│                   │
│   [ + ]          │  PRIMARY: "New Chat Session"
│   ▀▀▀▀▀          │  Solid accent bg, tactile
│                   │  ── 16px gap ──
│  ┃[ 💬 ]          │  Sessions (chat history) → LEFT wing
│                   │  ── 16px gap ──
│   [ 📁 ]•        │  ┐
│   [ ⎇  ]³        │  │ WORKSPACE → LEFT wing (browser)
│   [ 🔍 ]          │  ┘            item click → RIGHT wing
│                   │  ── 16px gap ──
│   [ 🗄  ]          │  ┐
│   [ 🔗 ]•         │  │ CAPABILITIES → LEFT wing (browser)
│   [ 📊 ]          │  ┘               item click → RIGHT wing
│                   │
│   [ ⋯  ]          │  MORE: overflow for 10+ items
│                   │
│                   │  ── spacer ──
│   [ ⚙  ]          │  SYSTEM (bottom-pinned)
│   [ 👤 ]          │
└──────────────────┘
```

### 3-Level Progressive Disclosure

**Level 1 — Icons + state** (always, 48px): 40x40 touch, 20x20 icons, groups via 16px gaps
**Level 2 — Rich tooltips** (hover 150ms): `"Git · 3 uncommitted changes"` — show state, not just label
**Level 3 — Flyout popover** (click items with sub-items): 240px panel for Connectors, Skills

### State Indicators

- **Active pill** (3px left edge, 16px tall): this browser is showing in left wing
- **Badge** (14px circle, top-right): actionable count
- **Pulse dot** (6px, animated): agent actively doing something

### Micro-Interactions

- Hover: `rgba(255,255,255, 0.08)` bg, icon `1.08x` scale
- Press: `0.95x` scale
- Curve: `cubic-bezier(0.25, 1, 0.5, 1)`
- Tooltip: 150ms delay, 0.15s fade
- Badge bounce: 0.3s spring

### Scaling

- Pinned items only (default 5-6), `[⋯]` More → searchable palette
- Right-click pin/unpin, drag to reorder

---

## Session Model

```
┌────────────────────────────┐
│ Sessions               [+] │
│────────────────────────────│
│ Today                      │
│  ● Fix auth bug        2m  │  ● = active (showing in center)
│  ◐ Setup CI pipeline   ⏸  │  ◐ = paused (has context, agent may be working)
│  ○ Review PR #42      1h  │  ○ = idle/complete
│                            │
│ Yesterday                  │
│  ○ Refactor API       18h  │
│  ○ Debug deploy       22h  │
└────────────────────────────┘
```

- Click session → center chat switches, left wing stays on sessions
- `[+]` starts new session
- Badge on `◐` if agent finished something while you were away
- Right wing (artifact workbench) does NOT change on session switch
- Session list grouped by time (Today, Yesterday, This week...)

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+0` | Toggle both wings |
| `Cmd+1` | Toggle left wing |
| `Cmd+2` | Toggle right wing |
| `Esc` | Return focus to chat |
| `Cmd+Shift+Enter` | Open artifact in right wing |
| `Cmd+P` | Quick file search |
| `Cmd+N` | New chat session |

---

## Transitions

| Transition | Animation | Duration |
|------------|-----------|----------|
| Wing slides in/out | `translateX` + width | 240ms `cubic-bezier(.35,.14,.32,1)` |
| Chat translates | `translateX` (margins collapse) | 240ms synced |
| Chat flex-shrink | Width change (state 1→2 only) | 240ms synced |
| Left wing content switch | Crossfade | 150ms |
| Session switch | Chat: crossfade, Right wing: no change | 200ms |

---

## Phase Plan

### Phase 1: Chat as Center Stage + Max-Width

**Files**: `App.jsx`, `registry/panes.jsx`, `layout/LayoutManager.js`, `EmptyPanel.jsx`, `styles.css`

1. `agent` pane: `placement: 'center'`, `essential: true`, `locked: true`
2. `ensureCorePanels()`: create `agent` as center (not `empty-center`)
3. `max-width: 700px` + `margin: 0 auto` on chat message container
4. Bump `LAYOUT_VERSION` 22 → 23 with migration

### Phase 2: Nav Rail + Left Wing (Browser)

**Files**: new `registry/navRail.js`, new `components/NavRail.jsx`, new `components/LeftWingBrowser.jsx`, `App.jsx`, `styles.css`

1. `NavRailRegistry` with items pointing to browser components
2. `NavRail.jsx` outside DockView, fixed 48px left
3. Left wing as single DockView group — content switches based on active rail item
4. Extract file tree, git changes, data catalog, search into browser components
5. Each browser's item click → opens pane in RIGHT wing
6. 3-level disclosure + state indicators + micro-interactions
7. Remove old `FileTreePanel` / `DataCatalogPanel` / `CollapsedSidebarActivityBar`
8. Pin/unpin + overflow

### Phase 3: Right Wing (Artifact Workbench)

**Files**: `usePanelActions.js`, `App.jsx`, `styles.css`

1. Right wing as DockView group — persistent, tabs/splits
2. `openFile()` → opens editor in right wing
3. Chat tool-use file links → open in right wing
4. Agent edits → auto-open diff in right wing
5. Wing collapse/expand with 240ms transitions
6. Chat translate (not resize) in single-wing states
7. Keyboard shortcuts: `Cmd+0/1/2`, `Esc`

### Phase 4: Session Model

**Files**: new session store, `components/SessionList.jsx`, `AgentPanel.jsx`

1. Session list as left wing browser (nav rail 💬 icon)
2. Session switching: center chat swaps, right wing stays
3. `●` active / `◐` paused / `○` idle states
4. `[+]` new session, `Cmd+N` shortcut
5. Badge on paused sessions when agent completes work

### Phase 5: Multi-File + Diff UX

**Files**: chat renderers, `providers/pi/defaultTools.js`

1. Single file edit → auto-open diff in right wing
2. Multi-file edit → summary block in chat + [Accept All] [Reject All]
3. Click file in summary → opens diff in right wing
4. Inline Accept/Reject per hunk

### Phase 6: Terminal + Context (later)

1. Terminal as pane in right wing
2. `@filename` context attachment in chat input
3. Drag-and-drop files into chat

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout | Stage + Wings | Validated by Gemini + o3 from 12 candidates |
| Left wing = browser | List/browse items | Nav rail picks WHAT, left wing shows the LIST, right wing shows the ITEM |
| Right wing = workbench | Persistent artifact viewer | Your desk. Doesn't change on session switch. |
| Two workbenches | Chat (session-scoped) + Artifact (persistent) | Conversations come and go, your desk stays |
| Chat max-width | 700px centered | Margins absorb. Reflow only when both wings open. |
| Nav rail routing | All items → left wing browser | Click item in browser → right wing |
| Session model | Switch, don't split | One active chat, fast switching. No multi-pane chat. |
| Everything is a pane | Yes | DockView handles it all. No special concepts. |

---

## Critical Files

**Phase 1**: `App.jsx`, `registry/panes.jsx`, `layout/LayoutManager.js`, `styles.css`
**Phase 2**: NEW `registry/navRail.js`, NEW `components/NavRail.jsx`, NEW `components/LeftWingBrowser.jsx`, `App.jsx`
**Phase 3**: `hooks/usePanelActions.js`, `App.jsx`, `styles.css`
**Phase 4**: NEW session store, NEW `components/SessionList.jsx`
**Phase 5**: Chat renderers, `providers/pi/defaultTools.js`

---

## Verification

1. Open app → chat centered (700px, margins), nav rail (48px), no wings
2. Click 📁 → left wing shows file tree, chat shifts right (no reflow)
3. Click file in tree → editor opens in RIGHT wing
4. Click ⎇ → left wing switches to git list (right wing untouched)
5. Click changed file → diff opens as tab in right wing
6. Agent edits file → diff auto-opens in right wing, pulse dot on 📁
7. Click 💬 → left wing shows session list
8. Switch session → chat changes, right wing stays (files still open)
9. `Cmd+0` closes both wings → chat re-centers
10. `Cmd+2` reopens right wing → your tabs are still there
11. Close left wing → chat 700px, right wing 648px (no reflow)
12. Both wings open → chat shrinks to 480px
13. Layout persists across refresh

---

## Gemini + o3 Feedback Log

**Round 1** (Gemini): Dropped layout mode toggle, everything-is-a-pane, missing terminal/context/diffs
**Round 2** (Gemini): Kill slide-over, one concept (DockView panes), max-width trick
**Round 3** (Gemini): Nav rail 3-level disclosure, state indicators, pin/unpin scaling
**Round 4** (Gemini): Spatial tension → "click left, appear left" rule
**Round 5** (Gemini + o3): 12 layout candidates → both picked Stage + Wings. Pixel math, transitions, keyboard shortcuts.
**Round 6**: Two-workbench model (chat=session-scoped, artifacts=persistent). Nav rail → left browser → right workbench flow.
