# Design System: Shadows & Depth

**Priority:** HIGH
**Component:** `src/front/styles.css` shadow tokens
**Source:** DESIGN-SYSTEM-SPEC.md

## Problem
- Current shadows are generic Tailwind defaults
- Dark mode uses same shadow approach as light (doesn't work — shadows invisible on dark bg)
- No composite multi-layer shadows for premium feel
- Missing float/popover shadow level

## Changes

### Light mode shadows
```css
:root {
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
  --shadow-lg: 0 0 0 1px rgba(0, 0, 0, 0.03), 0 10px 20px -4px rgba(0, 0, 0, 0.08);
  --shadow-float: 0 0 0 1px rgba(0, 0, 0, 0.05), 0 8px 24px -4px rgba(0, 0, 0, 0.1);
  --shadow-xl: 0 0 0 1px rgba(0, 0, 0, 0.05), 0 20px 40px -8px rgba(0, 0, 0, 0.15);

  /* Focus ring (Mac/Linear style: white gap + colored ring) */
  --ring-focus: 0 0 0 2px #ffffff, 0 0 0 4px rgba(0, 112, 243, 0.4);
}
```

### Dark mode shadows (inset lighting, not drop shadows)
```css
[data-theme="dark"] {
  --shadow-sm: inset 0 1px 0 0 rgba(255, 255, 255, 0.05);
  --shadow-md: 0 0 0 1px rgba(255, 255, 255, 0.1), 0 8px 16px rgba(0, 0, 0, 0.5);
  --shadow-lg: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 12px 24px rgba(0, 0, 0, 0.6);
  --shadow-float: 0 0 0 1px rgba(255, 255, 255, 0.1), 0 16px 32px rgba(0, 0, 0, 0.8), inset 0 1px 0 0 rgba(255, 255, 255, 0.05);
  --shadow-xl: 0 0 0 1px rgba(255, 255, 255, 0.1), 0 24px 48px rgba(0, 0, 0, 0.9), inset 0 1px 0 0 rgba(255, 255, 255, 0.05);

  --ring-focus: 0 0 0 2px #111111, 0 0 0 4px rgba(59, 130, 246, 0.6);
}
```

### Usage guide
- `--shadow-sm`: buttons (light mode only, dark uses inset highlight)
- `--shadow-md`: dropdowns, popovers
- `--shadow-lg`: floating panels
- `--shadow-float`: command palette, modal overlays
- `--shadow-xl`: large modals
- `--ring-focus`: all focus-visible states

## Files to modify
- `src/front/styles.css` (shadow tokens, all shadow usages)

## Acceptance criteria
- Light mode has composite multi-layer shadows
- Dark mode uses inset top highlights + heavy drop shadows
- Focus ring has white/dark gap between element and ring
- Dropdowns and modals feel elevated and premium
