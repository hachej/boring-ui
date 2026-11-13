# Which kit release needs which pi-durable

The kit's packages are written against one pi-durable line at a time. Pi packages are peers: the app installs them, the kit does not bring them.

| Kit release | pi-durable, pi-ai, chord | Also needs |
|---|---|---|
| 0.4.x, up to 0.4.85 | 1.4 (`~1.4.0`) | `typebox` 1.3.27 for `@hachej/boring-agent/run-result` and `/actions` |
| 0.5.0 and later | 1.5.2 (`~1.5.2`) | `@earendil-works/pi-schema` `~1.5.2` for `@hachej/boring-agent` (and, optionally, `@hachej/boring-feedback`) |

## Rules

- **One release for every kit package.** `@hachej/boring-agent`, `-ui-kit`, `-files`, `-execution`, `-feedback`, `-browser` and `-testing` move together. A new agent package must ship with the ui-kit of the same release: the chat wire (`CHAT_TRANSPORT.version`, unchanged by the 1.5 move) is state, a view and then operation batches, and the client replays them with chord's `delta`, which must come from the same line as the host that sent them.
- **A pi-durable minor is a reviewed change** to `ARCHITECTURE.json` (`upstreamExportsVersion`, the exports the kit imports) first, then the manifests.
- **A store written by 1.4.0 opens on 1.5.2** with the same messages (`test/packages/agent-store-1.4.test.mjs`, fixture `test/fixtures/store-1.4.0.json`, fictional, dumped from a database 1.4.0 wrote). Going back is not supported: a store written by 1.5 is not meant to be opened by 1.4.

## What an app changes to take 0.5.0

Expected: the versions (the kit's packages `^0.5.0`; pi-durable, pi-ai and chord `~1.5.2`; add `@earendil-works/pi-schema` `~1.5.2` where `@hachej/boring-agent` is used; drop `typebox` if only the kit needed it). Code of its own written against what 1.5 removed changes too; `MIGRATING.md` ("Migrating to 0.5.0") lists each shape: `Type` from pi-ai, `Context` and `JsonValue` from chord's subpaths, one-argument watch listeners and tagged watch ends, `observeCommits`, tagged file-watch changes, windowed `ConversationView.entries`.

## Known break outside the kit

chord 1.5.2 declares the optional peer `react@19.3.0` exactly. With react 19.3.1 npm refuses the install (ERESOLVE) until chord widens it (its changelog has the range fix unreleased). Until then the app adds `"overrides": { "@earendil-works/chord": { "react": "$react" } }` to its `package.json`; the kit's own root does.
