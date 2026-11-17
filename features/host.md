# Agent host

An app is one `defineApp` definition: its models, handlers, exposed operations, views, agents, wakes, seed and words. `@hachej/boring-agent/host` holds the contract a model may import, with the identity every model shares. Later cards mount it.

## Sub-features

- `host-contract` `defineApp` and `checkAgents` refuse a malformed definition at definition time and at mount, naming the app and the field: name, views, `expose`, needs, `units`, wakes, agent names, and the languages (a base the kit speaks, its words, `app.title` and one name per view). `packages/agent/src/host/define-app.ts`.
- `host-identity` `CurrentUser` (the person, and the scope an agent session carries), `Session`, `NotYours`, `NotAllowed`, `mustOwn` and `must`: the one rights rule over a unit's members, with roles ranked owner, editor, reader. `packages/agent/src/host/identity.ts`.

- `host-session` `createSession` of `@hachej/boring-agent/host-runtime`: one neutral session per id, `me:<person>` (answers that person only, its tools carry no scope) or `reader:<unit>` (woken only by `wake(unit, event, key, text)`, scope `{ kind: "reader", unit, role: "editor", ops: expose[<reader>] }` derived from its id). The Harness comes in through `openHarness` (law BORING-PI-2) and opens on first use, once; a failed open answers 503 `unavailable` and is not kept. `alarm()` resumes what a lost instance left and waits for it. The tools of each agent are one `host.tools.<agent>` Extension from the `tools` option (default `appTools`); the session keeps no list of tools. Files (`upload`, `read`, `write`, `edit`) exist only for a personal session of an app with `needs: ["files"]`. `packages/agent/src/host/runtime/session.ts`.
- `host-streams` The session's wire is the kit's chat transport (`createChatTransportHandler`): `?op=entries`, `?op=watch` (a heartbeat at once), `submit`, `answer`, `abort`. Every submit resolves the sender's language through `ResolveLanguage` and sends it as the first line of the message, `[language: fr]`; a model failure reaches every open watch as the run's `runFailure`, and the stream stays open.

## How to get to it (user POV)

- An app builder imports `defineApp` and the identity from `@hachej/boring-agent/host`. A person sees nothing yet: no page, no session.

## Driving it with node tests

Preconditions: `npm run build`; Domain, effect and alchemy installed (root dev dependencies); fictional data only.

- **Contract.** `host-contract`: `node --test test/packages/agent-host-contract.test.mjs` defines the two fixture apps (`fixtures/host-apps/`), prints one `caught:` line per planted fault and a `units:` line, and reads the built `dist/host.js` import graph. `npm run typecheck` compiles both apps and the closed shapes (`test/types/host-contract.ts`). `npm run test:host-consumer` installs the packed packages in a fresh folder.
- **Identity.** `host-identity`: the same test prints the twelve `must:` rows (no scope, a scope, a scope with `ops`).
- **Session.** `host-session` and `host-streams`: `npm run build && node --test test/packages/agent-host-session.test.mjs` runs `createSession` on pi-durable's SQLite storage in a temporary file, Domain in memory and a scripted model. It prints one line each for first use (one open, a heartbeat within 6 s), the turn that finishes after an eviction with only `alarm()` called, the failure both watches receive, each sender's language, the file tools, a reader's wake and the one extension per agent.

## Gotchas

- `./host` imports only Domain, effect and type-only pi; `cloudflare:*`, `node:*` and `alchemy` are forbidden in `src/host/` and `src/host.ts` (`ARCHITECTURE.json` `pathRules`).
- `defineApp` cannot see agent names; `checkAgents(def, agents)` runs at mount.
- Every declared language is checked against the base's keys (the title, each view's name, each refusal): a table that is not an object, lacks one, or has a view or refusal the base has not, is refused at `defineApp` (AP-23).
- Domain, effect and alchemy are not declared as peers of `@hachej/boring-agent`: npm walks the optional peers of Domain (react, ws) and refuses a plain install next to pi 1.5.2 (ERESOLVE). An app that imports `./host` installs the three itself, at the versions of this repository's root dev dependencies; an app that does not installs none of them. `npm run test:host-consumer` does both real installs.
- A host consumer who has not installed the three packages gets one sentence from `@hachej/boring-agent/host` naming each with its exact version (`HOST_PACKAGES`, tested against the root dev dependencies). The entry loads its contract with a dynamic `import()` for this; a consumer that never imports it installs nothing.
- Languages and Chord: `@earendil-works/chord` 1.5.2 has `defineMessages`, `Translations`, `formatNumber` and `formatTime` at its root, but they do not serve this contract. Checked in `node_modules` and by running it: `defineMessages` checks a catalog's keys only in the types (missing, extra, a string and a nested table are all accepted at run time), its catalogs are flat strings or functions in one namespace (ours are nested: `app`, `views.<id>`, `refusals.<tag>`), it renders in an ambient current language (a surface's), not a person's language passed per request, and `formatNumber`/`formatTime` cover two of `Format`'s eight methods in that same ambient language. `resolveLocale`, `matchLocale` and `canonicalLocale` are not exported from the package. Kept of ours: the `languages` declaration, the `Format` type (implemented on `Intl` by the runtime card) and the run-time key check in `defineApp`, which names the app and the field. Revisit when Chord exports its locale functions or a catalog check at run time.
