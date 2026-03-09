# UI Polish: Icon Consistency & Coverage

**Priority:** MEDIUM
**Component:** All icons across UI
**Screenshots:** All 23 screenshots
**Source:** Gemini 3.1 Pro: "icons are used inconsistently; some actions lack icons entirely"

## Problem
- User menu action items (Switch workspace, Create workspace, User settings, Logout) have no icons - plain text only
- Settings section headers have no icons (Profile, Appearance, Account, General, Runtime, etc.)
- Chat Send button has no icon (just text "Send" or arrow character)
- Some areas use different icon sizes inconsistently (12px, 14px, 16px without clear hierarchy)
- Chevron usage inconsistent: `ChevronRight`/`ChevronDown` for expand/collapse but also `ChevronLeft` for back navigation mixed with `ArrowLeft`

## Current Icon Inventory (Lucide React)
30 unique icons across 25 files:
- **Navigation**: ArrowLeft, ChevronDown, ChevronUp, ChevronRight, ChevronLeft
- **Actions**: Plus, X, Copy, Search, Check, MoreHorizontal
- **State**: Loader2, AlertCircle
- **Theme**: Sun, Moon
- **Content**: Brain, Sparkles, Bot, Globe, Terminal, Pencil, PenLine, BookOpen, Settings, Image, FileText
- **Editor toolbar**: Bold, Italic, Underline, Strikethrough, List, ListOrdered, ListChecks, Quote, Code, Link, Minus, Highlighter, Table, Image
- **File tree**: Folder, FolderOpen, FolderInput, GitBranch, File + 13 File* variants

## Fix

### 1. Add icons to User Menu items
```jsx
import { ArrowLeftRight, Plus, Settings, LogOut } from 'lucide-react'

const actionItems = [
  { key: 'switch', label: 'Switch workspace', icon: ArrowLeftRight, ... },
  { key: 'create', label: 'Create workspace', icon: Plus, ... },
  { key: 'settings', label: 'User settings', icon: Settings, ... },
  { key: 'logout', label: 'Logout', icon: LogOut, ... },
]
// Render: <item.icon size={14} /> <span>{item.label}</span>
```

### 2. Add icons to Settings section headers
```jsx
import { User, Palette, Shield, Cog, Activity, Lock, AlertTriangle } from 'lucide-react'

// UserSettingsPage sections:
// Profile -> User
// Appearance -> Palette
// Account -> Shield

// WorkspaceSettingsPage sections:
// General -> Cog
// Runtime -> Activity
// Configuration -> Lock
// Danger Zone -> AlertTriangle
```

### 3. Standardize icon sizes
- **16px**: Section headers, primary navigation actions
- **14px**: Menu items, inline actions, toolbar buttons
- **12px**: File tree items, badges, status indicators

### 4. Normalize chevron vs arrow usage
- **ChevronRight/Down**: Expand/collapse (tree nodes, collapsibles, dropdowns)
- **ArrowLeft**: Back navigation (PageShell back button - already correct)
- Remove `ChevronLeft` from `SidebarSectionHeader.jsx` (used for sidebar collapse) - use a dedicated `PanelLeftClose`/`PanelLeftOpen` instead

### 5. Chat Send button icon
- Use `SendHorizonal` (Lucide) or `ArrowUp` for Send button
- Pairs with accent color background when input has text (see bead 01b)

## Files to modify
- `src/front/components/UserMenu.jsx` (add icons to menu items)
- `src/front/pages/UserSettingsPage.jsx` (section header icons)
- `src/front/pages/WorkspaceSettingsPage.jsx` (section header icons)
- `src/front/pages/PageShell.jsx` (SettingsSection icon prop)
- `src/front/components/SidebarSectionHeader.jsx` (chevron cleanup)
- `src/front/providers/pi/nativeAdapter.jsx` (Send button icon)

## Acceptance criteria
- All user menu items have contextual icons
- Settings sections have header icons
- Icon sizes follow 12/14/16px hierarchy consistently
- Chevrons vs arrows used correctly by context
- Send button has an icon
