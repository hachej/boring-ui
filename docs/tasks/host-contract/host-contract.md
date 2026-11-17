---
id: host-contract
title: One app is one defineApp definition, typed and checked, from @hachej/boring-agent/host
type: feature
state: in review
requester: julien
created: 2026-11-16
features: host-contract, host-identity
waiting_on:
closed_reason:
live_commit:
live_at:
---

# One app is one defineApp definition, typed and checked, from @hachej/boring-agent/host

Cold review applied: 16 November 2026

Serves: every builder of an app (boring-studio's `app-template` first). Contract code an app or boring-studio writes itself: from 77 lines (`contract/define-app.ts` 61 + `contract/identity.ts` 16 in the plugin proof) to 0.

Depends on: nothing. Estimate: 0.5 day for the code, plus up to 0.5 day for the lockfile entry. The lockfile entry is the builder's FIRST commit, alone: `@alchemy.run/domain`, `effect` and `alchemy` into `package.json` and `package-lock.json`, so its CI run says early whether a clean `npm ci` passes. If a clean `npm ci` needs `--legacy-peer-deps`, stop and report (the whole chain inherits it); never force it.

Repository: `hachej/boring-ui`, branch `host/contract` from `origin/main` (never from `release/0.5.1` or the branches of #2215, #2216, #2217, #2224).

## Acceptance

- AC-1: `packages/agent/src/host.ts` (re-exporting from `src/host/`) builds to `dist/host.js` and `dist/host.d.ts`, and `package.json` exports `./host` to them. `import { defineApp } from "@hachej/boring-agent/host"` resolves from the built package. `test/packages/agent-host-contract.test.mjs` imports `fixtures/host-apps/notes/app.ts` and `fixtures/host-apps/todo/app.ts`. These are copies of the proof's `app.ts`, `agents.ts`, `models/`, `skills/` and `web/` for each app, changed only in their import specifiers (`../../contract/*.ts` and `../../../../contract/identity.ts` become `@hachej/boring-agent/host`). The test asserts that `defineApp` returns each definition as the same object (`===`). `./host` exports `defineApp`, `checkAgents`, the types `AppDefinition`, `AgentKit`, `View`, `ViewProps`, `Wake`, `Seed`, `Need`, `Operation`, `Role`, `Scope`, and the identity of AC-4. check: auto how: node --test test/packages/agent-host-contract.test.mjs
- AC-2: The definition follows the proof's 14 corrections. `expose` has `page`, an optional `mcp`, and one key per agent name. `agents(kit)` returns a record of `DefinedAgent` from boring-agent's own `defineAgent`. `skills` is a folder path. `wakes` is `{ policy, agent, key, message }`. Each view carries `component`. `handlers` and `title` are required. There is no `rightPane` on a view and no `model` at the top level of the definition (`AgentKit.model` stays). `needs` is `readonly "files"[]`. `test/types/host-contract.ts` (in `tsconfig.contract-tests.json`) holds both apps of AC-1 compiling with no error, `seed: { people: [{ name, email }] }` with no `operations` compiling (boring-studio's `app-template` imports `seed/people.json` as `seed.people`), the AC-4 `Scope` type assigned to Chord's `Principal` (`import type { Principal } from "@earendil-works/chord"`) with no error, and one `// @ts-expect-error` line for each of: a view with no `component`, a view with `rightPane`, a definition with `model`, `needs: ["mail"]`, and `agents: () => ({ assistant: { id: "x" } })`. `npm run typecheck` passes. Removing any one of those `@ts-expect-error` lines makes it fail. check: auto how: npm run typecheck
- AC-3: Each planted fault is refused with an `Error` whose message names the app (`defineApp(<name>)` or `checkAgents(<name>)`) and the field. The test asserts each refusal, then prints one `caught: <fault> -> <message>` line per fault and no `NOT CAUGHT` line. `defineApp(def)` refuses the proof's six (no page operations, an unknown need, a bad name, no view, a reader with no expose list, wakes with no agents), plus two views with one id and `needs: ["mail"]`. `checkAgents(def, agents)`, which the host calls at mount with the record `agents(kit)` returned, refuses: no `assistant`; an `expose` key that is not `page`, `mcp` or an agent's name; a `wakes[].agent` that is not an agent's name; and a record key that differs from its agent's `id`. That is 12 lines. Both fixture apps pass both functions. check: auto how: node --test test/packages/agent-host-contract.test.mjs
- AC-4: `./host` exports the identity a model imports. `CurrentUser` is a Domain `RequestContext` of `{ userId: string, scope?: { kind: "unit" | "reader", unit: string, role: Role, ops?: string[] } }`, where `Role` is `"owner" | "editor" | "reader"`, ranked in that order (`ops` is written `Schema.optionalKey(Schema.mutable(Schema.Array(Schema.String)))`, so the type stays assignable to Chord's `Principal`, AC-2). `Session` is an `RpcMiddleware` that provides `CurrentUser`, with error `Unauthorized`. `NotYours` is a Rejection with HTTP 404. `NotAllowed({ need })` is a Rejection with HTTP 403. `mustOwn(key)` refuses with `NotYours` when the key (or `key.id`) is not `userId`. `must(need, unit, members, op)` takes `members` as `ReadonlyArray<{ userId: string, role: Role }>` (what `units.members` returns, as the session proof's `must` takes it). With `need = "editor"` and `op = "AddNote"`, the test runs these twelve rows on unit `u1`, whose members are camille owner, dominique editor and edgar reader:
  - no scope, as camille: passes
  - no scope, as dominique: passes
  - no scope, as edgar: `NotAllowed`
  - no scope, as gaspard: `NotYours`
  - no scope, as camille on `u2` (members only dominique): `NotYours`
  - no scope, as dominique with `op = "AddContact"`: passes (ops do not limit a person)
  - scope `{ unit: "u1", role: "owner", ops: ["AddNote"] }`: passes
  - scope with `role: "editor"`: passes
  - scope with `role: "reader"`: `NotAllowed`
  - scope with `unit: "u2"`, called on `u1`: `NotYours`
  - scope with `ops: ["Notes.get"]`, called with `AddNote`: `NotYours`
  - scope `{ unit: "u1", role: "editor" }`, as gaspard (not a member): passes (a scoped caller has its scope, whoever sent it)

  Each refusal is asserted by its `_tag`. check: auto how: node --test test/packages/agent-host-contract.test.mjs
- AC-5: `ARCHITECTURE.json` gives `packages.agent.pathRules` two entries, prefixes `src/host/` and `src/host.ts`, forbidding `cloudflare:*`, `@alchemy.run/cloudflare*`, `alchemy`, `alchemy/*`, `node:*` and `@hachej/boring-ui-kit*`. In `test/packages/agent-host-contract.test.mjs`, `checkSource("packages/agent/src/host/x.ts", …)` returns `forbidden import in src/host/` for a planted `import "cloudflare:workers"`, `import "node:fs"` and `import "alchemy"`, and `checkSource("packages/agent/src/host-cloudflare/x.ts", "import 'cloudflare:workers'")` returns no `src/host/` rule error. The test also follows the relative and package imports of the built `dist/host.js` inside `packages/agent/dist/`. It finds no `node:*`, no `cloudflare:*` and no runtime module of `@earendil-works/pi-durable`. `npm run check` passes on the real tree. check: auto how: node --test test/packages/agent-host-contract.test.mjs && npm run check
- AC-6: `packages/agent/package.json` has `@alchemy.run/domain` `2.0.0-beta.87`, `effect` `4.1.4` and `alchemy` `2.0.0-beta.87` as exact peer dependencies, each `optional: true` in `peerDependenciesMeta`. The root `package.json` has them as exact dev dependencies. `ARCHITECTURE.json` lists them in `rootDevDependencies`, and in `packages.agent.external` as `@alchemy.run/domain`, `effect`, `effect/*` and `alchemy` (`checkManifest` refuses a peer that `external` does not match; the `src/host/` rule of AC-5 still forbids importing `alchemy` there). `rm -rf node_modules && npm ci` succeeds with no `--legacy-peer-deps` and no new `ERESOLVE` warning. `npm run check:pack` passes. check: auto how: npm ci && npm run check && npm run check:pack
- AC-7: `features/host.md` exists with the ids `host-contract` and `host-identity`, each in a driving step, and is listed in `features/README.md`; `MIGRATING.md` has one `# Unreleased` bullet for the new entry. check: auto how: npm run check (check-features) && BASE_SHA=$(git merge-base origin/main HEAD) HEAD_SHA=HEAD node scripts/check-release-notes.mjs
- AC-8: The pull request lists, for each new file, what in pi and boring-ui was looked at and why it did not fit (the table of the Research section, completed). check: human how: Julien reads the pull request body before the merge, 2026-11-16 (recette step 1)
- AC-9: `npm run test:host-consumer` (new `scripts/test-host-consumer.mjs`, on `prepareConsumerIsolation`) packs `@hachej/boring-agent` and `@hachej/boring-files` from the build into a fresh folder. With only the published packages, pi 1.5.2, `@alchemy.run/domain`, `effect` and `alchemy` installed, a plain `.mjs` imports `defineApp` and `checkAgents` from `@hachej/boring-agent/host`, defines a one-view app, and gets the AC-3 sentence for `needs: ["mail"]`. In a second fresh folder without Domain, effect or alchemy, `import "@hachej/boring-agent/agents"` still works and `npm ls` shows none of the three. check: auto how: npm run test:host-consumer
- AC-10: `AppDefinition.units?: { view: Operation; members(state: unknown): ReadonlyArray<{ userId: string; role: Role }> }`. The todo fixture has no `units` and is accepted. `defineApp` refuses a `units.view` that is not in `expose.page` (`defineApp(<name>): units.view …`); the test asserts it and prints it as one `units: <fault> -> <message>` line, apart from AC-3's twelve `caught:` lines. check: auto how: node --test test/packages/agent-host-contract.test.mjs

## Out of scope

- The session, tools, mounting, sign-in and files (later cards). `needs: ["mail"]`. `links` and `AgentKit.linked` (added to `./host` by `host-mcp-link` AC-1, now that the MCP link proof has reported).
- Loading `seed.operations` (declared, still not loaded by any host).
- A third app written by someone who has not seen the host.

## Research

- Proven (`/home/ubuntu/fleet/handoffs/phase0-plugin-contract-2026-11-16.md`, sections "The `defineApp` signature as built" and "The sketch in `APP-PLUGIN.md`"): copy `/var/tmp/boring-studio-work/p0-plugin/contract/define-app.ts` (61 lines) and `contract/identity.ts` (16) as the start; the six planted faults are `/var/tmp/boring-studio-work/p0-plugin/ship/check-contract.mjs` (9 lines). The two apps are `/var/tmp/boring-studio-work/p0-plugin/apps/notes/` (`app.ts` 27, `agents.ts` 26, models 232, `skills/`, `web/NotesView.tsx`) and `apps/todo/` (`app.ts` 16, `agents.ts` 9, model 53, `skills/assistant/priorites/`, `web/TodosView.tsx`): copy each app's `app.ts`, `agents.ts`, `models/`, `skills/` and `web/` into `fixtures/host-apps/notes/` and `fixtures/host-apps/todo/` (fictional data only; the e-mails are already `@example.test`). Never copy `.gen/` or `.alchemy/`. `tsconfig.contract-tests.json` typechecks `fixtures/**/*.ts`, so the copied models compile under `npm run typecheck` once Domain and effect are installed (AC-6).
- Proven (`/home/ubuntu/fleet/handoffs/phase0-session-scope-2026-11-16.md`, "Design as built"): the scope a caller carries (`person`, `unit` with role and optional `ops`, `reader`), and the app's one rule `must`: `/var/tmp/boring-studio-work/p0-session/app/models/identity/rights.ts` (19 lines), with the scope and `CurrentUser` in `identity/CurrentUser.context.ts` (16), the rejections in `identity/Rejections.ts` (5) and `Session` in `identity/Session.middleware.ts` (8). The proof's 12 rows are `p0-session/test/rights.test.mjs`. Moving `must` into the contract removes the 24 app lines the session proof needed (`rights`, `caller`, `readerScope`, `preamble`): the host derives the reader's scope from `wakes` plus `expose[agent]`.
- Not proven, chosen here: a shared unit names where its members live with one optional field `units: { view, members(state) }` (the view the door reads as the person, and a function from its state to `ReadonlyArray<{ userId, role }>`, the array the session proof's `must` takes). Roles are ranked owner > editor > reader, as the session proof did. An app with no `units` has personal sessions only (the to-do app).

What pi gives, what boring-ui has, what to write (D-16: "an app is a pi plugin, with Alchemy's Domain in the place Chord has in pi's apps"):

| Piece | pi gives | boring-ui already has | To write |
|---|---|---|---|
| The plugin unit an agent runs with | `defineExtension` (`@earendil-works/pi-durable`, 1.5.2, `dist/harness/define.d.ts`): tools, sections, hooks | `defineAgent` / `AgentSpec` / `DefinedAgent` (`packages/agent/src/agents.ts`), which builds those extensions; `directorySkillSource` (`skills.ts`); `createDelegateTool` (`delegate.ts`), all re-exported from `./agents` | nothing: `agents(kit)` calls `defineAgent` |
| An app as a plugin (facets per host kind, contracts, registries) | Chord's `defineFacet` (1.5.2, root export, platform-neutral): a setup callback that serves Chord contracts and registries to a host, which a Chord loader runs (`./plugins`, Node-only) | nothing | the manifest only (~70 lines). Our app's objects are Domain models, not Chord contracts (D-16), so a facet has nothing to serve. `defineApp` is the static manifest such a loader would read: `views` is its web facet, `agents` + `expose` its worker facet |
| Admission typed per object | Chord `packages/chord/src/host/admission.ts` (pi `main` only, 383 lines at `a9878e1`, unreleased, absent from 1.5.2 `dist/host/`, Node object model) | `allow`, `revoked` in `chat-transport.ts` | the scope type only here (~10 lines); the door is `host-session` |
| Who is calling, inside a model | Chord gives `Principal` (a JSON value with `kind`, root type export of 1.5.2). `principalKey` and `samePrincipal` are internal in 1.5.2 (`dist/data/internal`, not exported from the root) | nothing | `CurrentUser`, `Session`, `NotYours`, `NotAllowed`, `mustOwn`, `must` (~30 lines, from the proofs). The scope is written as a Domain `Schema` because `CurrentUser` is a Domain `RequestContext`. Its type stays assignable to Chord's `Principal` (the AC-2 type test asserts it), so a Chord host can take it as its principal later; `host-session` keeps its own session ids until Chord exports its key functions |
| Tool schemas | `@earendil-works/pi-schema` | `jsonSchemaTool` (`json-schema-tool.ts`, re-exported from `./agents`) | nothing: Domain's `toToolkit` gives schemas (next card) |

Also checked: boring-ui has no `defineApp` or app manifest today (`git grep defineApp packages` finds only `defineAgent`). `@hachej/boring-agent/definitions` loads file-based agent definitions (`loadAgentDefinition`), not an app manifest, so there is no duplicate there.

Known traps:
- AP-2 of boring-studio's invariants says a model imports only Alchemy Domain and effect: the contract entry is the one allowed addition (correction 8). Keep `./host` free of anything a model must not pull in (no pi-durable runtime import in `identity.ts`: type imports only), so a model's import graph stays Domain + effect + this file. The AC-5 graph test proves it on `dist/host.js`: a runtime import of `../agents.js` from `src/host/` would bring `node:crypto` and pi-durable (`agents.ts` lines 1-2) with no `pathRules` error, because the rule checks direct imports only.
- `pathRules` match with `local.startsWith(rule.prefix)` (`scripts/pi-policy.mjs` line 32): a prefix `src/host` would also cover `src/host-cloudflare/` and `src/host-build.ts`, which the next cards need for `cloudflare:*`, `alchemy` and `node:*`. Write `src/host/` and `src/host.ts`.
- `defineApp` cannot see agent names: they exist only once `agents(kit)` runs, and `defineApp` must not call it (that would call `defineAgent` and pi-durable at definition time). Every check on agent names is in `checkAgents(def, agents)`, which the host calls at mount.
- The proof's signature `defineApp<const A extends AppDefinition>(app: A)` infers `A` from the argument, so excess-property checks do not apply: `rightPane` on a view and `model` at the top level compile today. Close them (for example `rightPane?: never`, `model?: never`) or the AC-2 type test cannot hold. Keep `model` on `AgentKit`.
- `DefinedAgent` is a structural interface (`packages/agent/src/agents.ts`), so the type test uses a value that is visibly not one (`{ id: "x" }`).
- `@alchemy.run/domain` 2.0.0-beta.87 declares `alchemy` 2.0.0-beta.87 as a peer that is not optional, and its root imports it at run time (`lib/index.js` imports `lib/Aggregate.js`, whose first line imports `alchemy/WorkflowEncoding`). So `alchemy` enters boring-ui's lockfile in this card, not in `host-mount`. `effect` 4.1.4, Domain and `alchemy` are new to boring-ui (no file names them today). `ARCHITECTURE.json` must change before the import (boring-ui `AGENTS.md`: "Change ARCHITECTURE.json before new packages/edges/dependencies"). `npm run check:pack` and `test/consumer-isolation.test.mjs` do not prove what a consumer installs: AC-9 does.
- The `MIGRATING.md` bullet is enforced by `scripts/check-release-notes.mjs` (the "Require migration notes" step of `.github/workflows/verify.yml`, pull requests only), not by `npm run check`.
- Refusal messages are in English (`defineApp(x): …`): app builders read them. The README's "words in French and English" applies to the page shell only.
- boring-ui's `agents` dev dependency (Cloudflare's `agents` 0.33.0) and `examples/hosts/cloudflare/` (PiHarness) are ruled out by Julien (D-10): never import or copy them.
- Disk is at 94-95 % (20 GB free at 16:30 UTC); `npm ci` in a worktree costs a full install. Check `df -h /` first (sign-offs refuse at 95 %), one worktree per card, remove it after (copy `.agent-handoff/` out first).

Unknown: whether `const` generic inference survives `agents(kit)` returning a record built inside a function (the proof used casts in the host, not in the contract). The AC-2 type test with both fixtures compiling answers it.

## Decisions

- 2026-11-16 julien via conductor « D-30, D-31, D-16 »: the glue moves into boring-ui; agents use boring-ui's own definition; an app is a pi plugin with Domain in Chord's place.
- 2026-11-16 conductor (no one to ask, simplest option): the host lives as entries of `@hachej/boring-agent` (`./host` the contract a model may import, `./host-runtime` the neutral session, `./host-cloudflare` the adapter, `./host-build` the Node build step), not a new package: a new package changes the publish set the owner approved on 2026-10-13 (`docs/implementation/NPM-RELEASE.md`). Each entry is a file `src/<entry>.ts` re-exporting its folder, built to `dist/<entry>.js` (`rootDir: src`, `outDir: dist`).
- 2026-11-16 conductor: `units: { view, members }` with three fixed ranked roles, instead of an app-supplied `rights` object; `members(state)` returns an array `ReadonlyArray<{ userId, role }>`, as the session proof's `must` takes it.
- 2026-11-16 conductor (cold review): the `units` decision has its own line (AC-10); the scope type is assignable to Chord's `Principal` (it costs one schema spelling of `ops`), otherwise the pull request says why not; Domain, effect and alchemy enter the lockfile as the first commit, and a clean `npm ci` that needs `--legacy-peer-deps` stops the card.
- 2026-11-16 julien « apps are multi-language by design » (D-5Y in `/home/ubuntu/fleet/handoffs/multi-language-2026-11-16/REPO-CHANGES.md`): no user-facing string is hard-coded in host or kit code this card adds; each takes its strings from the app's words, and a host notice from the kit's words tables, as that file's host invariant PL-15 says: « The host and the kit speak every language the kit declares: every words table of the kit has the same keys in each, the sign-in page and its errors included. A host notice in a conversation (approval expired or replaced, a cut turn, the daily cap, « inconnu ») is stored as a kind and drawn in each viewer's language. A person's language is read from their record in the app at every request, never from what a request says. » The French sentences in this card's lines are the fixture apps' French words, not strings of the host. That file has no line per host card; the kit's words, `format` and a person's language are boring-studio's card `platform-v1/boring-ui-languages`. Its section 4 (the `defineApp` change: `languages`, `AppWords`, `KIT_LANGUAGES`, a view's `language`, `words`, `format` and `say`; `title` and each view's `nav` move into the words) says it lands in `host-contract`; it is not in this card's lines yet, because it changes AC-1's « unchanged » fixtures and AC-2: the conductor puts it here or in `boring-ui-languages` before the build.

## Questions

## Notes

## Recette

The agent's own test, pasted in the report: the first commit's clean `npm ci` (no `--legacy-peer-deps`, no new `ERESOLVE`), `node --test test/packages/agent-host-contract.test.mjs` (every `caught:` line, the `units:` line, the twelve `must` rows), `npm run typecheck`, `npm run check`, `npm run test:host-consumer`, the `check-release-notes.mjs` command of AC-7, then the full `npm test` once before the pull request; the pull request's hosted checks green. Fail-first: remove one rule of AC-3 and paste the resulting `NOT CAUGHT` line.

Julien's walk, on his phone:

1. Ouvre la pull request « host/contract » et lis le tableau « ce que pi et boring-ui donnent ». Tu dois y lire, pour chaque fichier nouveau, ce qui a été regardé et pourquoi ça n'allait pas. Le tableau tient dans l'écran du téléphone sans défiler de côté. (AC-8)
2. Ouvre le rapport (section Report de la carte) et compte les lignes qui commencent par « caught: ». Tu dois en compter douze, et aucune ligne « NOT CAUGHT ». (AC-3)
3. Ouvre `fixtures/host-apps/todo/app.ts` dans la pull request. Tu dois y lire 16 lignes, et une seule ligne `import { defineApp } from "@hachej/boring-agent/host"` en haut. Ouvre ensuite l'onglet « Files changed » : tu ne dois voir aucun fichier changé sous `fixtures/host-apps/todo/models/` à part ses imports. (AC-1)
4. Ouvre `features/host.md`. Tu dois y voir les deux noms `host-contract` et `host-identity`, et sous « Driving it with », la commande `node --test test/packages/agent-host-contract.test.mjs`. (AC-7)

Test script: written by the cold reviewer before the build, `~/fleet/evaluator/boring-ui/host-contract/script.md`.

## Report

Builder's report, 16 November 2026. Branch `host-contract`, three commits on `origin/main` 6cae8aa09. Proof is the builder's own, not the person's verdict.

Lockfile (first commit, alone). Domain, effect and alchemy at the exact versions. A bare install first failed with `ERESOLVE` (Domain, `@alchemy.run/frontend-frameworks`, `@vitejs/plugin-react`, `@rolldown/plugin-babel`, Babel 8 against shadcn's Babel 7). The conductor ruled for a scoped override, `overrides["@rolldown/plugin-babel"]["@babel/plugin-transform-runtime"] = "^7.29.0"`; the scoped form works, so no repo-wide override. `rm -rf node_modules && npm ci` then succeeds with no flag (1122 packages; the only warnings are the existing excalidraw radix ones). Remove the override when an Alchemy beta stops pulling this chain or shadcn moves to Babel 8 (`MIGRATING.md`, Unreleased).
Checks that touch Babel 7 after it: `npm run build` ok, `npm run registry:build` ok (kit 0.5.1), `npm run check` exit 0. `npm run test:registry-consumer` fails with `Cannot find module 'lucide-react'` in the disposable consumer; it fails with the same line on the commit before mine (baseline run), so it is not caused by this card.

| AC | Result | Evidence |
|---|---|---|
| AC-1 | pass | `node --test test/packages/agent-host-contract.test.mjs`: 6 of 6 pass; both fixtures come back `===` from `defineApp`; `./host` exported in `packages/agent/package.json` |
| AC-2 | pass | `npm run typecheck` exit 0 with both apps, `seed.people` without `operations`, the scope assigned to Chord's `Principal`, and eight `@ts-expect-error` lines (component, rightPane, model, needs mail, fake agent, `title`, `nav`, an unknown language). Removing the `withModel` line gives `test/types/host-contract.ts(23,1): error TS2578: Unused '@ts-expect-error' directive.` |
| AC-3 | pass, count now 18 | 14 `defineApp` lines and 4 `checkAgents` lines, no `NOT CAUGHT` (the card's 12 plus 6 language refusals). Fail-first: removing the `app.title` rule prints `# NOT CAUGHT: no title in the base words` and the test fails |
| AC-4 | pass | twelve `must:` rows, each by `_tag`, as listed in `.agent-handoff/ac3.txt` (ok, ok, NotAllowed, NotYours, NotYours, ok, ok, ok, NotAllowed, NotYours, NotYours, ok) |
| AC-5 | pass | `pathRules` for `src/host/` and `src/host.ts`; test plants `cloudflare:workers`, `node:fs`, `alchemy` (each refused), `src/host-cloudflare/x.ts` gets no `src/host/` error; built graph of `dist/host.js` imports only `@alchemy.run/domain`, `effect/Effect`, `effect/Schema`, `effect/rpc/RpcMiddleware`; `npm run check` exit 0 |
| AC-6 | pass | peers exact and optional, root dev dependencies, `ARCHITECTURE.json` `external` and `rootDevDependencies`; clean `npm ci` as above; `npm run check:pack` exit 0 |
| AC-7 | pass | `features/host.md` with `host-contract` and `host-identity` in driving steps, listed in `features/README.md`; `MIGRATING.md` bullet; `check-release-notes.mjs` prints `{"required":true,"promoted":false}` |
| AC-8 | for Julien | the pull request body carries the table |
| AC-9 | pass | `npm run test:host-consumer`: with Domain, effect and alchemy installed the plain `.mjs` prints `caught: needs mail -> defineApp(consumer): needs: unknown capability mail`; in the second folder none of the three is present (`existsSync` false) and `@hachej/boring-agent/agents` loads |
| AC-10 | pass | `units: view outside expose.page -> defineApp(x1): units.view Notes.get is not in expose.page`; the todo fixture has no `units` |

Languages (conductor's addition, `multi-language-2026-11-16/REPO-CHANGES.md` section 4). `defineApp` takes `languages: { base, words, region? }` and loses `title` and the view `nav` (`title?: never`, `nav?: never` close them). Refusals added: no `languages`; a base the kit does not speak; words in a language the kit does not speak; a base with no words; no `app.title`; a view with no name in the base words. A declared language whose table lacks a key the base has is not refused: the design says the base text is the fallback, so completeness of the other tables is the app verifier's (AP-23). The fixtures are the proof's apps unchanged except for the import specifiers, the `languages` field (and the removed `title` and `nav`) and the words files (`words.ts`, `words.en.ts` for notes; `words.ts`, `words.de.ts` for todo). The views' own text stays as the proof wrote it; moving it to `words` is boring-studio's template work. `Format`, `ViewProps.language/words/format/say` are types only.

Choices made alone: `handlers` is typed `Layer<never, any, any>` because `Layer.empty` (the sample app's) is not assignable to `Layer<any, any, any>`; `needs` is `readonly "files"[]` and the runtime list is `["files"]`; `Seed.operations` is optional; `test-host-consumer.mjs` writes the two archives' lock entries itself (integrity of the tarball), because `npm install --package-lock-only` over the subset lockfile also resolved Domain's optional peers (vite, puppeteer-core) and failed on `ws`; no flag was used. `package.json` gained `test:host-consumer`.

Full `npm test`: 3346 tests, 3111 pass, 1 fail, rest skipped by the suite. The failure, `public chat-react voice hooks execute in an isolated DOM realm`, passes alone (`node --test test/packages/ui-chat-react-voice.test.mjs`: 1 pass); it ran 3.1 s inside the full run, so I call it load flake, not proven. `npm run verify` and hosted checks not run by me.

### Round 2 (16 November 2026, after the tester's "fix first")

- The agent package no longer declares `@alchemy.run/domain`, `effect` or `alchemy` as peers: a plain `npm install` of the packed package next to pi 1.5.2 failed with ERESOLVE because npm walks Domain's optional peers (react 19.3.1, ws 8.23.0) against chord's exact pins. An app that imports `/host` installs the three itself. `npm run test:host-consumer` now does a real plain install of the tarballs, with and without them.
- `defineApp` checks every declared language against the base's keys; a missing `views` or `expose` is refused naming the app; `checkAgents` uses own-property lookups; `KIT_LANGUAGES` is `en`, `fr`; fixture view text is English (todo's second language is `en`, not `de`).
- `main` merged into the branch (conflict in `MIGRATING.md` only, both texts kept).
