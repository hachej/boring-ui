# D-1904: sidebar row action and count on touch

Choice for the badge and action on one row: the badge moves left of the action (the count stays visible on touch, where hover does not exist). Only on a coarse pointer, in CSS (`pointer-coarse:` is `@media (pointer: coarse)`), in `shadcn/ui/sidebar.tsx`:

- `SidebarMenuAction`: `top-1/2 -translate-y-1/2`, `size-11` (44x44), its `after:` hit area (which reached 8px into the next rows) is off.
- `SidebarMenuBadge`: centred the same way; with an action in the row it sits at `right-12` (left of the 44px action).
- `SidebarMenuButton`: end padding reserves the action (`pr-12`), or the action and the count (`pr-20`), so the label truncates before both.

A fine pointer is unchanged at every width (action 20x20 at top 6, right 4; count 20 high at top 6, right 4), as is the row height.

Proof: `test/contracts/sidebar-menu-action.test.mjs` (real Chromium; 390 coarse, 1280 fine, 390 fine; light and dark). Shots: the `sidebar-action-shots` artifact of the `tests` job (`sidebar-action-390-light.png`, `-390-dark`, `-1280-light`, `-1280-dark`, and `sidebar-action-measurements.json`).
