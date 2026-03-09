# UI Polish: Tab Sizing & File Tree Typography

**Priority:** LOW
**Component:** Editor tabs, file tree
**Screenshots:** 04-editor-python, 01-initial-load

## Problem
- Editor tabs have tight vertical padding, making text feel cramped
- File tree line height is dense, harder to scan
- Tab close (X) buttons are tiny and hard to target

## Fix
1. **Editor tabs**: Increase vertical padding
   ```css
   .tab { padding: 8px 16px; } /* from ~4px 12px */
   ```
2. **File tree items**: Increase line height
   ```css
   .file-tree-item { line-height: 1.6; padding: 2px 0; }
   ```
3. **Tab close buttons**: Ensure minimum 24x24px click target
   ```css
   .tab-close {
     min-width: 24px;
     min-height: 24px;
     display: flex;
     align-items: center;
     justify-content: center;
   }
   ```

## Files to modify
- `src/front/styles.css`

## Acceptance criteria
- Tabs feel spacious and readable
- File tree is easy to scan
- Close buttons are easy to click
