# UI Polish: Unify Button & Control Styles

**Priority:** MEDIUM
**Component:** All buttons and segmented controls across the app
**Screenshots:** 03-editor-readme, 04-editor-python, 01-initial-load

## Problem
At least four different button/control styles exist:
1. Markdown toolbar: `Edit | Diff | Raw` segmented control (one style)
2. Code editor toolbar: `Code | Diff` segmented control (different style)
3. Chat panel: `+ New session` button (solid background)
4. Terminal: `+`, `Close` icon buttons (ghost style)
5. Sidebar: gear icon, collapse icons (yet another style)

## Fix
1. Define a formal button system with variants:
   - `primary`: accent color fill (for main CTAs like "Save")
   - `secondary`: border + transparent bg (for "Cancel", "New session")
   - `ghost`/`tertiary`: no border, subtle hover bg (for icon buttons)
2. Create shared CSS classes: `.btn-primary`, `.btn-secondary`, `.btn-ghost`
3. Unify all segmented controls to use one style (the Markdown editor style is more modern)
4. Ensure all buttons have:
   - Consistent border-radius: `var(--radius-sm)`
   - Consistent padding: `6px 12px` for text buttons, `6px` for icon buttons
   - `transition: background-color 150ms ease-out, border-color 150ms ease-out`

## Files to modify
- `src/front/styles.css` (add button system classes)
- `src/front/components/` (apply consistent classes)
- `src/front/App.jsx` (editor toolbar buttons)

## Acceptance criteria
- All buttons use one of the three defined variants
- Segmented controls look identical everywhere
- Hover/active/focus states are consistent
- Transitions are smooth (150ms)
