# UI Polish: Chat Input Panel Layout

**Priority:** HIGH
**Component:** PI Agent chat panel input area
**Screenshots:** 01-initial-load, 07-chat-typing, 16-dark-mode-full

## Problem
The chat input textarea is flush against the edges of its container. It looks broken and is visually claustrophobic. The border style is dashed, which is inconsistent with the solid borders used on the sidebar search input.

## Fix
1. Add proper padding to the chat input container (16px all sides)
2. Change the textarea border from `dashed` to `solid` to match the sidebar search input
3. Standardize border-radius with the search input (use `var(--radius-sm)` or 6px)
4. Ensure consistent `border: 1px solid var(--color-border)` across all inputs

## Files to modify
- `src/front/styles.css` (chat input container styles)
- `src/front/providers/pi/` (any inline styles on the chat textarea)

## Acceptance criteria
- Chat input has 16px padding inside its container
- Border style matches sidebar search input (solid, same radius)
- Looks correct in both light and dark mode
