# @hachej/boring-factory

Trusted, portable Factory identity and procedure resources for Boring applications.
This package is intentionally inert: installing it creates no Agent seat and grants no
Pi extension, skill, tool, provider, credential, or dispatch authority.

## Canonical sources

- Profiles: `agents/boring-orchestrator`, `agents/boring-worker`, and `agents/boring-reviewer` in this package.
- Worker procedures: repository-canonical `.agents/skills/plan` and
  `.agents/skills/exec`.
- Procedure companions: `.agents/skill-references/plan` and
  `.agents/skill-references/exec`.

`pnpm build` copies those procedures, their direct read-only procedure/reference
closure, and all three profiles byte-for-byte into `dist/resources`. The manifest maps
every packaged path to its canonical repository source and SHA-256. Generated
resources are package output and must not be edited directly. Only the top-level
`skills/plan` and `skills/exec` directories are projected as discoverable Worker
skills; bundled support skills and documents remain references, not extra grants.

## Trusted host composition

```ts
import { resolveBoringFactoryResources } from '@hachej/boring-factory/server'

const resources = resolveBoringFactoryResources()
```

The embedding app may compile `resources.agentSources` into an allowlisted internal
fleet and project `resources.skillRoot` only to the addressed Worker runtime. The app
continues to own seats, `/loop`, provider credentials/settings, quotas, and activation policy.

## Server host entry

```ts
import { createFactoryHost } from '@hachej/boring-factory/server'
```

`createFactoryHost({ repositoryRoot, workspaceRoot, stateRoot, env, provider })` returns
`{ agents, plugins, registry, sessionBindings, bind(app), rearm(), close() }` for trusted app
composition. `workspaceRoot` is the canonical, read-mostly repository checkout. The host owns
the persisted multi-epic registry (`<stateRoot>/epics.json`), session-to-epic bindings
(`<stateRoot>/session-bindings.json`), seat specs and appendices, `dispatch_worker`,
`fresh_review`, `factory_status`, durable supervision, `demo_sandbox`, and the Factory intake
routes. The embedding app still owns the outer server and provider credentials/settings.

Every host uses the stable workspace scope `factory-hub`, giving all registered epics one
sessions surface and one Inbox. Each tool resolves its epic from the calling session binding,
or from its optional explicit `epicKey`, and then operates on that registry entry's worktree.
An unbound call fails with an error that names the `epicKey` override. Child sessions inherit
the parent's binding before their first prompt.

Factory intake is `POST /api/v1/factory/epics`; listing is `GET /api/v1/factory/epics`, and
`POST /api/v1/factory/epics/:key/adopt` attaches an existing Orchestrator session. Legacy
per-epic transcripts are copied into the hub session namespace during adoption while their
source files remain intact. Intake reports whether the optional kickoff was accepted; a
failed kickoff leaves the registered, bound Orchestrator available for an explicit retry.
`BORING_FACTORY_EPIC_KEY`/`BORING_FACTORY_FEATURE_NAME` values are accepted only as one-shot
intake on boot and are logged as such; they are no longer host identity.

Do not add the skill root as a global package default and do not infer authority from
these authored files.

## Private vendoring

No npm publication is required. From an exact reviewed Boring UI commit:

```bash
pnpm --filter @hachej/boring-factory build
pnpm --filter @hachej/boring-factory pack --pack-destination <trusted-output-dir>
```

The consuming private app commits the tarball, its source commit, and its SHA-256,
then installs it through a frozen `file:` dependency.
