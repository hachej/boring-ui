# App shell

The `app-shell` block gives an app its navigation, one header per screen, an account menu and a place for the agent, on a phone and on a wide screen.

## Sub-features

- `shell-layouts` three layouts: `screen`, `workspace` (list and detail, left pane starts as the icon rail) and `chat` (the page is `AgentWorkspace`). `registry/app-shell/app-shell.tsx`.
- `shell-nav` bottom tab bar on a phone (four items, more give three plus « Plus »), `compactNav="sheet"` for a sheet instead, shadcn sidebar with `rail="icon" | "hover"` on a wide screen, whose inset Separator sizes within its margins (no masked internal x overflow); `NavItem.placement: "before-sidebar"` puts an item above the screen's own sidebar content and first in the tab bar (D-1210). `registry/app-shell/nav.tsx`.
- `shell-header` one header per screen through `useScreenHeader`, back arrow, at most two actions. `registry/app-shell/header.tsx`.
- `shell-list-detail` `ListDetail`: both panes wide, one at a time on a phone with Back, collapsible list. `registry/app-shell/list-detail.tsx`.
- `shell-account` account sheet and menu: name, email, app menu, theme switch, sign out. `registry/app-shell/account.tsx`.
- `shell-sidebar-toggle` the collapse control sits in the sidebar header (top of the rail: next to the title expanded, alone as an icon when folded), never in the screen header on a wide screen; Ctrl+B still folds it and its name stays « Toggle Sidebar » (`data-slot="sidebar-trigger"`). The rule (approved by the designer): the toggle moves inside the sidebar only where the rail exists (md+); on a phone there is no rail while the sidebar is closed, so with `compactNav="sheet"` its opener stays in the screen header (and the open sheet carries the same control as its close). `registry/app-shell/nav.tsx`, `header.tsx`.
- `shell-flat` the shell is flat: grey canvas and sidebar, one white `bg-card` content surface, no ring, border or shadow on the frame, no line under the header and no tint on the `ListDetail` detail pane. The edges left are the phone tab bar's top line and the vertical line between list and detail. `ListDetail` takes an optional `empty` node for the detail pane while nothing is chosen. Its viewport values (`--app-shell-safe-top`, `--app-shell-safe-bottom`, `--app-shell-tabbar-min`, `--app-shell-sheet-max`) are tokens in the item's css, not arbitrary values. `registry/app-shell/`.
- `shell-back` one Back manager for point mode, sheets, the agent layer and list-detail stacks. `registry/utils/back.ts`.
- `shell-dense-targets` 44px touch targets under 640px or on a coarse pointer, opt out with `data-dense`. `registry/README.md` section Agent layer.

## How to get to it (user POV)

- Open any app that mounts `<AppShell layout=... />`; the example is `examples/app-shell/page.tsx`.
- Resize between phone and desktop widths; the same screens stay mounted.

## Driving it with the app-shell journeys

Preconditions: `npm ci`, Chromium available, a built kit (`npm run build`).

- **Layouts.** `shell-layouts`: `npm run app-shell:journey` (screen) and `npm run app-shell:journey:workspace` (workspace). The sidebar is open in `screen` and the icon rail in `workspace`.
- **Navigation.** `shell-nav`: at 390px the tab bar shows four items; at desktop width the sidebar shows labels. The focused `test/contracts/default-integration-browser.test.mjs` check with `DEFAULT_FIX_STAGE=sidebar` over a fresh source-preview round measures sidebar-content client/scroll width and descendant widths, then drives navigation, account menu/focus return and the agent action by keyboard. Separator width plus its margins must fit; changing overflow policy is not a repair.
- **Header and Back.** `shell-header`, `shell-back`: open a detail on a phone, press Back, the list returns with its scroll kept.
- **List and detail.** `shell-list-detail`: select a row; both panes wide, detail only on a phone.
- **Account.** `shell-account`: open the avatar button (`account-button`), toggle the theme switch (`account-theme`).
- **Toggle and flat shell.** `shell-sidebar-toggle`, `shell-flat`: at 1280px press the icon at the top of the left bar (or Ctrl+B); the bar folds to its icon rail and the toggle stays at its top. At 390px with `compactNav="sheet"` the header's leading button opens the sheet. `test/contracts/app-shell-render.impl.mjs` asserts the places, the absence of edge classes and at most one separator.
- **Targets.** `shell-dense-targets`: measure buttons at 390px; none under 44px outside `data-dense`.
- **Proof.** An ARIA snapshot and a screenshot per width under `.cache/evidence/<journey>/`, tagged with the ID.

## Gotchas

- Every screen stays mounted, hidden when not on show: state survives, effects keep running.
- `layout="chat"` with an `agent` prop throws on purpose.
- Never edit an installed block; `boring-ui-blocks check` fails on edited copies.
