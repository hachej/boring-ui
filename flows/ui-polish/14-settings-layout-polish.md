# UI Polish: Settings Pages Layout & Polish

**Priority:** HIGH
**Component:** UserSettingsPage, WorkspaceSettingsPage
**Screenshots:** 24-user-settings, 25-workspace-settings
**Source:** Gemini 3.1 Pro: "Save button orphaned outside card, feels dated"

## Problem
- "Save Changes" button is floating outside the card layout, disconnected from the form
- Settings cards are centered and overly wide
- Danger zone sections use aggressive red text for headers (non-standard)
- No dark mode support for settings pages
- Disabled inputs (Email, Workspace ID) have heavy gray backgrounds

## Fix
1. **Move Save button inside the card** it belongs to (right-aligned at bottom, Vercel-style)
2. **Danger Zone treatment**: Keep header text standard color, apply danger to card border + button only:
   ```css
   .settings-section-danger {
     border-color: #fecaca;
     background: rgba(254, 242, 242, 0.5);
   }
   .settings-section-danger .settings-section-title {
     color: var(--color-text-primary); /* NOT red */
   }
   ```
3. **Disabled inputs**: Lighten to `background: var(--color-bg-secondary)` instead of heavy gray
4. **Add dark mode** to all settings pages - settings rendered via PageShell should respect `data-theme`
5. **Add Copy button** to Workspace ID field (use Lucide `Copy` icon)

## Files to modify
- `src/front/pages/UserSettingsPage.jsx`
- `src/front/pages/WorkspaceSettingsPage.jsx`
- `src/front/pages/PageShell.jsx`
- `src/front/styles.css` (settings styles, dark mode variants)

## Acceptance criteria
- Save button is contextually placed inside its section
- Danger zones signal danger via border/background, not aggressive red headers
- Settings pages render correctly in dark mode
- Disabled inputs are lighter, Workspace ID has copy button
