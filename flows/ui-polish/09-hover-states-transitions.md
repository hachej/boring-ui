# UI Polish: Hover States & Transitions

**Priority:** LOW
**Component:** File tree items, tabs, icon buttons, menu items
**Screenshots:** All

## Problem
- Unclear which elements are interactive without hover feedback
- File tree items lack hover background
- Tabs don't change on hover
- Icon buttons don't show a hover indicator
- No smooth transitions between states

## Fix
1. **File tree items**: Add hover background
   ```css
   .file-item:hover { background-color: var(--color-bg-hover); }
   ```
2. **Tabs**: Lighten or change background on hover
   ```css
   .tab:not(.active):hover { background-color: var(--color-bg-hover); }
   ```
3. **Icon buttons**: Add circular/square hover background
   ```css
   .icon-btn:hover {
     background-color: var(--color-bg-hover);
     border-radius: var(--radius-sm);
   }
   ```
4. **All interactive elements**: Add smooth transitions
   ```css
   transition: background-color 150ms ease-out, color 150ms ease-out;
   ```

## Files to modify
- `src/front/styles.css`

## Acceptance criteria
- Every interactive element changes appearance on hover
- Transitions are smooth (150ms)
- Hover states use design tokens consistently
