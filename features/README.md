# Feature map

What the kit does, one file per feature, with sub-feature IDs. Read this index first, then open the file for the feature at hand. Skills (`skills/`) point here for what exists and where; they do not repeat it.

Format (the pstack `create-verification-skill` shape, the same the apps use, see [boring-factory docs/TARGET.md section 7](https://github.com/hachej/boring-factory/blob/main/docs/TARGET.md)):

- Each feature file has an H1, one paragraph, then exactly four H2 sections: `Sub-features`, `How to get to it (user POV)`, `Driving it with <harness>`, `Gotchas`.
- A sub-feature is a bullet that starts with a kebab ID in backticks, then what it does and where the code lives. IDs are unique across the map and each appears in backticks in a driving step.
- Link code, never copy it. Prop tables stay in `registry/README.md`; behaviour evidence stays in `docs/implementation/FEATURES.md`.
- Rule: a change that adds or changes a feature updates its file in the same change. `npm run check` runs `scripts/check-features.mjs`, which fails on a broken file.

Harness for every file: the example journeys (`npm run <name>:journey`, headless Chromium, fictional data only). Evidence goes under `.cache/evidence/`.

| Feature | Covers | File |
| --- | --- | --- |
| Feedback | comment mode, pins, reports | [feedback.md](feedback.md) |
| App shell | layouts, navigation, headers, list and detail, account | [app-shell.md](app-shell.md) |
| Notifications | the notch's dot and count, one notice above the bar, the field's status, the bar that needs the person | [notifications.md](notifications.md) |
| Agent layer | the shell's agent drawer and dock, voice, launch links, context | [agent-layer.md](agent-layer.md) |
| UX harness | scenarios, capture, check, judge, loop and showcase for layouts and components | [ux-harness.md](ux-harness.md) |
| Chat | `pi-chat`, composer features, cards, mentions, conversations | [chat.md](chat.md) |
| Agent workspace | `pi-app`, embedded and placed workspaces, Library, viewers | [agent-workspace.md](agent-workspace.md) |
| Ambient agent | the floating bar over an existing site, notifications | [ambient.md](ambient.md) |
| Shared chat | the room: people and agents in one conversation | [shared-chat.md](shared-chat.md) |
| Spaces | switcher, members sheet and client for a host's shared spaces | [spaces.md](spaces.md) |
| Needs-you blocks | InlineQuestion, StatusNarrative, then SpaceCard | [attention.md](attention.md) |
| Needs-you blocks | InlineQuestion, then StatusNarrative and SpaceCard | [attention.md](attention.md) |
| Packages | agent, files, execution, ui kit and the `boring-ui-blocks` CLI | [packages.md](packages.md) |
| Agent host | the app definition (`defineApp`), its identity and rights rule | [host.md](host.md) |
| Drawing viewer | Excalidraw and draw.io files drawn by their own renderers, read-only | [drawing-viewer.md](drawing-viewer.md) |
| Viewer utilities | shared phone breakpoint, media/keyboard viewport and local layout persistence | [viewer-utilities.md](viewer-utilities.md) |
| Pattern blocks | KPI stat, list row, empty state, page header, data table | [patterns.md](patterns.md) |
| Space overview blocks | SpaceCard and WiringChips | [space-overview.md](space-overview.md) |
| Agent bar | AgentBar (field, mic, tap to listen, hold to talk, quoted chip) and AgentStatus | [agent-bar.md](agent-bar.md) |
| Agent card | `AgentCard` (one unit of agent work as a folding card with the composer's levels, dock, a decision on the folded card) and `AgentChat` (the default chat that fits any place) | [agent-card.md](agent-card.md) |
| Conversation log | ConversationLog, the sheet of the bar's history arrow (entries, labels, focus) | [conversation-log.md](conversation-log.md) |
| Atlas | the screens-and-states manifest, its schema and `atlas --check` | [atlas.md](atlas.md) |
| One model call | `complete`, `structured` and the `llm_structured` tool as a plain import | [cap-llm.md](cap-llm.md) |
| Transcription | `transcribe`, the `transcribeHandler` route, the kit's `transcribeClient` and the `transcribe` tool, as a plain import | [cap-transcription.md](cap-transcription.md) |
| Extraction | a PDF or a photo as text and checked fields, the `documents` OCR callback and the `extract_fields` tool, as a plain import | [cap-extraction.md](cap-extraction.md) |
| Sign-in | an app's sign-in by invitation, the first owner's one-use link, an assistant's OAuth sign-in to /mcp, Studio's owners in linked apps, and the pages | [signin.md](signin.md) |
| A decision | `run`, `pickOne` and the `decide` tool over pi-ai's classify, as a plain import | [cap-decision.md](cap-decision.md) |
