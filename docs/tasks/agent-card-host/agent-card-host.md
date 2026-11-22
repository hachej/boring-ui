---
id: agent-card-host
title: The kit's agent-card takes the host's own header and body, a place inside them for its tray, and a chat made on the first tap
type: feature
state: in review
requester: julien
created: 2026-11-22
features: agent-card
waiting_on:
closed_reason:
live_commit:
live_at:
---

# The kit's agent-card takes the host's own header and body, a place inside them for its tray, and a chat made on the first tap

Serves: every app that puts a chat on its own cards (boring-studio's task cards first, `board-process/card-chat`, mirror card `tasks/blocks/agent-card-host.md` in hachej/boring-studio at b68fe29). Apps that can give their own card the kit's chat strip without drawing a second header or a chat of their own: from 0 to every app on the kit, starting with 1 (Studio).

Estimate: 1 day. Repository: `hachej/boring-ui`, branch `feat/agent-card-host` from `origin/main` 0761f37 (kit 0.5.19). Release is a separate step (the card does not release).

Cold review applied: 22 November 2026 (`/home/ubuntu/fleet/handoffs/cold-review-card-chat-2026-11-22.md`, « What the boring-ui card must contain »), plus Julien's choice on Q1: a quiet unread dot on a folded card, even before the chat has loaded.

## Acceptance

The block is `registry/agent-card/agent-card.tsx` (`features/agent-card.md`). Every prop below is optional: without them the card is today's and the existing assertions of `test/ux-agent-card.test.mjs` pass unchanged. All checks are in that file (the new test `the agent card on a host card`, at 390 and 1440) and in the scenario flows F5 to F11 of `ux/scenarios/component-agent-card.json`.

- AC-1: The host's own header and body. `header?: ReactNode` is drawn in place of the built-in header (the dot, the title, the status chip, the activity line) and is not a tap target of the card: a tap on it leaves `data-level` 0 and the host's own gesture runs; the tray opens only from the strip. `children?: ReactNode` is drawn under the header and `meta`, unstyled. `title` stays required: it is the card's accessible name (`role="group"`) and the whole chat's header title. Esc folds the card and returns focus to the strip's first cell, since there is no kit header to focus. check: auto how: test (no `agent-card-title` or `agent-card-header`, the host's header tapped logs « header tapped » once and the level stays 0, no chat opens, the card is named by its title, Esc leaves focus in `composer-controller`); flow F5, F8
- AC-2: A place for the tray. `slot?: HTMLElement | null`: when given, the folded card's composer and the tray (level 1) are drawn there through a portal, as `dock` is, so a host puts them under a card's lines; level 2, Dock and the strip stay where they are. When `slot` goes, they return under the header with their state kept: one element the card owns is moved, so the chat is not remounted and a draft is not lost. check: auto how: test (the composer inside `host-slot`, after `host-lines` in document order; the body closed, the composer under the header with the draft `The date is the 3rd`; reopened, in the slot again with the draft; the tray at level 1 in the slot); flow F7
- AC-3: Level 2 with a host header. The host's `header` stays on top, the whole chat takes the body's place (`children` and the slot's contents are not drawn) and Collapse gives the body back (to the tray, in the slot). Without a host header level 2 is today's. check: auto how: test (level 2: `host-header-toggle` present, `host-lines` absent, no built-in title; Collapse: `host-lines` and the tray in `host-slot` back); flow F8
- AC-4: A chat made on the first tap. `controller` is optional, with `onChatRequest?: () => void`. With no controller the strip shows only « Open the chat » (no Dock), whose tap calls `onChatRequest` once, however many taps come before the controller arrives; no `useAgentBarChat` and no `AgentChat` is mounted until then (the hook lives in an inner component mounted only with a controller). When the controller arrives the card opens the composer, in the slot if there is one. A board of thirty such cards makes no conversation. check: auto how: test (thirty cards: no `agent-chat`, no `composer-input`, zero conversations made; three taps on one card, one `chat requested 0`; on the host card one tap makes one conversation and the composer opens in the slot, the strip becomes Collapse, Expand, Dock); flow F6, F11
- AC-5: A controlled composer. `composer?: boolean` and `onComposerChange?: (open: boolean) => void` control the folded card's composer (the chat bubble's step), so a host gesture can open it. Without them the card keeps its own state. check: auto how: test (the host's « Not right » opens the composer, asks for the chat when there is none, and the card reports `composer closed` when Collapse is tapped); flow F10
- AC-6: Docked marker. With a host `header`, « Docked » shows right under it while the chat is docked (`agent-card-docked`), because the built-in header that holds it today is not drawn. check: auto how: test (`at=host:d`: `data-level` docked, one `agent-card-docked`, the strip is Undock only)
- AC-7: A quiet unread dot, before any chat. `unread?: boolean`: a folded card (level 0, not docked) shows the strip's unread dot, in the primary colour, with no count and no red, even when there is no controller; its accessible name is `labels.unread` (« New reply »). It adds no chat and no request. The host clears it. With a controller the chat's own dot and count are unchanged. Julien's choice, 22 November 2026. check: auto how: test (one `agent-bar-unread` on the card with the flag, empty text, no `data-count`, class `bg-primary`, none on a card without it, no `agent-chat` on it); flow F9
- AC-8: Unchanged without the props, phone first. The five states and the task card behave as today and the existing assertions pass unchanged; on touch each strip cell keeps its 44 px hit area; no sideways scroll at 390 px, in light and dark; the strict design zone holds (no raw `<button>`, no `border`, no `rounded-lg`). check: auto how: `node --test test/ux-agent-card.test.mjs` (the two original tests untouched), `node ux/runner/cli.mjs check --target component:agent-card` (390 and 1440, touch target 44), `npm run check` (block lint, hooks and design rules)
- AC-9: Map and release. `features/agent-card.md` has the sub-features `agent-card-host-header`, `agent-card-slot`, `agent-card-lazy`, `agent-card-composer-control` and `agent-card-unread`, each with its driving step; the scenario has host cards (header, `children`, `slot`, no controller until the first tap) and a fixture that logs what the host saw; `migrating/agent-card-host.md` carries the bullet; the registry item `agent-card` is rebuilt (`public/r`). The block ships in the next kit version (a separate release, not done here) and `npx boring-ui-blocks add agent-card` installs it in a fresh app that type-checks with the new props and passes `boring-ui-blocks check`. check: auto how: `npm run check`, `npm run registry:build`, the consumer install of this branch's registry in a fresh app (see the Report)

## Out of scope

- A release, a version bump, a deploy. Studio's own change (`board-process/card-chat`) and its kit bump.
- An input of the card's own, a Stop or Retry button, a count of unread replies: the chat stays the kit's, and the dot stays a dot.
- Telling the host that the person looked: the host clears `unread` itself (from `onChatRequest` or `onLevelChange`).

## Research

- Why Studio cannot use the block as it was: its built-in header would draw the host's title twice and its tap opens the tray where the host's opens the card; `meta` is one line of small muted text, not a body; the tray always unfolded under the header; a required `controller` meant one open conversation per card on a board of thirty.
- The chat's unread state (`historyBadge`, `markRead`) lives in `useAgentBarChat`, which needs a controller, so with the conversation made on the first tap a folded card could not show a reply that came while the person was away. Hence `unread`, a plain flag the host knows from its own data.
- A hook cannot be skipped: the hook moved into an inner component (`BarProbe`) mounted only with a controller, reporting its result to the card by a layout effect (the card's other state and the host's `children` are never remounted when the controller arrives). The tray is one element the card owns and moves between the slot and its place under the header, so a slot that comes and goes does not remount the chat.

## Decisions

- 2026-11-22 julien via conductor: Studio's card chat reuses the kit's `agent-card` and its chat, with no input of its own.
- 2026-11-22 julien: Q1, a quiet unread dot on a folded card when a reply came while the person was away, even before the chat has loaded (a flag, not a count; no red).

## Questions

## Notes

- 2026-11-22: the mirror card in boring-studio (`tasks/blocks/agent-card-host.md`) should add its lines 3 (level 2), 4 (once), 5 (composer control), 6 (Docked) and 7 (unread), as the cold review says; not done here.

## Recette

The agent's own proof is the Report below. The person's verdict (Julien reading the card on a phone, light and dark) is his.

## Report

See the pull request. Checks run under Node 22.22.1: `npm run check`, `npm run typecheck`, `node --test test/ux-agent-card.test.mjs`, `node ux/runner/cli.mjs check --target component:agent-card`, the migration-note check, and the consumer install. Screenshots at 390 px, light and dark: `/var/tmp/agent-card-host-shots/`.
