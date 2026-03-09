# UI Polish: Dark Mode Contrast & Accessibility

**Priority:** HIGH
**Component:** Terminal panel, general dark mode text
**Screenshots:** 05-dark-mode, 16-dark-mode-full

## Problem
- Terminal text "[bridge] Unexpected bridge error" is nearly unreadable against the dark background - critical WCAG accessibility failure
- Some text elements in dark mode don't have sufficient contrast (minimum 4.5:1 ratio required)
- The dark mode code editor background doesn't fully differentiate from the surrounding chrome

## Fix
1. Increase terminal text color lightness: use at least `#8B949E` (GitHub's muted text) for low-emphasis terminal text
2. Audit all `--color-text-*` dark mode tokens for WCAG AA compliance (4.5:1 for normal text, 3:1 for large text)
3. Add a `--color-text-muted` token for dark mode that's clearly readable: `#8B949E` or lighter
4. Ensure terminal error messages use `var(--color-error)` which should be bright enough in dark mode (e.g., `#F87171`)
5. Verify all interactive element labels meet contrast requirements

## Files to modify
- `src/front/styles.css` (dark mode color tokens in `[data-theme="dark"]`)
- Terminal component styles

## Acceptance criteria
- All text in dark mode meets WCAG AA contrast ratio (4.5:1)
- Terminal text is clearly readable
- Error text in terminal uses a visible error color
- Run a contrast checker on all dark mode text/background combinations
