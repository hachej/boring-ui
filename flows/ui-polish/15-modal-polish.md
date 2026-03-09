# UI Polish: Create Workspace Modal

**Priority:** MEDIUM
**Component:** CreateWorkspaceModal
**Screenshots:** 26-create-workspace-modal
**Source:** Gemini 3.1 Pro: "breaks spatial relationship with the app"

## Problem
- Modal backdrop should use semi-transparent blur overlay, not solid gray
- Modal dialog needs proper elevation (shadow, border)
- Close button (x) is plain text, should be an icon button
- No dark mode support

## Fix
1. **Backdrop**: `background: rgba(0,0,0,0.4); backdrop-filter: blur(4px);`
2. **Dialog shadow**: `box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25);`
3. **Close button**: Use Lucide `X` icon (already imported) with proper icon button styling
4. **Dark mode**: `background: var(--color-bg-primary); border: 1px solid var(--color-border);`

## Files to modify
- `src/front/pages/CreateWorkspaceModal.jsx`
- `src/front/styles.css` (modal styles)

## Acceptance criteria
- Modal overlay has blur effect
- Dialog has proper depth via shadow
- Close button is a proper icon button
- Works in dark mode
