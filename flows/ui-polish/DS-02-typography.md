# Design System: Typography Refinement

**Priority:** CRITICAL (foundation)
**Component:** `src/front/styles.css` type tokens + `body` base styles
**Source:** DESIGN-SYSTEM-SPEC.md

## Problem
- Type scale missing 13px — the sweet spot for IDE UI (Linear, Slack, VS Code all use it)
- No letter-spacing applied to Inter — looks generic and wide
- Line heights too loose for an information-dense IDE
- Default body font-size is 16px (browser default) — too large for dev tool UI

## Changes

### Type scale
```css
:root {
  --text-micro: 0.6875rem;  /* 11px — badges, tiny metadata */
  --text-xs: 0.75rem;       /* 12px — file tree secondary, timestamps */
  --text-sm: 0.8125rem;     /* 13px — NEW: base UI, buttons, inputs */
  --text-base: 0.875rem;    /* 14px — was 1rem, now settings text, chat */
  --text-lg: 1rem;          /* 16px — was 1.125rem, now section headers */
  --text-xl: 1.125rem;      /* 18px — was 1.25rem, page titles */
  --text-2xl: 1.5rem;       /* 24px — unchanged, hero/auth */
}
```

### Letter spacing
```css
body {
  font-size: var(--text-sm);     /* 13px default */
  letter-spacing: -0.01em;       /* crucial for Inter to look premium */
  line-height: 1.4;
  -webkit-font-smoothing: antialiased;
}

/* Headers get tighter tracking */
h1, h2, h3, .text-lg, .text-xl, .text-2xl {
  letter-spacing: -0.02em;
}
```

### Line heights by context
- **UI text** (buttons, labels, menus): `line-height: 1.2` to `1.3`
- **Body text** (settings descriptions, chat messages): `line-height: 1.4` to `1.5`
- **Code**: `line-height: 1.6` (JetBrains Mono needs more)

### Component-specific font sizes
- Sidebar section headers (FILES, GIT): `--text-xs` (12px), `font-weight: 600`, `text-transform: uppercase`, `letter-spacing: 0.05em`
- File tree items: `--text-xs` (12px) or `--text-sm` (13px)
- Editor tabs: `--text-sm` (13px)
- Buttons: `--text-sm` (13px), `font-weight: 500`
- Chat messages: `--text-base` (14px)
- Settings page body: `--text-base` (14px)
- Page titles: `--text-xl` (18px), `font-weight: 600`

## Files to modify
- `src/front/styles.css` (token definitions, body styles, all font-size usages)

## Acceptance criteria
- Body default is 13px with -0.01em letter-spacing
- 13px exists as `--text-sm` in the scale
- Headers have -0.02em tracking
- File tree and sidebar feel denser but readable
- No text feels too large for an IDE context
