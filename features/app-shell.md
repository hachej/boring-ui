# App shell

The `app-shell` block gives an app its navigation, one header per screen, an account menu and a place for the agent, on a phone and on a wide screen.

## Sub-features

- `shell-layouts` three layouts: `screen`, `workspace` (list and detail, left pane starts as the icon rail) and `chat` (the page is `AgentWorkspace`). `registry/app-shell/app-shell.tsx`.
- `shell-nav` bottom tab bar on a phone (four items, more give three plus « Plus »), `compactNav="sheet"` for a sheet instead, shadcn sidebar with `rail="icon" | "hover"` on a wide screen, whose inset Separator sizes within its margins (no masked internal x overflow); `NavItem.placement: "before-sidebar"` puts an item above the screen's own sidebar content and first in the tab bar (D-1210). `registry/app-shell/nav.tsx`.
- `shell-header` one header per screen through `useScreenHeader`, back arrow, at most two actions. `registry/app-shell/header.tsx`.
- `shell-list-detail` `ListDetail`: both panes wide, one at a time on a phone with Back, collapsible list. `registry/app-shell/list-detail.tsx`.
- `shell-account` account sheet and menu: name, email, app menu, theme switch, sign out. `registry/app-shell/account.tsx`.
- `shell-sidebar-toggle` the collapse control sits in the sidebar header (top of the rail: next to the title expanded, alone as an icon when folded), never in the screen header on a wide screen; Ctrl+B still folds it and its name stays « Toggle Sidebar » (`data-slot="sidebar-trigger"`). `rail="hover"` has no toggle on a wide screen: the rail opens on hover and focus by itself (the phone sheet keeps its close control). The rule (approved by the designer): the toggle moves inside the sidebar only where the rail exists (md+); on a phone there is no rail while the sidebar is closed, so with `compactNav="sheet"` its opener stays in the screen header (and the open sheet carries the same control as its close). `registry/app-shell/nav.tsx`, `header.tsx`.
- `shell-flat` the shell is flat: grey canvas and sidebar, one white `bg-card` content surface, no ring, border or shadow on the frame, no line under the header and no tint on the `ListDetail` detail pane. The kit declares no line at all: the phone tab bar's top Separator is deleted (it measured 0px in the pinned fixture, and the bar is told apart by its grey), the bar paints the rail's `bg-sidebar` (light and dark) and its items are inset 8px (`px-2`) from the screen edge, at 44px tap height; the sidebar edge is tonal; list row dividers belong to the app's own list; the vertical list/detail Separator measured 0px wide too and was removed. `ListDetail` takes an optional `empty` node for the detail pane while nothing is chosen. Its viewport values (`--app-shell-safe-top`, `--app-shell-safe-bottom`, `--app-shell-tabbar-min`, `--app-shell-sheet-max`) are tokens in the item's css, not arbitrary values. `registry/app-shell/`.
- `shell-sidebar-width` the sidebar width is a theme token (app look): an app sets `--sidebar-width`, `--sidebar-width-icon` or `--sidebar-width-mobile` on `:root` in its `theme.core.css` with no `!important`. The primitive carries the defaults (16rem; control height + 1rem, following the wrapper's own `--control-h`) as `var()` fallbacks resolved on the wrapper, so a sidebar without the app-shell css still has a width and a `SidebarProvider` `style` still wins. The phone sheet is 75% of the screen up to the Sheet's 24rem cap unless `--sidebar-width-mobile` is set (the old inline 18rem never applied). The dock + PM column breakpoint (`TOGETHER_FROM`, 1360px) assumes the default 16rem and cannot read the token; a themed sidebar wider than 16.5rem needs it raised. `shadcn/ui/sidebar.tsx`.
- `shell-back` one Back manager for point mode, sheets, the agent layer and list-detail stacks. `registry/utils/back.ts`.
- `shell-dense-targets` touch targets follow the `--control-h` / `--control-min` tokens (44px under 768px or on a coarse pointer, 36px on a fine pointer from md), `data-density="compact"` on a container forces 36px. `registry/README.md` section Agent layer.
- `shell-app-css` the app's base stylesheet is one kit file, `@hachej/boring-ui-kit/app.css`: type scale, colour map, defaults, base layer, shell/chat/feedback resets, overlay-blur rule; apps import it, never copy it, and the theme files imported after it win. `packages/ui/styles/app.css`, `registry/README.md` section "The app's index.css".
- `shell-theme-derived` the derivation of component tokens from the app's core roles is one kit file, `@hachej/boring-ui-kit/theme.derived.css`, imported after `app.css` and before the app's `theme.core.css`, whose roles and EXCEPTIONS win. `packages/ui/styles/theme.derived.css`.

## How to get to it (user POV)

- Open any app that mounts `<AppShell layout=... />`; the example is `examples/app-shell/page.tsx`.
- Resize between phone and desktop widths; the same screens stay mounted.

## Driving it with the app-shell journeys

Preconditions: `npm ci`, Chromium available, a built kit (`npm run build`).

- **Layouts.** `shell-layouts`: `npm run app-shell:journey` (screen) and `npm run app-shell:journey:workspace` (workspace). The sidebar is open in `screen` and the icon rail in `workspace`.
- **Navigation.** `shell-nav`: at 390px the tab bar shows four items; at desktop width the sidebar shows labels. No automated browser proof (D-1747): the sidebar overflow, keyboard navigation, account menu focus return and agent action checks were deleted with their harness. Separator width plus its margins must fit; changing overflow policy is not a repair.
- **Header and Back.** `shell-header`, `shell-back`: open a detail on a phone, press Back, the list returns with its scroll kept.
- **List and detail.** `shell-list-detail`: select a row; both panes wide, detail only on a phone.
- **Account.** `shell-account`: open the avatar button (`account-button`), toggle the theme switch (`account-theme`).
- **Toggle and flat shell.** `shell-sidebar-toggle`, `shell-flat`: at 1280px press the icon at the top of the left bar (or Ctrl+B); the bar folds to its icon rail and the toggle stays at its top. At 390px with `compactNav="sheet"` the header's leading button opens the sheet. `test/contracts/app-shell-render.impl.mjs` asserts the places, the absence of edge classes and at most one separator.
- **Targets.** `shell-dense-targets`: measure buttons at 390px coarse: none under 44px outside `data-density="compact"`; at 1440 fine and in a 400px compact frame the controls are 36px (`test/contracts/control-height.test.mjs`).
- **Sidebar width.** `shell-sidebar-width`: `CHROMIUM=... node --test test/contracts/sidebar-width-token.test.mjs` (256px default, 248px from a theme `:root`, a provider `style` wins).
- **Base stylesheet.** `shell-app-css`: `node --test test/contracts/app-css.test.mjs` compiles an app `index.css` (imports + `app.css` + a fixture `theme.core.css`) with Tailwind and checks the theme wins and the scale, map and resets are present.
- **Derived theme.** `shell-theme-derived`: `node --test test/contracts/theme-derived.test.mjs` compiles app.css, the kit's derived file and a fixture core that pins `--muted-foreground` and `--destructive-soft` in `:root` and `.dark`: pinned values win, unpinned roles get the derived value, and reversing the order fails.
- **Proof.** An ARIA snapshot and a screenshot per width under `.cache/evidence/<journey>/`, tagged with the ID.

## Gotchas

- Every screen stays mounted, hidden when not on show: state survives, effects keep running.
- `layout="chat"` with an `agent` prop throws on purpose.
- Never edit an installed block; `boring-ui-blocks check` fails on edited copies.
