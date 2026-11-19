# Ambient agent

`pi-ambient` puts an agent beside an existing site: a compact floating bar bottom right, the host page stays usable under it.

**Status (deprecated).** The floating bar is the one composer (`FloatingComposer`, [app-shell](app-shell.md) `shell-composer-standalone`). `AmbientChat` is a wrapper with the same props: when every prop is one the composer takes it renders `FloatingComposer`; a prop in the gap list below keeps the bar on the old window (`registry/pi-ambient/ambient-window.tsx`). Which one is chosen is `ambientGap(props)` in `ambient.tsx`. The old window goes when no app is left on it.

**Gap list** (props that keep the old window): `embedded`, `artifactPanel`, `artifacts` (cards and host task presentation), `headerTools`, `headerActions`, `onDock`, `onOpenFull`, `onFeedback`. Carried to the composer (no longer a gap): `className` (the floating frame, the folded icon, the bottom bar of a wide window), `storage` (`session` default as the old bar, `local`; the place and the position), the old drag position (`boring.ambient.position`, or `storageKey`: read once, written as the bar's own place), `autoDismissMs` and `maxToasts` (the notices' fade and queue), `systemNotifications` (a notice offers the browser permission, then a system notification for each toast while the page is hidden), `renderComposer` and `composerLayout` (through `chatProps`), the working state (a ring pulses round the folded icon; the placeholder while working is `placeholderWorking`, `labels.working(seconds)` is not called because the bar's own card says « Working · task »). A controlled `state` the host does not take (no `onStateChange`, or it keeps its value) snaps back to the host's value after 150 ms. Not carried: the pill's own status icon (the icon has the unread mark, the needs-you ring and the working ring).

## Sub-features

- `ambient-bar` bar, expanded window and minimised pill over one controller, draggable, position remembered. On the composer: the floating bar, the window above it and the round icon (`composer-floating`, `composer-icon`), `onStateChange` and a controlled `state` as `bar`, `expanded`, `minimized`, the place remembered per app (`storageKey` is the app id). `registry/pi-ambient/ambient.tsx` (the bridge), `registry/app-shell/floating-composer.tsx`; the old window in `ambient-window.tsx`.
- `ambient-phone-grabber` on a phone the ambient bar has no strip and no drag: a grabber on its top edge (`ambient-grabber`, a 44px target) is the size control (a tap opens the full window, whose minimize goes back; it straddles the bar's top edge so it never covers a header control), and the composer's action buttons (attach, commands, send, stop, dictate: by their kit test ids) are circles with the kit's round token, as the app shell bar's are, on a phone and on a computer. `registry/pi-ambient/ambient.tsx`.
- `ambient-slash` the ambient bar's `/` menu is the one grouped list (`composer slashList`): Commands, Skills and Actions under headings with a kind icon per row, the field as the search, and a Commands button on touch screens. `registry/pi-ambient/ambient.tsx`, `registry/pi-chat/composer.tsx`, `registry/pi-chat-slash/slash-menu.tsx`.
- `ambient-jump-latest` scrolled up, the down arrow sits in its own row under the messages and covers no text; it scrolls back to the end. `registry/pi-ambient/ambient.tsx`.
- `ambient-notifications` toasts for background conversations and tasks (`createNotificationStore`, `watchConversation`). On the composer they are its notices (`FloatingComposer notices`, `data-testid=notice`, action « Open »: opens that conversation), one at a time, a question stays until dismissed. `registry/pi-ambient/notifications.tsx`, `ambient.tsx`.
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
- **Notifications.** `ambient-notifications`: the journey's background task raises a toast (old window); on the composer `node --test test/contracts/ambient-composer.test.mjs` pushes a notification into the store: the notice stands above the bar (1440) or above the field (390), Open brings the conversation, a question stays.
- **On the composer.** `ambient-bar`: `CHROMIUM=... node --test test/contracts/ambient-composer.test.mjs` (fixture `test/fixtures/themes/ambient-composer.jsx`) at 1440 and 390, light and dark: the floating bar, the state callback and the controlled state, the notice, and `?gap=1` (`onOpenFull`) keeping the old window. Shots in `.cache/evidence/ambient-composer`.
- **Gap props on the composer.** `ambient-bar`: `CHROMIUM=... node --test test/contracts/ambient-composer-gaps.test.mjs` (fixture `test/fixtures/themes/ambient-composer-gaps.jsx`, every option a query parameter) at 1440 and 390, light and dark: `className` on the frame and the icon, `storage`, the old drag position migrated once, `autoDismissMs` and `maxToasts`, `systemNotifications` over a fake `Notification`, `renderComposer` and `composerLayout`, the working ring on the folded icon, the model pill not truncated in the narrow bar, a controlled `state` the host ignores. Shots in `.cache/evidence/ambient-composer-gaps`.
- **Browser notify.** `ambient-browser-notify`: grant the permission in the journey page; a notification fires when hidden.
- **Artifacts.** `ambient-artifacts`: click an artifact card; the window widens with the panel.
- **Host task presentation.** `ambient-task-present`: set `artifacts.autoOpenTasks: true` with `artifactTarget="host"` to request the host viewer while native present waits (default remains manual). `npm run task-board:journey` sends actual native ambient prompts, defers mounting to prove no early success, then checks task/list mount reports, denied/missing failures and mounted phone-task success. Task hosts decide their own narrow-screen availability; the existing file-sheet guard remains file-only. File auto-open is unchanged. `node --test test/packages/agent-view-open.test.mjs` drives the native tool and authenticated answer transport without a workspace. `node --test test/ui/ambient-position.test.mjs` opens a task card through the actual Ambient host callback; only `onShown({ subject })` confirms it, and `onFailed({ subject, reason })` refuses it. The task-board journey is the composed browser driver.
- **Proof.** Screenshot per state and the conversation read after reload.

## Gotchas

- On a phone inside an `AppShell` it is never the overlay: the shell's layer is the one drawer.
- `storage="local"` keeps the position across sessions; the default is session.
- A task descriptor grants no access or mutation permission. The host loads authorized records before reporting a mount, reports cleanup with `hidden: true`, and treats `unconfirmed` as unknown presentation, not failure or completion of the task.
