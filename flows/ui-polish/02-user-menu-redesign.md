# UI Polish: User Menu Dropdown Redesign

**Priority:** HIGH
**Component:** User menu dropdown (bottom-left avatar click)
**Screenshots:** 14-user-menu

## Problem
The user menu dropdown looks like it's from a different application:
- Inconsistent padding between menu items
- "Not signed in" error state uses a harsh red background that's jarring
- "Retry" button has a unique style not seen elsewhere
- Overall spacing doesn't follow the design system

## Fix
1. Standardize all menu items with consistent padding: `padding: 8px 12px`
2. Replace the solid red error block with a subtle inline error: small warning icon + text, using `var(--color-error)` for text only, same background as other items
3. "Retry" button should use the standard secondary button style (matching other buttons in the app)
4. Add hover state to all menu items: `background-color: var(--color-bg-hover)`
5. Ensure the separator line between sections uses `var(--color-border)` and proper margin

## Files to modify
- `src/front/App.jsx` (user menu rendering)
- `src/front/styles.css` (user menu styles)

## Acceptance criteria
- All menu items have equal padding and height
- Error state is subtle, not a red block
- Hover states on all interactive items
- Consistent with the rest of the design system
