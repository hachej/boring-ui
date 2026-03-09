# UI Polish: Panel Resizer Affordance

**Priority:** LOW
**Component:** Panel resize handles between sidebar/editor/chat/terminal
**Screenshots:** All

## Problem
- The 1px borders between panels serve as resize handles but lack visual affordance
- Users can't tell they can drag to resize without accidentally discovering it

## Fix
1. On hover, change cursor appropriately:
   ```css
   .panel-resize-handle-horizontal { cursor: col-resize; }
   .panel-resize-handle-vertical { cursor: row-resize; }
   ```
2. On hover, widen the handle visual:
   ```css
   .panel-resize-handle:hover {
     background-color: var(--color-accent);
     opacity: 0.5;
     width: 3px; /* or height: 3px for horizontal */
   }
   ```
3. Add transition: `transition: background-color 150ms, opacity 150ms;`

## Files to modify
- `src/front/styles.css` (DockView resize handle overrides)

## Acceptance criteria
- Cursor changes when hovering over panel borders
- A subtle visual indicator appears on hover
- Smooth transition
