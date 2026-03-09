# UI Polish: Improve Empty States

**Priority:** MEDIUM
**Component:** PI Agent empty state, Git changes "No changes", File search "No files found", Editor placeholder
**Screenshots:** 01-initial-load, 06-git-changes, 15-file-search

## Problem
- PI Agent panel is completely blank when no conversation exists - no welcome message or guidance
- "No changes" in git view is functional but plain - just a checkmark and text
- "No files found" search result is bare text
- "Open a file or series from the left pane to start" placeholder lacks visual weight

## Fix
1. **PI Agent empty state**: Add a welcome message with subtle icon:
   - Center vertically in the panel
   - Show agent avatar/icon + "Ask me anything about your code"
   - Optionally show 2-3 suggested prompts as clickable pills
   - Use `var(--color-text-tertiary)` for text, `var(--font-sans)`

2. **Git "No changes"**: Keep checkmark but add subtitle "Working tree is clean" in lighter text

3. **File search "No files found"**: Add a search icon (magnifying glass with X) above the text, center vertically

4. **Editor placeholder**: Use a larger, lighter font weight and optionally add a keyboard shortcut hint ("Ctrl+P to search files")

## Files to modify
- `src/front/panels/CompanionPanel.jsx` or PI native adapter (empty state)
- `src/front/components/` (GitChangesView, file search)
- `src/front/styles.css` (empty state styling)
- `src/front/App.jsx` (editor placeholder)

## Acceptance criteria
- All empty states have an icon + descriptive text
- Text is centered and uses appropriate design tokens
- Empty states look intentional, not accidentally blank
