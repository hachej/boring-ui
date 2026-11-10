# Conversation log

The sheet that opens from the agent bar's history arrow: a shadcn Drawer, not modal, above the bar, listing the conversation so far. The app owns the data and every word; the kit owns the sheet, the layout, the focus and the gestures. Registry item `conversation-log`.

## Sub-features

- `conversation-log-sheet` `<ConversationLog open onOpenChange entries labels />` opens a sheet titled `labels.title`, ending above the bar (measured from the bar's top when it opens, or `bottom`), starting `top` (4rem) below the window top. There is no overlay and no pointer dismissal: the bar stays usable and its arrow (`historyOpen`) flips and closes the sheet.
- `conversation-log-focus` focus moves to the close button on open and back to what had it (the arrow) on close, whether closed by the arrow, the close button or Escape.
- `conversation-log-entries` `entries` is `ConversationLogEntry[]`: `time` (centred marker), `user` (bubble on the right), `agent` (bubble on the left, with optional boxed `items` and `actions` buttons), `status` (`text`, and `state: 'done'` plus `label` for the check chip) and `question` (question and bold answer). The log opens on its latest entry.
- `conversation-log-labels` `labels` `{ title, close, empty }` have neutral French defaults; the close button is a 44px target on touch with an `aria-label`.

## How to get to it (user POV)

- Tap the history arrow in the agent bar: the log opens above the bar. Tap the arrow again, the close button or press Escape to close it.

## Driving it with the real browser test

- `node --test test/contracts/conversation-log.test.mjs` mounts `test/fixtures/themes/conversation-log.jsx` (fictional meals; the Coach Max wording is the fixture's props) at 390 touch and 1280 fine, light and dark. Tap `Historique`: the sheet opens (`conversation-log-sheet`), focus is on `Fermer l’historique` (`conversation-log-focus`), read `conversation-log` (`conversation-log-entries`); tap `Historique` again, press Escape, or tap the close button: it closes and focus is on the arrow. Shots land in `.cache/evidence/conversation-log` (CI artifact `conversation-log-shots`).
- Labels: pass `labels={{ title }}` in the fixture and read the sheet's title (`conversation-log-labels`); the close button's `aria-label` and 44px target are measured at 390.

## Gotchas

- The sheet is not modal: no overlay, the page and the bar stay usable, so the app must pass the same state to `onOpenChange` and the bar's `historyOpen`.
- The bottom edge is measured from the bar (`[data-slot="agent-bar"]`) when the sheet opens; pass `bottom` when the bar is not mounted.
