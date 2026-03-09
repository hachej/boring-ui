# UI Polish: Sidebar Padding & Alignment

**Priority:** MEDIUM
**Component:** Left sidebar (file tree, header, user button)
**Screenshots:** 01-initial-load, 02-file-tree-expanded

## Problem
- Sidebar header "FILES" title is too close to the action icons on the right
- User avatar/button at the bottom is too close to the left edge
- The "Other" folder label with "..." menu feels cramped
- Inconsistent horizontal padding between search input, file items, and section headers

## Fix
1. Set consistent horizontal padding on sidebar content container: `padding: 0 12px`
2. Sidebar header row: use `display: flex; justify-content: space-between; align-items: center; padding: 8px 12px`
3. User menu button at bottom: `padding: 8px 12px` to align with content above
4. File tree items: ensure consistent left padding that accounts for nesting indent
5. Section headers ("Other", "FILES"): use `font-weight: var(--font-semibold); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-tertiary)`

## Files to modify
- `src/front/styles.css` (sidebar layout)
- `src/front/components/` (sidebar components)

## Acceptance criteria
- All sidebar content has consistent horizontal padding
- Header, file items, and footer align on the same left edge
- File tree nesting indentation is visually clear
