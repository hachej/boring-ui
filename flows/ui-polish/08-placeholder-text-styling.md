# UI Polish: Placeholder Text Styling

**Priority:** MEDIUM
**Component:** Chat input placeholder, search input placeholder
**Screenshots:** 01-initial-load, 16-dark-mode-full

## Problem
- "Type a message..." placeholder text is too dark and large, competing with actual content
- Placeholder styling inconsistent between inputs

## Fix
1. Add a dedicated placeholder color token:
   ```css
   --color-text-placeholder: #9CA3AF; /* light mode */
   /* dark mode: #6B7280 */
   ```
2. Apply to all inputs:
   ```css
   input::placeholder,
   textarea::placeholder {
     color: var(--color-text-placeholder);
     font-style: normal;
   }
   ```
3. Ensure placeholder font-size matches the input's font-size (don't make it larger)

## Files to modify
- `src/front/styles.css`

## Acceptance criteria
- Placeholder text is clearly lighter than input text
- Consistent across all inputs
- Works in both themes
