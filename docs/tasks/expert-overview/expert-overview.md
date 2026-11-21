---
id: expert-overview
title: The expert-overview block shows a person at most three things that need them, one quiet line per app and a four-step track, from data the app passes in
type: feature
state: backlog
requester: julien
created: 2026-11-21
features: expert-overview, expert-overview-track, expert-overview-calm
waiting_on:
closed_reason:
live_commit:
live_at:
---

# The expert-overview block shows a person at most three things that need them, one quiet line per app and a four-step track, from data the app passes in

Serves: every app whose domain expert has little time to give (boring-studio's « For you » page first, `tasks/board-process/for-you.md` in hachej/boring-studio, mirrored there as `tasks/blocks/expert-overview.md`). Apps that can show this overview without drawing it themselves: from 0 to every app on the kit. Things the block shows as needing the person at once: at most 3, whatever the app passes.

Depends on: nothing. Estimate: 1.5 days: the two components and their words 0.75 day, the render test and the scenario (390 px, light and dark) 0.5 day, the feature map, the migration note and the release 0.25 day.

Repository: `hachej/boring-ui`, branch `blocks/expert-overview` from `origin/main`. Released in the next kit patch after the merge (owner's standing authorization of 18 November: a patch release after each merged green block PR).

## Acceptance

- AC-1: A registry item `expert-overview` (`registry.json`, type `registry:component`, files `registry/expert-overview/expert-overview.tsx` and, if the builder splits it, `registry/expert-overview/expert-track.tsx`, targets under `components/expert-overview/`), `dependencies` `react@^19.0.0` only, `registryDependencies` other kit items only (`@boring-ui/utils`, `@boring-ui/_shared`, `@boring-ui/touch-floor`, and `@boring-ui/list-row` if its row is reused). Its shadcn imports are within `SHADCN_BUILTINS` (`button`, `collapsible`, `item`, `card` at most). It exports `ExpertOverview`, `ExpertTrack`, their prop types and `expertOverviewLabels` (English defaults, overridable per key like `inlineQuestionLabels`). Props only: the block fetches nothing, reads no clock, stores nothing, and calls back. check: auto how: npm run check (check-registry-blocks, check-block-lint, check-block-hooks); node --test test/ui/expert-overview.test.mjs (no `fetch`, no `Date.now` and no storage access while rendering, counted as `test/ui/attention-blocks.test.mjs` counts them)
- AC-2: The data shape, as data, in the app's words. `steps` is exactly four `{ id, label }` (the app's words, for Studio Framed, Proven, Rehearsed, Accepted); any other length is refused with an `Error` naming `steps`. `ExpertOverview` takes `{ heading, intro?, steps, needsYou: ExpertItem[], apps: ExpertApp[], done?: ExpertDone, calm?: { heading, text }, labels? }`. `ExpertItem` is `{ id, text, time?, action: { label, onAction }, later?: { label?, onLater } }`: one sentence, its time line (« 4 points to look at · about 20 min »), one gesture, and on a question only, an optional quiet « Later ». `ExpertApp` is `{ id, name, line, unreadable?, onOpen? }`: one line per app (« 3 features · next for you: Thursday »), a button only when `onOpen` is given, and `unreadable` shows the label `unreadable` (« Status unreadable »), never an empty line. `ExpertDone` is `{ label, items: { id, title, meta? }[], onOpenItem? }`, folded by default (« Done · 5 live this month », « Show »). `ExpertTrack` takes `{ title, subtitle?, steps, note?, features: ExpertFeature[], done?, extra?: { label, onAction }, onBack?, labels? }`, with `ExpertFeature` `{ id, title, status, reached: 0 | 1 | 2 | 3 | 4, turn: 'person' | 'agents' | 'nobody', line?, action?: { label, onAction } }`. The block never builds a sentence, a count or a date: the app writes them. check: auto how: node --test test/ui/expert-overview.test.mjs (the planted fixtures of AC-3 to AC-5 render; three or five steps throw naming `steps`; a type test in the same file compiles the fixtures against the exported types)
- AC-3: The « For you » state (the mockup's board 1). Under `heading` and `intro`, the items of `needsYou` as quiet rows: a small dot in the warning tone, the sentence, the time line in muted text, the gesture as a text button of the kit (the whole row opens when the item has no `later`; a question shows its gesture and « Later » under the sentence). At most three rows: a fourth and later item is not rendered (the app orders them). No filled box, no border around an item, no badge, no count pill, no destructive colour anywhere in the block. Then the label `inProgress` (« In progress ») and one row per app, then `done` folded. check: auto how: node --test test/ui/expert-overview.test.mjs (five items render three, the first three; no element with `bg-destructive`, `text-destructive`, `badge` or `rounded-full` with a number in it; a question row has two buttons, any other row one; `done` is closed until « Show » is pressed); human how: recette step 1
- AC-4: The track state (the mockup's board 2). `ExpertTrack` shows `onBack` as « ‹ <back label> » (44 px), the title and subtitle, the four step labels in one row and `note` under them, then one row per feature: its title, its `status` on the right, the four-segment track and its `line`, and its `action` when given. Segment `i` (0 to 3) is filled with the foreground when `i < reached`, in the warning soft tone when `i === reached` and `turn` is `person`, in the muted foreground when `i === reached` and `turn` is `agents`, and in the border colour otherwise; `reached: 4` is all filled. Each segment is also said: the row carries an `aria-label` « <title>: <status>, step <n> of 4 », so colour is never the only sign. Then `done` folded and `extra` (« Something else is wrong ») as a quiet full-width button. Rows sit on the kit's flat card or are plain rows; no card inside a card. check: auto how: node --test test/ui/expert-overview.test.mjs (three features at `reached` 3 person, 1 agents and 1 agents, each segment's token class, the aria-labels, `extra` rendered only when given)
- AC-5: The calm state (the mockup's board 3). With `needsYou` empty, the block shows `calm.heading` (« Nothing needs you ») and `calm.text` in place of `heading` and `intro`, then the apps and `done` as in AC-3; with `needsYou` empty and no `calm`, it shows `labels.calmHeading` and no sentence. check: auto how: node --test test/ui/expert-overview.test.mjs
- AC-6: Phone, light and dark, the kit's rules. A scenario `ux/scenarios/component-expert-overview.json` over the fixture `ux/fixtures/component-expert-overview.jsx` (fictional data only: an app « Atelier », an app « Devis », invented titles) has the states `for-you`, `track` and `calm`, each also with `dark=1`, at viewports 390 × 844 (touch) and 1440 × 900, and a flow that presses « Show » on Done and « Later » on a question. Every state passes `fit:` (no sideways scroll) at 390, every gesture is at least 44 px high (`touchTarget: 44`, the `touch-floor` item), text contrast is at least 4.5:1 in both themes (`contrast:`), and nothing changes colour by a `dark:` class (the tokens do it). `boring-ui-blocks design` reports nothing on the block's files: tokens only, no literal colour or size, flat card, no nested card, Phosphor icons from `_shared` (`CaretRightIcon`), mono only on ids. check: auto how: node ux/runner/cli.mjs check --target component:expert-overview; npm run check (check-design, check-showcase-design, check-mono); human how: recette step 2
- AC-7: The map, the note and the release. `features/attention.md` gains `expert-overview`, `expert-overview-track` and `expert-overview-calm`, each with a driving step, and its gotchas say the app orders and cuts nothing but the block shows three at most, and writes every sentence, count and day itself; the « Needs-you blocks » rows of `features/README.md` name `ExpertOverview`. `migrating/<pr>-expert-overview.md` has its one additive bullet. A fresh consumer installs the item alone with `npx boring-ui-blocks add <registry>/expert-overview.json` and `npx boring-ui-blocks check` is clean; the release that ships it is named in the report. check: auto how: npm run check (check-features); BASE_SHA=$(git merge-base origin/main HEAD) HEAD_SHA=HEAD node scripts/check-release-notes.mjs; node scripts/test-registry-consumer.mjs

## Out of scope

- Fetching, ordering or computing anything: which items need the person, the four words' meaning, the minutes and the days are the app's (Studio's is `board-process/for-you`).
- A notice when something becomes ready (push, mail).
- Answering a question inside the block: « Reply » is a gesture the app handles (Studio opens the card); an inline answer is `InlineQuestion`'s.
- `SpaceCard`'s working and waiting counts: this block shows no count of agent work, by rule.

## Research

- The approved mockup (Julien, 21 November), canvas « Expert overview », three boards at 390 × 844: « 1 · For you (all apps) », « 2 · One app, the expert's track », « 3 · Nothing needs you ». Its rule note: « at most 3 things in « Needs you », each with its time and one button · everything agents do is one line per app, no detail unless opened · done is folded · no counts of agent work, no red badges · the board's own states (backlog → closed) never shown to the expert: only 4 words (Framed, Proven, Rehearsed, Accepted) ». Julien asked that the items be quiet and natural, not boxed alerts. In the mockup the items are rows with a hairline between them, an 8 px warm dot (`#B45309`, here the warning token), 15 px sentence, 13 px muted time line; the track's segments are 6 px high, filled `#171717`, current-agents `#A3A3A3`, the person's turn `#E8C9A6`, ahead `#EBEBEB`: each maps to a kit token (foreground, muted-foreground, the warning soft fill, border), no literal colour.
- What the kit already has: `InlineQuestion` and `StatusNarrative` (`features/attention.md`), `SpaceCard` and `WiringChips` (`features/space-overview.md`), `list-row`, `empty-state` and `page-header` (`features/patterns.md`). None fits alone: `SpaceCard` shows counts of agent work, `InlineQuestion` is an answer field, `empty-state` an icon and a call to action; the block may reuse `list-row` for its rows (the builder says in the pull request why, or why not).
- Conventions followed: a props-only pattern block like `registry/inline-question/inline-question.tsx` (labels with English defaults, `Partial` overrides, stable callbacks), tested by a render test under `test/ui/` like `test/ui/attention-blocks.test.mjs`, shown in the showcase by a component scenario like `ux/scenarios/component-people.json` (states with `dark=1`, `fit:` and `contrast:` reads, `touchTarget: 44`).
- The consumer: boring-studio is on `@hachej/boring-ui-kit` 0.5.10 and installs blocks with `npx boring-ui-blocks add` under `src/components/`, never edited; its « For you » page passes Studio's sentences and its four words.

## Decisions

- 2026-11-21 julien via conductor « approved this design »: the phone-first overview of the mockup, at most three items, quiet sentences, one line per app, done folded, no agent counts, no red badges, the four words.
- 2026-11-21 julien via conductor « a kit block »: the overview is a kit block in boring-ui that takes the four steps and the items as data, so any app can show it.

## Questions

## Notes

- 2026-11-21 conductor: written from the approved mockup for boring-studio's « For you » page. Defaults for review: « Later » exists only on a question, as in the mockup; a fourth item is dropped by the block, not counted. Cards only: nothing is built.

## Recette

The agent's own test, pasted in the report: `node --test test/ui/expert-overview.test.mjs`, `node ux/runner/cli.mjs check --target component:expert-overview`, `npm run check`, the consumer install of AC-7, then the full `npm test` once before the pull request. Fail-first: render four items with the cut at three removed and AC-3's test fails; give a segment a literal colour and `boring-ui-blocks design` names the line.

Julien's walk, on his phone:

1. Ouvre la page « Expert overview » du showcase en Phone, état `for-you` : tu dois lire au plus trois phrases calmes, chacune avec son temps et un seul geste (« Later » en plus sur une question), sans boîte colorée, sans pastille, sans rouge, puis une ligne par app et « Done » replié. (AC-3)
2. Passe en sombre, puis ouvre les états `track` et `calm` : rien ne déborde sur le côté, les quatre mots sont lisibles, chaque bouton se touche facilement. (AC-4, AC-5, AC-6)

Test script: written by the cold reviewer before the build, `~/fleet/evaluator/boring-ui/expert-overview/script.md`.

## Report
