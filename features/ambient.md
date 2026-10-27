# Ambient agent

`pi-ambient` puts an agent beside an existing site: a compact floating bar bottom right, the host page stays usable under it.

## Sub-features

- `ambient-bar` bar, expanded window and minimised pill over one controller, draggable, position remembered. `registry/pi-ambient/ambient.tsx`.
- `ambient-notifications` toasts for background conversations and tasks (`createNotificationStore`, `watchConversation`). `registry/pi-ambient/notifications.tsx`.
- `ambient-browser-notify` optional browser notifications. `registry/pi-ambient/browser-notify.ts`.
- `ambient-artifacts` an artifact opens inside the window (`artifactPanel`) or in the host (`artifactTarget="host"`). `registry/pi-ambient/ambient.tsx`.

## How to get to it (user POV)

- The floating bar on a host page; expand it from the title, minimise to the pill.

## Driving it with the example journeys

Preconditions: `npm run build`, Chromium.

- **Bar.** `ambient-bar`: `npm run ambient:journey` (or `ambient:journey:scripted` without a model): type, expand, minimise, drag, reload; position and conversation persist.
- **Notifications.** `ambient-notifications`: the journey's background task raises a toast.
- **Browser notify.** `ambient-browser-notify`: grant the permission in the journey page; a notification fires when hidden.
- **Artifacts.** `ambient-artifacts`: click an artifact card; the window widens with the panel.
- **Proof.** Screenshot per state and the conversation read after reload.

## Gotchas

- On a phone inside an `AppShell` it is never the overlay: the shell's layer is the one drawer.
- `storage="local"` keeps the position across sessions; the default is session.
