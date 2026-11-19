# Notifications at the composer

How an app and the kit tell the person something at the composer, in five patterns from the quietest to the loudest, each with one job: a dot or count on the notch, one notice above the bar, a short status in the field, the bar that needs the person, and the same on a phone. The platform decides what is worth a notice; the kit only draws it. Not here: push outside the page, a notification centre, sound, per-user settings.

## Sub-features

- `notify-unread` a reply that ends while the conversation is folded keeps a dot on the notch (on a phone, beside the grabber's pill); from the second reply a 32x16 info pill with the number sits beside the chevron (which does not move). It outlives the next run and clears when the conversation opens. `useAgentBarChat` returns `historyBadge: { label, count }`. `registry/agent-bar/use-agent-bar-chat.ts`, `registry/app-shell/agent-bar-parts.tsx` (`ConversationChevron`).
- `notify-collapsed-results` every result the agent produces while the composer is collapsed tells the person something: a final message, a turn of tools with no closing text (the card names what it used), a failed turn (the unread mark, so the round icon carries it too, and the card's failure line on the bar), a decision (the ring), a host notice. Checked at every collapsed place (bottom bar, floating bar, round icon, phone bar and icon, standalone `FloatingComposer`). `registry/agent-bar/use-agent-bar-chat.ts` (`reply`, `failed`, `historyBadge`), `registry/app-shell/agent-bar-parts.tsx` (`FoldedCard`).
- `notify-notice` `AppShell notices={[{ id, kind: 'info' | 'success' | 'warning' | 'error', text, action?, onDismiss?, reference? }]}` (newest first): ONE notice shows at a time above the bar, in the screen column's flow (`data-testid` `notice`, `notice-text`, `notice-action`, `notice-dismiss`; `role="status"`, `aria-live="polite"`, `data-notice-kind`). `info` is the plain card, the others take the kit's soft success, warning and destructive tokens. It never opens the conversation and takes no focus. `registry/app-shell/shell-notice.tsx`, `registry/app-shell/app-shell.tsx`.
- `notify-queue` the others wait behind it as « N more waiting » (`notice-more`; « N en attente »); dismissing, the fade or a swipe shows the next, never two bars. At most 5 wait: past that the oldest (last) info or success goes, a warning or an error is never dropped (`capNotices`). The host hears each dismiss in `onDismiss`; a dismiss holds for the `id` until the list drops it.
- `notify-fade` info and success fade after 8 s unless hovered or focused (the clock restarts when the pointer or focus leaves); warnings and errors stay until dismissed. A notice's action does not dismiss it: the host removes the notice when it is done.
- `notify-reference` warning and error notices with `reference: '@kind:id'` carry the same small « @ Reference in agent » as a table row (`notice-reference`, `talkAbout` with `add`); it shows only when the agent's chat has `mentions`.
- `notify-phone` at 390 and 360 every notice button is at least 44 px; the notice rises above the one composer's peek and sits in the flow above the tab bar; a swipe left dismisses (touch and pen, a quiet shortcut: no hint text, the X is always there; a swipe right does nothing).
- `notify-update` `AppShell update` is one entry of the same queue (an info notice that never fades, last in the list); its test ids (`update-notice`, `update-reload`, `update-dismiss`) and look are unchanged. `registry/app-shell/update-notice.tsx` (`updateNotice`).
- `notify-needs-you` while a decision (an approval or a question) is on the folded card, the whole bar takes a warning border and a soft ring and the card carries `data-needs-you`; no tray opens, the ring goes with the decision. `registry/app-shell/agent-bar-parts.tsx` (`NEEDS_YOU`), `registry/app-shell/agent-compact.tsx` (the phone's sheet).
- `notify-field-status` `useAgentLayer().status(text)` shows a short status in the field in place of the placeholder, for 3 s or until the person types; the kit calls it when table rows are referenced (« 1 referenced »). A host calls it for its own (« Draft saved »). `registry/app-shell/agent-layer.tsx`, `registry/app-shell/agent-chats.tsx`.
- `notify-play` the showcase design-system page's Play menu has a Notifications group (info, success, warning, error, needs you); the scenario's `try` items take a `group`. `ux/scenarios/component-design-system.json`, `ux/fixtures/design-system.jsx`, `ux/runner/site-page.mjs`.

## How to get to it (user POV)

- On the showcase's design-system page, open Play and pick an item of the Notifications group; switch Phone and Desktop and the theme.
- In an app, pass `notices` to `AppShell`; a reply that finishes while the conversation is folded shows the dot or count by itself.

## Driving it with the one-composer and showcase tests

- `notify-unread`: `CHROMIUM=... node --test --test-name-pattern="AC-1" test/contracts/one-composer.test.mjs` (1280 and 390: one reply is a dot, two a count, opening clears it).
- `notify-collapsed-results`: `CHROMIUM=... node --test test/contracts/collapsed-results.test.mjs` (eight collapsed places, eight kinds of result, a notice, the clear on open; fixture `test/fixtures/themes/collapsed-results.jsx`).
- `notify-notice`, `notify-queue`, `notify-fade`, `notify-reference`, `notify-update`: `node --test test/contracts/app-shell-render.impl.mjs` (four notices of four kinds give one `role=status` and « 3 more waiting »; the cap; the fake clock; swipe; the `@`; the update test unchanged).
- `notify-phone`: the "a notice appears above the bar" test of `test/contracts/one-composer.test.mjs` (1440, 390 and 360: one notice, no tray, focus unmoved, 44 px buttons, not under the tab bar).
- `notify-needs-you`: the "AC-6" test of the same file (approval and form, 1280 and 390).
- `notify-field-status`: the "a status replaces the placeholder" test of the same file and `test/ux-table-references.test.mjs` (« 1 referenced »).
- `notify-play`: `CHROMIUM=... node --test test/ux-site-play.test.mjs` (the five items, light and dark, 1440 and 390; shots in `.cache/evidence/composer-content/notifications-play-*`).

## Gotchas

- A notice is not a toast: it takes room in the column, it is never stacked and it never moves focus. Use the folded card for a decision, not a notice.
- `notices` is controlled by the host but a dismiss also hides at once, so a host that forgets to drop the entry does not trap the person behind it.
- The phone's needs-you ring is subtle (the sheet is full width, so the warning border shows at its corners); the card's own header says what waits.
- Copied and attached have no kit hook for the field status; a host calls `status` itself.
