# @hachej/boring-ui-kit

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm](https://img.shields.io/npm/v/@hachej/boring-ui-kit.svg)](https://www.npmjs.com/package/@hachej/boring-ui-kit)

</div>

Shared shadcn-style UI primitives for boring-ui packages and plugins. Buttons, dialogs, panes, inputs, feedback states, settings panels — everything a panel needs to look consistent. Zero global CSS dependencies.

```bash
pnpm add @hachej/boring-ui-kit
```

---

## TL;DR

**The Problem**: Building panel-based plugins means re-implementing basic UI — buttons, dialogs, form fields, loading states, empty states — over and over. Without a shared design system, every panel looks different and maintenance is a nightmare.

**The Solution**: `@hachej/boring-ui-kit` provides ~40 reusable components designed for IDE-style surfaces (panes, toolbars, sidebars). No global CSS — styles inherit from the host app's CSS variables. Drop it in any boring-ui plugin or app and panels look native from day one.

### Why Use @hachej/boring-ui-kit?

| Feature | What It Does |
|---------|--------------|
| **Pane primitives** | `Pane`, `PaneHeader`, `PaneBody`, `PaneToolbar`, `FloatingPanel` — built for Dockview panels |
| **~40 components** | Buttons, inputs, dialogs, tooltips, badges, spinners, empty states, settings panels, and more |
| **Zero global CSS** | Styles use CSS custom properties from the host; no conflicting style sheets |
| **shadcn-style** | Composable, headless-compatible, restylable via `className` / `class-variance-authority` |
| **TypeScript-first** | Every component is typed; props are explicit; no implicit `any` |
| **Works anywhere** | Plugin panels, standalone apps, component fixtures — no framework lock-in |

---

## Quick Example

```tsx
import {
  Pane, PaneHeader, PaneBody,
  Button, ButtonGroup,
  EmptyState, Spinner,
  Input, Field, FieldLabel
} from "@hachej/boring-ui-kit"

export function SearchPane() {
  return (
    <Pane>
      <PaneHeader>Search</PaneHeader>
      <PaneBody>
        <Field>
          <FieldLabel>Query</FieldLabel>
          <Input placeholder="Search files…" />
        </Field>
        <EmptyState
          title="No results"
          description="Try a different search term"
          icon="search"
        />
        <ButtonGroup>
          <Button variant="secondary">Cancel</Button>
          <Button>Search</Button>
        </ButtonGroup>
      </PaneBody>
    </Pane>
  )
}
```

---

## Installation

```bash
# pnpm
pnpm add @hachej/boring-ui-kit

# npm
npm install @hachej/boring-ui-kit

# from source
git clone https://github.com/hachej/boring-ui.git
cd boring-ui && pnpm install
pnpm --filter @hachej/boring-ui-kit build
```

---

## Architecture

`@hachej/boring-ui-kit` is the shared design system at the bottom of every boring-ui package:

```
┌──────────────────────────────────────────┐
│  @hachej/boring-workspace                │
│  (Dockview chrome, panels, plugins)      │
├──────────────────────────────────────────┤
│  @hachej/boring-ui-kit ◄── YOU ARE HERE   │
│                                          │
│  ┌────────┐ ┌────────┐ ┌────────┐        │
│  │ Layout │ │ Form   │ │Overlay │        │
│  │Pane, … │ │Input, …│ │Dialog, │        │
│  └────────┘ └────────┘ └────────┘        │
│                                          │
│  Styled by CSS vars from host:            │
│  – @boring-core/theme.css                 │
│  – @boring-workspace/globals.css          │
│  (or your own --boring-* vars)            │
└──────────────────────────────────────────┘
```

The kit imports **no global CSS**. Styles come from CSS custom properties set by the host app. In a full app, you import the workspace globals once:

```ts
// In your app shell (once)
import "@hachej/boring-workspace/globals.css"
```

Then every UI kit component picks up those variables automatically.

### Styling Contract

Override any CSS variable at any scope:

```css
/* Use :root for normal React apps, :host for Shadow DOM.
   Token values are color/length primitives, not CSS shorthands.
   The canonical defaults ship in @hachej/boring-ui-kit/tokens.css. */
:root {
  --boring-background: oklch(0.18 0.004 72);
  --boring-foreground: oklch(0.985 0.002 72);
  --boring-border: oklch(0.269 0.006 285.885);
  --boring-radius: 0.625rem;
  /* ... full token set in tokens.css; see styles.css for the utility mapping */
}
```

### Theming

Import the default palette, then override individual `--boring-*` variables:

```css
@import "@hachej/boring-ui-kit/tokens.css";

.my-green-panel {
  --boring-primary: oklch(0.72 0.19 150);
  --boring-accent: oklch(0.72 0.19 150);
}
```

The kit uses class-variance-authority (CVA) for consistent variant patterns:

```tsx
<Button variant="destructive" size="sm">Delete</Button>
{/* variants: default | destructive | secondary | ghost */}
{/* sizes: sm | md | lg */}
```

---

## Component Index

### Layout & Surfaces

| Component | Purpose |
|-----------|---------|
| `Pane` | Container for panel surfaces (bordered, rounded, sized for Dockview) |
| `PaneHeader` | Title bar for panes (title + optional actions) |
| `PaneBody` | Scrollable content area with proper padding |
| `PaneToolbar` | Horizontal toolbar for panes (actions, filters, etc.) |
| `FloatingPanel` | Overlay panel (popovers, contextual menus, inline editors) |

### Actions

| Component | Purpose |
|-----------|---------|
| `Button` | Primary action button with variant + size props |
| `IconButton` | Icon-only button (tooltips built in) |
| `ButtonGroup` | Grouped buttons with merged borders |
| `Toolbar` | Horizontal container for toolbar buttons |
| `ToolbarButton` | Icon button for toolbar context |

### Forms

| Component | Purpose |
|-----------|---------|
| `Input` | Text input with validation states |
| `Textarea` | Multi-line text input |
| `Select` | Dropdown selection (Radix-backed) |
| `Field` | Form field wrapper (label + input + error) |
| `FieldLabel` | Accessible form label |
| `InputGroup` | Input with prepended/appended elements |

### Feedback

| Component | Purpose |
|-----------|---------|
| `Notice` | Banner alerts (info, warning, error, success) |
| `EmptyState` | Placeholder for empty content areas |
| `ErrorState` | Error display with retry action |
| `Spinner` | Loading indicator |
| `Skeleton` | Loading placeholder shapes |
| `StatusBadge` | Colored status indicators |
| `toast` | Programmatic toast notifications |

### Display

| Component | Purpose |
|-----------|---------|
| `Badge` | Small inline labels |
| `Chip` | Selectable/removable tags |
| `InlineCode` | Monospaced inline text |
| `Kbd` | Keyboard shortcut display |
| `Avatar` | User/profile image with fallback |
| `List` | Vertical list with row actions |
| `DetailList` | Key-value display (label + value pairs) |

### Overlays

| Component | Purpose |
|-----------|---------|
| `Dialog` | Modal dialog with title, body, footer |
| `DropdownMenu` | Context menu (Radix `@radix-ui/react-dropdown-menu`) |
| `Tooltip` | Hover tooltips (Radix `@radix-ui/react-tooltip`) |
| `HoverCard` | Hover-reveal cards |
| `Tabs` | Tabbed navigation (Radix `@radix-ui/react-tabs`) |
| `Command` | Command palette input (cmdk-based) |

### Settings

| Component | Purpose |
|-----------|---------|
| `SettingsPanel` | Full-page settings layout |
| `SettingsNav` | Vertical navigation for settings sections |
| `SettingsActionRow` | Row with label, description, and action control |

---

## How @hachej/boring-ui-kit Compares

| Feature | @hachej/boring-ui-kit | shadcn/ui | Radix UI | @mui/material |
|---------|------------------------|-----------|----------|---------------|
| IDE-optimized primitives | ✅ `Pane`, `PaneHeader`, `PaneToolbar` | ❌ None | ❌ None | ❌ None |
| Zero global CSS | ✅ Host-inherited | ⚠️ Tailwind classes | ✅ Headless | ❌ CSS-in-JS |
| Ready-made components | ✅ ~40, opinionated | ⚠️ Copy-paste source | ❌ Headless only | ✅ 100+ |
| Plugin-safe bundle | ✅ Tree-shaked, small | ⚠️ You pick files | ⚠️ Many packages | ❌ Heavy |
| Settings panels | ✅ `SettingsPanel`, `SettingsNav` | ❌ DIY | ❌ DIY | ❌ DIY |
| Command palette | ✅ `Command` (cmdk) | ⚠️ Copy-paste | ❌ DIY | ❌ DIY |

**When to use @hachej/boring-ui-kit:**
- Building plugin panels for boring-ui workspace apps
- You want consistent, IDE-style UI without a heavy material library
- You need pane-specific primitives (`Pane`, `PaneToolbar`)

**When it might not fit:**
- You need a full design system with charts, maps, and data grids (use MUI)
- You want complete source-level customization (use shadcn/ui directly)
- You're building a consumer-facing marketing site (use Tailwind components)

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| Unstyled components | No utility CSS loaded | Import `@hachej/boring-ui-kit/styles.css` once (it ships the Tailwind utilities the kit needs); a full workspace app already loads `@hachej/boring-workspace/globals.css` |
| Wrong/missing colors | `--boring-*` tokens not set | Import `@hachej/boring-ui-kit/tokens.css` or set the tokens yourself |
| `Cannot find module` | Package not built | Run `pnpm --filter @hachej/boring-ui-kit build` |
| Theme looks wrong | CSS vars overridden elsewhere | Check specificity — your vars should be at `:root` or `html` scope |

---

## Limitations

- **Not a standalone design system** — Designed as a shared dependency for boring-ui packages and plugins. Standalone use is supported but you'll need to provide CSS variables.
- **No data-heavy components** — No charts, data grids, calendar pickers, or Kanban boards. Use `@hachej/boring-workspace/charts` (recharts wrappers) or external libs for those.
- **No i18n built-in** — All text content (button labels, empty state messages) is plain strings. Wrap externally for localization.
- **No SSR testing** – Components are client-rendered and rely on browser APIs for portal rendering.

---

## FAQ

**Q: Do I need to import CSS separately in my plugins?**  
A: No. If your app already imports `@hachej/boring-workspace/globals.css`, the UI kit inherits those variables. Only import `@hachej/boring-ui-kit/styles.css` if you're using the kit outside of a boring-ui workspace.

**Q: Can I override component styles?**  
A: Yes. Every component accepts `className` and uses `clsx`/`tailwind-merge` so your Tailwind classes compose correctly. For deeper customization, override CSS variables.

**Q: Is this just re-exported shadcn?**  
A: No. While the kit uses Radix UI primitives (like shadcn does), it adds IDE-specific components (`Pane`, `PaneToolbar`, `SettingsPanel`) that shadcn doesn't ship. The kit is authored and maintained, not copied.

**Q: Can I use this without the rest of boring-ui?**  
A: Yes. The kit is a standalone npm package with no internal boring-ui dependencies. You'll need to provide CSS variables for theming.

**Q: What about code editors and rich text?**  
A: Not in this package. The kit focuses on UI chrome. Code editing (CodeMirror) and rich text (TipTap) are handled by `@hachej/boring-workspace` and its plugins.

---

*About Contributions:* Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.

---

## License

MIT
