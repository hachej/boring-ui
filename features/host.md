# Agent host

An app is one `defineApp` definition: its models, handlers, exposed operations, views, agents, wakes, seed and words. `@hachej/boring-agent/host` holds the contract a model may import, with the identity every model shares. Later cards mount it.

## Sub-features

- `host-contract` `defineApp` and `checkAgents` refuse a malformed definition at definition time and at mount, naming the app and the field: name, views, `expose`, needs, `units`, wakes, agent names, and the languages (a base the kit speaks, its words, `app.title` and one name per view). `packages/agent/src/host/define-app.ts`.
- `host-identity` `CurrentUser` (the person, and the scope an agent session carries), `Session`, `NotYours`, `NotAllowed`, `mustOwn` and `must`: the one rights rule over a unit's members, with roles ranked owner, editor, reader. `packages/agent/src/host/identity.ts`.

## How to get to it (user POV)

- An app builder imports `defineApp` and the identity from `@hachej/boring-agent/host`. A person sees nothing yet: no page, no session.

## Driving it with node tests

Preconditions: `npm run build`; Domain, effect and alchemy installed (root dev dependencies); fictional data only.

- **Contract.** `host-contract`: `node --test test/packages/agent-host-contract.test.mjs` defines the two fixture apps (`fixtures/host-apps/`), prints one `caught:` line per planted fault and a `units:` line, and reads the built `dist/host.js` import graph. `npm run typecheck` compiles both apps and the closed shapes (`test/types/host-contract.ts`). `npm run test:host-consumer` installs the packed packages in a fresh folder.
- **Identity.** `host-identity`: the same test prints the twelve `must:` rows (no scope, a scope, a scope with `ops`).

## Gotchas

- `./host` imports only Domain, effect and type-only pi; `cloudflare:*`, `node:*` and `alchemy` are forbidden in `src/host/` and `src/host.ts` (`ARCHITECTURE.json` `pathRules`).
- `defineApp` cannot see agent names; `checkAgents(def, agents)` runs at mount.
- Words are checked only for the base language: another language falls back to the base's text at run time, so the contract does not require its tables to be complete.
- Domain, effect and alchemy are optional peers: an app that does not use the host installs none of them.
