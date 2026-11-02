# App shell

The `app-shell` block gives an app its navigation, one header per screen, an account menu and a place for the agent, on a phone and on a wide screen.

## Sub-features

- `shell-layouts` three layouts: `screen`, `workspace` (list and detail, left pane starts as the icon rail) and `chat` (the page is `AgentWorkspace`). `registry/app-shell/app-shell.tsx`.
- `shell-nav` bottom tab bar on a phone (four items, more give three plus « Plus »), `compactNav="sheet"` for a sheet instead, shadcn sidebar with `rail="icon" | "hover"` on a wide screen. `registry/app-shell/nav.tsx`.
- `shell-header` one header per screen through `useScreenHeader`, back arrow, at most two actions. `registry/app-shell/header.tsx`.
- `shell-list-detail` `ListDetail`: both panes wide, one at a time on a phone with Back, collapsible list. `registry/app-shell/list-detail.tsx`.
- `shell-account` account sheet and menu: name, email, app menu, theme switch, sign out. `registry/app-shell/account.tsx`.
- `shell-back` one Back manager for point mode, sheets, the agent layer and list-detail stacks. `registry/utils/back.ts`.
- `shell-dense-targets` 44px touch targets under 640px or on a coarse pointer, opt out with `data-dense`. `registry/README.md` section Agent layer.

## How to get to it (user POV)

- Open any app that mounts `<AppShell layout=... />`; the example is `examples/app-shell/page.tsx`.
- Resize between phone and desktop widths; the same screens stay mounted.

## Driving it with the app-shell journeys

Preconditions: `npm ci`, Chromium available, a built kit (`npm run build`).

- **Layouts.** `shell-layouts`: `npm run app-shell:journey` (screen) and `npm run app-shell:journey:workspace` (workspace). The sidebar is open in `screen` and the icon rail in `workspace`.
- **Navigation.** `shell-nav`: at 390px the tab bar shows four items; at desktop width the sidebar shows labels.
- **Header and Back.** `shell-header`, `shell-back`: open a detail on a phone, press Back, the list returns with its scroll kept.
- **List and detail.** `shell-list-detail`: select a row; both panes wide, detail only on a phone.
- **Account.** `shell-account`: open the avatar button (`account-button`), toggle the theme switch (`account-theme`).
- **Targets.** `shell-dense-targets`: measure buttons at 390px; none under 44px outside `data-dense`.
- **Proof.** An ARIA snapshot and a screenshot per width under `.cache/evidence/<journey>/`, tagged with the ID.

## Gotchas

- Every screen stays mounted, hidden when not on show: state survives, effects keep running.
- `layout="chat"` with an `agent` prop throws on purpose.
- Never edit an installed block; `boring-ui-blocks check` fails on edited copies.
