# UI Polish: Auth-to-Workspace End-to-End Consistency

**Priority:** MEDIUM
**Component:** Auth pages + workspace transition
**Screenshots:** 17-auth-signin, 18-auth-signup, 01-initial-load
**Source:** Gemini 3.1 Pro: "transition from generic SaaS Auth page to highly technical IDE is jarring"

## Problem
- Auth page feels like a different product from the workspace
- Auth page uses generic SaaS styling, workspace is a technical IDE
- Orange accent (#ea580c) is prominent on auth "Continue" button but absent in the IDE
- No monospace font connection between auth and workspace
- Auth page box-shadows feel dated (muddy, diffuse)

## Fix
1. **Bridge the typography**: Add `JetBrains Mono` to the auth page's "Boring UI" title or a decorative code snippet on the left rail
2. **Accent color in IDE**: Use orange accent consistently:
   - Active tab indicator: `border-top: 2px solid var(--color-accent)`
   - Chat Send button (when active): `background-color: var(--color-accent)`
   - Focus states everywhere: `outline-color: var(--color-accent)`
3. **Auth shadows**: Modernize to crisp shadow:
   ```css
   box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
   ```
4. **Left rail**: Add subtle code-themed decoration (dot grid, faint syntax) to connect to IDE identity

## Files to modify
- `src/back/boring_ui/api/modules/control_plane/auth_router_supabase.py` (auth HTML template)
- `src/front/styles.css` (accent usage in IDE)

## Acceptance criteria
- Auth page -> workspace feels like one product
- Orange accent visible in both auth CTA and IDE active states
- Monospace font appears on auth page
