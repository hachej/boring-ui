# UI Polish Beads

Reviewed by **Gemini 2.5 Pro** and **Gemini 3.1 Pro Preview** across 26 screenshots covering:
auth pages, file tree, code editor, markdown editor, agent chat with tool use, terminal, user menu, search, git changes, light/dark modes.

## CRITICAL (architectural layout change)
| # | Bead | Component | Impact |
|---|------|-----------|--------|
| 17 | [Minimalist layout overhaul](17-minimalist-layout-overhaul.md) | Global layout | **CRITICAL**: Too many controls, 5-layer sidebar, redundant headers everywhere |
| 00 | [Agent tool rendering](00-agent-tool-rendering.md) | PI Agent chat tools | **CRITICAL**: Raw XML shown to users |

## HIGH Priority (looks broken / critical UX failure)
| # | Bead | Component | Impact |
|---|------|-----------|--------|
| 01 | [Chat input layout](01-chat-input-layout.md) | PI Agent chat input | Flush textarea, dashed border inconsistency |
| 01b | [Chat message hierarchy](01b-chat-message-hierarchy.md) | PI Agent messages | User/agent messages bleed together, Send button gray |
| 02 | [User menu redesign](02-user-menu-redesign.md) | User dropdown | Looks like different app, contradictory state |
| 03 | [Dark mode contrast](03-dark-mode-contrast.md) | Terminal, dark borders | WCAG failure + blinding white borders in dark mode |
| 14 | [Settings layout polish](14-settings-layout-polish.md) | Settings pages | Save button orphaned, no dark mode, heavy disabled inputs |

## MEDIUM Priority (noticeable rough edges)
| # | Bead | Component | Impact |
|---|------|-----------|--------|
| 04 | [Button system](04-button-system-unification.md) | All buttons | 4+ different button styles |
| 05 | [Empty states](05-empty-states-upgrade.md) | Agent, git, search, editor | Blank/bare empty states |
| 06 | [Sidebar spacing](06-sidebar-spacing-alignment.md) | Left sidebar | Cramped, inconsistent padding |
| 07 | [Focus states](07-focus-states-consistency.md) | All interactive | Missing keyboard focus indicators |
| 08 | [Placeholder text](08-placeholder-text-styling.md) | Inputs | Too dark, competing with content |
| 13 | [Auth-workspace consistency](13-auth-workspace-consistency.md) | Auth + workspace | Feels like two different products |
| 15 | [Modal polish](15-modal-polish.md) | CreateWorkspaceModal | No blur overlay, no shadow, no dark mode |
| 16 | [Icon consistency](16-icon-consistency.md) | All icons | Menu items lack icons, inconsistent sizes, chevron/arrow mix |

## LOW Priority (nice-to-have polish)
| # | Bead | Component | Impact |
|---|------|-----------|--------|
| 09 | [Hover states](09-hover-states-transitions.md) | File tree, tabs, buttons | Missing hover feedback |
| 10 | [Tab sizing](10-tab-sizing-typography.md) | Editor tabs, file tree | Cramped tabs, dense tree |
| 11 | [Panel resizers](11-panel-resizer-affordance.md) | Panel borders | No resize affordance |
| 12 | [Dead code cleanup](12-dead-code-cleanup.md) | PI iframe adapter | Unused file |

## Implementation order
1. **CRITICAL first**: Bead 17 (minimalist layout) — this is the structural foundation; do it before component-level polish. Bead 00 (agent tool rendering) can run in parallel.
2. **HIGH next**: 01 + 01b (chat layout/hierarchy), 02 (user menu), 03 (dark mode), 14 (settings). Beads 01/01b and 02 overlap with bead 17's chat/sidebar simplification — implement them as part of 17 or immediately after.
3. **MEDIUM**: 04 (buttons) -> 07 (focus) -> 06 (sidebar, largely absorbed by 17) -> 05 (empty states) -> 08 (placeholders) -> 13 (auth consistency) -> 15 (modal) -> 16 (icons)
4. **LOW**: 09 (hovers, depends on 04) -> 10 (tabs, partially absorbed by 17) -> 11 (resizers) -> 12 (cleanup)

Bead 17 subsumes parts of 06 (sidebar spacing), 10 (tab sizing), 16 (icon layout). Check for overlap before implementing those.

## Screenshots
Use the automated capture script:

```bash
npm run capture:ui-polish
```

Outputs are written to `/tmp/boring-ui-screenshots/` with consistent numbered names (`01-...png` through `26-...png`).

## Review Sources
- Gemini 2.5 Pro: broad design system consistency, WCAG, component-level fixes
- Gemini 3.1 Pro Preview: end-to-end product feel, agent UX, auth-workspace bridge
