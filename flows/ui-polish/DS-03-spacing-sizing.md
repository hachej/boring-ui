# Design System: Spacing & Component Sizing

**Priority:** HIGH
**Component:** `src/front/styles.css` spacing tokens + component dimensions
**Source:** DESIGN-SYSTEM-SPEC.md

## Problem
- Button/input heights follow Tailwind defaults (~40px) — too tall for an IDE
- Paddings too generous for information-dense layout
- No explicit component height tokens

## Changes

### Component heights
```css
:root {
  --height-xs: 24px;   /* icon buttons, tiny controls */
  --height-sm: 28px;   /* small buttons, compact inputs */
  --height-md: 32px;   /* default buttons, inputs */
  --height-lg: 36px;   /* large buttons (auth CTA, primary actions) */
}
```

### Standard paddings by component
- **Buttons**: `4px 12px` (height controlled by `--height-sm` or `--height-md`)
- **Inputs**: `6px 10px` (with `--height-md` min-height)
- **File tree rows**: `4px 8px`
- **Sidebar section headers**: `6px 12px`
- **Panel content**: `8px 12px`
- **Cards/sections**: `16px`
- **Modal/dialog content**: `24px`

### The 1px panel gap trick
Replace `border-right` / `border-bottom` between panels with:
```css
.app-layout {
  background: var(--color-border);
  display: flex;
  gap: 1px;
}

.app-layout > * {
  background: var(--color-bg-primary);
}
```
This creates pixel-perfect 1px hairlines without border overlap issues.

### Touch targets
- Minimum clickable area: 24x24px for icon buttons
- File tree rows: min-height 28px
- Tab close buttons: 24x24px click target (even if icon is 12px)

## Files to modify
- `src/front/styles.css` (new height tokens, padding adjustments, panel gap trick)
- Component files that set explicit heights on buttons/inputs

## Acceptance criteria
- Buttons are 28-32px tall, not 40px
- File tree feels dense but hittable (28px rows)
- Panel borders use gap trick, not CSS borders
- Everything feels tighter and more IDE-like
