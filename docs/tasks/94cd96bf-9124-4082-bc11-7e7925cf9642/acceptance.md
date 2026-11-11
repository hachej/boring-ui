# D-2198 · One composer for every Boring app: acceptance

Contract yes: Julien, 2026-11-11, on the mockup https://claude.ai/artifact/MJL8p84U32asDZ1TRQKeJL (version 14; sources in `mockup/`).
Decisions: D1 above the phone tabs · D2 one action button · D3 edit last the Claude Code way · D4 Ouvert ~30 %, Agrandir 70 % · D5 tap dictates, hold sends on release · D6 no target in the field, the assistant relays · D7 one right column.

"Row c-n" is row n of the composer page, "row l-n" row n of the layout page. Every line is checked in a real browser on the kit's AppShell fixture with a scripted agent, at 1280 (fine pointer) and 390 (touch), light and dark.

## The composer

- AC-1: Exactly one message field in the DOM in every state and placement below. The shell owns it; no block or app draws a second one (the page `AgentBar` and D-2203's composer are replaced by it).
- AC-2: One row: conversation chevron, attach, the field, one action button. No « + » menu and no Actions button. An empty field is one line; a long placeholder is cut with « … », never wrapped. (c-1)
- AC-3: The action button is « Dicter » with an empty field, « Envoyer » with text or a file, « Arrêter » while the agent works, in the same place and size. (c-1, c-2, c-5)
- AC-4: Enter sends on a fine pointer, Shift+Enter is a new line; on touch Return is Envoyer. The field grows upward to 6 lines, then scrolls inside; the buttons stay on the last line. (c-2)
- AC-5: Files dropped on the content, pasted or attached show as chips inside the box, above the text. Uploading shows a spinner and holds Envoyer; a file alone can be sent; ✕ removes; a tap on a chip opens its preview (AC-18, AC-19). (c-3)
- AC-6: « / » typed in the field opens the app's actions above the box: typing filters, ↑ ↓ moves, Enter picks, Échap closes and keeps the text. (c-4)
- AC-7: Folded while the agent works, a card inside the same box shows the running tool's words and its published progress (« Lecture releve-janvier.pdf · 12 lignes sur 40 »), never « En cours ». Arrêter stops the run. (c-5)
- AC-8: A question shows in the box with its choices. A form asks each question in turn (« 1 sur 2 », then « 2 sur 2 » with the first answer) and sends all answers together; no question is answered « Pas de réponse ». Text typed in the field answers in the person's words. (c-6)
- AC-9: A reply while folded does not open anything. It shows in the box as « ✓ Terminé · <what it used> », 3 clamped lines and its cited files as chips showing the file name (never the raw `@path`). A dot on the chevron stays until the conversation is opened. (c-7)
- AC-10: A tap on Dicter shows ✕, a waveform and ■, with the words above as they come; ■ puts the final words in the field for review; ✕ sends nothing. (c-8)
- AC-11: Held past 300 ms, Dicter shows « Relâche pour envoyer » and a waveform with the live words; release sends at once and opens Ouvert with the bubble and Arrêter; sliding more than 24 px off, Échap or a hidden page cancels and sends nothing. On every app, phone and desktop. (c-9)
- AC-12: A failed send puts the text back in the field, says what to do on one line above the box, and Réessayer sends it again. (c-10)
- AC-13: Read only (a role that may only read, or no agent): the box stays in place with one line giving the reason; nothing in it can be focused. (c-11)
- AC-14: Edit last (D3): ↑ in an empty field recalls earlier messages as a draft (sent as a new message); ↑ or Échap pulls a message queued during a run back into the field; Échap stops a run; Échap twice lists the person's messages, and picking one forks the conversation at it (the old branch is kept) with that message in the field. On touch: a long press on an own message offers « Reprendre » and « Revenir ici ». (c-12)

## The layout

- AC-15: At rest (Ambiant) the field is at the bottom centre of the content column, at most 720 px wide. The page's own scroll ends above the composer stack (its bottom room equals the stack's live height); the sidebar never moves. (l-1)
- AC-16: Ouvert is one box with one clean border around the thread and the field, at the field's width (max 720 px, centred), never the page's width. The thread takes about 30 % of the height, Agrandir 70 %; the page shrinks above it and is never covered; Échap or the chevron folds it. (l-2)
- AC-17: Ancré moves the thread and the field together to a full-height right column (~380 px); nothing stays at the bottom. « Détacher en bas » goes back to Ouvert, Fermer to rest. (l-3)
- AC-18: Not docked, an opened file, artifact or task detail takes the right column (`useAgentLayer().preview`, the app draws the content); the conversation stays above the field. (l-4)
- AC-19: Docked, an opened file, artifact or task detail stacks on top of the conversation in the same column, under « ← Assistant / <name> »; the arrow goes back to the thread; the field stays at the bottom of the column with the file as a chip. (l-5)
- AC-20: Phone (390): the composer sits above the bottom tabs with the home-bar inset under them; with the keyboard up the tabs hide, the box sits on the keyboard and the text keeps at least 140 px; Ouvert takes about half the screen with the tabs kept; Ancré is full screen with the tabs hidden. The open drawer uses the same one-row composer. (l-6, l-7)
- AC-21: Kit tokens only (light and dark), visible focus, 44 px targets on touch, every word a French default the app can override. (l-8)
- AC-22: No target in the field (D6): « Discuter » or `talkAbout('@D-2219')` puts the task as a mention chip in the one field and the message goes to the app's assistant, which relays to the worker and answers in the same thread. The kit adds no second conversation or field for this. (l-9)

## Consumers and proof

- AC-23: `composer="content"` and `"dock"` behave as before, or MIGRATING.md gives each change; Compta (`assistant-bar.tsx`) and Coach Max (`max-composer.tsx`) each get a migration note to delete their own bar and pass their words, actions, voice and preview through the shell.
- AC-24: A proof artifact (claude.ai), linked in the pull request: for every row of both mockup pages, the expected frame (the mockup) and the delivered screenshot (CI, real kit) side by side, light and dark, 1280 and 390, so they compare at a glance. A row that differs says how.
