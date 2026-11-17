# Agent host

An app is one `defineApp` definition: its models, handlers, exposed operations, views, agents, wakes, seed and words. `@hachej/boring-agent/host` holds the contract a model may import, with the identity every model shares. Later cards mount it.

## Sub-features

- `host-contract` `defineApp` and `checkAgents` refuse a malformed definition at definition time and at mount, naming the app and the field: name, views, `expose`, needs, `units`, wakes, agent names, and the languages (a base the kit speaks, its words, `app.title` and one name per view). `packages/agent/src/host/define-app.ts`.
- `host-identity` `CurrentUser` (the person, and the scope an agent session carries), `Session`, `NotYours`, `NotAllowed`, `mustOwn` and `must`: the one rights rule over a unit's members, with roles ranked owner, editor, reader. `packages/agent/src/host/identity.ts`.
- `host-build` `npx boring-host-build <app dir> --options <module> [--shell <module>] [--page <html file>] [--stack <module>]` reads the app's `app.ts` and writes `.gen/server.ts` (the Worker entry, the only `Harness.open`), `.gen/assets.ts` (the page text and the skills as text), `.gen/page.tsx` (the shell and each view's module) and, with `--stack`, `.gen/alchemy.run.ts`. The same app gives the same text in any folder. A broken app folder is refused in one line and `.gen/` is left as it was. `packages/agent/src/host-build.ts`, `host-build-cli.ts`, `host-cloudflare/entry.ts` (the Worker entry's text, which imports nothing).

## How to get to it (user POV)

- An app builder imports `defineApp` and the identity from `@hachej/boring-agent/host`. A person sees nothing yet: no page, no session.

## Driving it with node tests

Preconditions: `npm run build`; Domain, effect and alchemy installed (root dev dependencies); fictional data only.

- **Contract.** `host-contract`: `node --test test/packages/agent-host-contract.test.mjs` defines the two fixture apps (`fixtures/host-apps/`), prints one `caught:` line per planted fault and a `units:` line, and reads the built `dist/host.js` import graph. `npm run typecheck` compiles both apps and the closed shapes (`test/types/host-contract.ts`). `npm run test:host-consumer` installs the packed packages in a fresh folder.
- **Build.** `host-build`: `npm run build && node --test --test-name-pattern "build|broken folder" test/packages/agent-host-mount.test.mjs` runs the built command on copies of both fixture apps (two runs, two folders, byte-identical; the same `server.ts` for both apps; one line and an untouched `.gen/` for a broken folder). `npm run test:host-consumer` runs it from a packed install.
- **Identity.** `host-identity`: the same test prints the twelve `must:` rows (no scope, a scope, a scope with `ops`).

## Gotchas

- `boring-host-build` writes text only: `--options` is required, a module written `./x` is relative to the app folder (the generated files say `../x`), a package name is kept, `--page` is read relative to where the command runs, and bundling `.gen/page.tsx` is the caller's. It loads `app.ts` with one `import()`, the one SELF-2 exception, so it must only be run on an app's own reviewed folder. `.gen/` is ignored by git.

- `./host` imports only Domain, effect and type-only pi; `cloudflare:*`, `node:*` and `alchemy` are forbidden in `src/host/` and `src/host.ts` (`ARCHITECTURE.json` `pathRules`).
- `defineApp` cannot see agent names; `checkAgents(def, agents)` runs at mount.
- Every declared language is checked against the base's keys (the title, each view's name, each refusal): a table that is not an object, lacks one, or has a view or refusal the base has not, is refused at `defineApp` (AP-23).
- Domain, effect and alchemy are not declared as peers of `@hachej/boring-agent`: npm walks the optional peers of Domain (react, ws) and refuses a plain install next to pi 1.5.2 (ERESOLVE). An app that imports `./host` installs the three itself, at the versions of this repository's root dev dependencies; an app that does not installs none of them. `npm run test:host-consumer` does both real installs.
- A host consumer who has not installed the three packages gets one sentence from `@hachej/boring-agent/host` naming each with its exact version (`HOST_PACKAGES`, tested against the root dev dependencies). The entry loads its contract with a dynamic `import()` for this; a consumer that never imports it installs nothing.
- Languages and Chord: `@earendil-works/chord` 1.5.2 has `defineMessages`, `Translations`, `formatNumber` and `formatTime` at its root, but they do not serve this contract. Checked in `node_modules` and by running it: `defineMessages` checks a catalog's keys only in the types (missing, extra, a string and a nested table are all accepted at run time), its catalogs are flat strings or functions in one namespace (ours are nested: `app`, `views.<id>`, `refusals.<tag>`), it renders in an ambient current language (a surface's), not a person's language passed per request, and `formatNumber`/`formatTime` cover two of `Format`'s eight methods in that same ambient language. `resolveLocale`, `matchLocale` and `canonicalLocale` are not exported from the package. Kept of ours: the `languages` declaration, the `Format` type (implemented on `Intl` by the runtime card) and the run-time key check in `defineApp`, which names the app and the field. Revisit when Chord exports its locale functions or a catalog check at run time.
