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
| App shell | layouts, navigation, headers, list and detail, account | [app-shell.md](app-shell.md) |
| Agent layer | the shell's agent drawer and dock, voice, launch links, context | [agent-layer.md](agent-layer.md) |
| Chat | `pi-chat`, composer features, cards, mentions, conversations | [chat.md](chat.md) |
| Agent workspace | `pi-app`, embedded and placed workspaces, Library, viewers | [agent-workspace.md](agent-workspace.md) |
| Ambient agent | the floating bar over an existing site, notifications | [ambient.md](ambient.md) |
| Shared chat | the room: people and agents in one conversation | [shared-chat.md](shared-chat.md) |
| Feedback | comment mode, pins, reports | [feedback.md](feedback.md) |
| Packages | agent, files, execution, ui kit and the `boring-ui-blocks` CLI | [packages.md](packages.md) |
| Viewer utilities | shared phone breakpoint, media/keyboard viewport and local layout persistence | [viewer-utilities.md](viewer-utilities.md) |
| Task board | business requests, responsive detail, compact own-request rows and shared request cards | [task-board.md](task-board.md) |
