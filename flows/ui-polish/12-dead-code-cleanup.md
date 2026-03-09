# UI Polish: Dead Code Cleanup

**Priority:** LOW
**Component:** Unused PI iframe adapter
**Files:** `src/front/providers/pi/adapter.jsx`

## Problem
- `adapter.jsx` exports `PiAdapter` which embeds PI as an iframe
- It is never imported anywhere in the codebase (confirmed via grep)
- Dead code adds confusion and maintenance burden

## Fix
1. Delete `src/front/providers/pi/adapter.jsx`
2. Verify no imports reference it (already confirmed: zero imports)

## Acceptance criteria
- File removed
- No broken imports
- Tests still pass
