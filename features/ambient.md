# Ambient agent

`pi-ambient` puts an agent beside an existing site: a compact floating bar bottom right, the host page stays usable under it.

## Sub-features

- `ambient-bar` bar, expanded window and minimised pill over one controller, draggable, position remembered. `registry/pi-ambient/ambient.tsx`.
- `ambient-phone-grabber` on a phone the ambient bar has no strip and no drag: a grabber on its top edge (`ambient-grabber`, a 44px target) is the size control (a tap opens the full window, whose minimize goes back; it straddles the bar's top edge so it never covers a header control), and the composer's action buttons (attach, commands, send, stop, dictate: `data-composer-action`) are circles with the kit's round token, as the app shell bar's are, on a phone and on a computer. `registry/pi-ambient/ambient.tsx`.
- `ambient-slash` the ambient bar's `/` menu is the one grouped list (`composer slashList`): Commands, Skills and Actions under headings with a kind icon per row, the field as the search, and a Commands button on touch screens. `registry/pi-ambient/ambient.tsx`, `registry/pi-chat/composer.tsx`, `registry/pi-chat-slash/slash-menu.tsx`.
- `ambient-jump-latest` scrolled up, the down arrow sits in its own row under the messages and covers no text; it scrolls back to the end. `registry/pi-ambient/ambient.tsx`.
- `ambient-notifications` toasts for background conversations and tasks (`createNotificationStore`, `watchConversation`). `registry/pi-ambient/notifications.tsx`.
- `ambient-browser-notify` optional browser notifications. `registry/pi-ambient/browser-notify.ts`.
- `ambient-artifacts` an artifact opens inside the window (`artifactPanel`) or in the host (`artifactTarget="host"`). `registry/pi-ambient/ambient.tsx`.
- `ambient-task-present` native `present({ task })` or `present({ tasks: { filter } })` opens an authorized host record viewer; its mount/failure reports acknowledge the exact task reference, without a workspace or fabricated file revision. `packages/agent/src/artifacts.ts`, `packages/ui/src/chat-artifacts.ts`, `registry/pi-artifacts/artifact.ts`, `registry/pi-ambient/ambient.tsx`.

## How to get to it (user POV)

- The floating bar on a host page; expand it from the title, minimise to the pill.

## Driving it with the example journeys

Preconditions: `npm run build`, Chromium.

- **Phone and `/`.** `ambient-phone-grabber`, `ambient-slash`: `CHROMIUM=... node --test test/ux-ambient.test.mjs` (390 and 360: no strip, the grabber taps bar and full window, round 44px buttons; 1440 and 390: `/` shows three headings, `/exp` leaves the action, the Commands button opens the menu on touch).
- **Bar.** `ambient-bar`: `npm run ambient:journey` (or `ambient:journey:scripted` without a model): type, expand, minimise, drag, reload; position and conversation persist.
- **Jump to latest.** `ambient-jump-latest`: the scripted journey scrolls the expanded window up, checks the arrow is outside the messages' box, clicks it and is back at the end (`06b-scrolled-up.png`).
- **Notifications.** `ambient-notifications`: the journey's background task raises a toast.
- **Browser notify.** `ambient-browser-notify`: grant the permission in the journey page; a notification fires when hidden.
- **Artifacts.** `ambient-artifacts`: click an artifact card; the window widens with the panel.
- **Host task presentation.** `ambient-task-present`: set `artifacts.autoOpenTasks: true` with `artifactTarget="host"` to request the host viewer while native present waits (default remains manual). `npm run task-board:journey` sends actual native ambient prompts, defers mounting to prove no early success, then checks task/list mount reports, denied/missing failures and mounted phone-task success. Task hosts decide their own narrow-screen availability; the existing file-sheet guard remains file-only. File auto-open is unchanged. `node --test test/packages/agent-view-open.test.mjs` drives the native tool and authenticated answer transport without a workspace. `node --test test/ui/ambient-position.test.mjs` opens a task card through the actual Ambient host callback; only `onShown({ subject })` confirms it, and `onFailed({ subject, reason })` refuses it. The task-board journey is the composed browser driver.
- **Proof.** Screenshot per state and the conversation read after reload.

## Gotchas

- On a phone inside an `AppShell` it is never the overlay: the shell's layer is the one drawer.
- `storage="local"` keeps the position across sessions; the default is session.
- A task descriptor grants no access or mutation permission. The host loads authorized records before reporting a mount, reports cleanup with `hidden: true`, and treats `unconfirmed` as unknown presentation, not failure or completion of the task.
