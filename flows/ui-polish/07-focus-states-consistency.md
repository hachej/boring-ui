# UI Polish: Consistent Focus States

**Priority:** MEDIUM
**Component:** All interactive elements
**Screenshots:** 15-file-search (shows good focus ring on search)

## Problem
- The file search input shows a nice orange focus ring (good!)
- But this is likely not applied consistently to all interactive elements
- Buttons, tabs, file tree items, menu items may lack visible focus indicators
- This is both a polish issue and an accessibility requirement

## Fix
1. Add a global focus-visible style to all interactive elements:
   ```css
   :focus-visible {
     outline: 2px solid var(--color-accent);
     outline-offset: 2px;
   }
   ```
2. For elements where the outline looks bad (e.g., tabs), use a box-shadow instead:
   ```css
   :focus-visible {
     outline: none;
     box-shadow: 0 0 0 2px var(--color-accent);
   }
   ```
3. Ensure focus ring is visible in both light and dark mode
4. Remove any `outline: none` without a replacement

## Files to modify
- `src/front/styles.css` (global focus styles)

## Acceptance criteria
- Tab through all interactive elements - each one should show a visible focus indicator
- Focus ring uses accent color consistently
- Works in both light and dark mode
